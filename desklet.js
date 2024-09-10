const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Interfaces = imports.misc.interfaces;
const Lang = imports.lang;
const Gio = imports.gi.Gio;

const MEDIA_PLAYER_2_PATH = "/org/mpris/MediaPlayer2";
const MEDIA_PLAYER_2_NAME = "org.mpris.MediaPlayer2";
const MEDIA_PLAYER_2_PLAYER_NAME = "org.mpris.MediaPlayer2.Player";

function MediaPlayer(parent, owner, name) {
  this._init(parent, owner, name);
}

MediaPlayer.prototype = {
  _init: function (parent, owner, name) {
    this.parent = parent;
    this.showPosition = true;
    this.owner = owner;
    this.busName = name;
    this.name = name.split(".")[3];

    Interfaces.getDBusProxyWithOwnerAsync(
      MEDIA_PLAYER_2_NAME,
      this.busName,
      Lang.bind(this, function (proxy, error) {
        if (error) {
          global.logError(error);
        } else {
          this._mediaServer = proxy;
          this._onGetDBus();
        }
      })
    );

    Interfaces.getDBusProxyWithOwnerAsync(
      MEDIA_PLAYER_2_PLAYER_NAME,
      this.busName,
      Lang.bind(this, function (proxy, error) {
        if (error) {
          global.logError(error);
        } else {
          this._mediaServerPlayer = proxy;
          this._onGetDBus();
        }
      })
    );

    Interfaces.getDBusPropertiesAsync(
      this.busName,
      MEDIA_PLAYER_2_PATH,
      Lang.bind(this, function (proxy, error) {
        if (error) {
          global.logError(error);
        } else {
          this._prop = proxy;
          this._onGetDBus();
        }
      })
    );
  },

  _onGetDBus: function () {
    try {
      if (!this._prop || !this._mediaServerPlayer || !this._mediaServer) return;
      this.setMetadata(this._mediaServerPlayer.Metadata);

      this._propChangedId = this._prop.connectSignal(
        "PropertiesChanged",
        Lang.bind(this, function (proxy, sender, [iface, props]) {
          if (props.Metadata) this.setMetadata(props.Metadata.deep_unpack());
        })
      );
    } catch (e) {
      global.logError(e);
    }
  },

  setMetadata: function (metadata) {
    if (!metadata) return;

    if (metadata["xesam:artist"])
      this.parent._artist.set_text(metadata["xesam:artist"].deep_unpack()[0]);

    if (metadata["xesam:title"])
      this.parent._songTitle.set_text(metadata["xesam:title"].unpack());

    let change = false;
    if (metadata["mpris:artUrl"]) {
      if (this.trackCoverFile != metadata["mpris:artUrl"].unpack()) {
        this.trackCoverFile = metadata["mpris:artUrl"].unpack();
        change = true;
      }
    } else {
      if (this.trackCoverFile != false) {
        this.trackCoverFile = false;
        change = true;
      }
    }

    if (change) {
      if (this.trackCoverFile) {
        this.coverPath = "";
        let uri = this.trackCoverFile;
        uri = uri.replace("thumb", "300");
        let cover = Gio.file_new_for_uri(decodeURIComponent(uri));
        if (!this.trackCoverFileTmp)
          this.trackCoverFileTmp = Gio.file_new_tmp(
            "XXXXXX.mediaplayer-cover"
          )[0];
        cover.read_async(null, null, Lang.bind(this, this._onReadCover));
      } else {
        this.parent.updateAlbumArt("");
      }
    }
  },

  _onReadCover: function (cover, result) {
    let inStream = cover.read_finish(result);
    let outStream = this.trackCoverFileTmp.replace(
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
      null
    );
    outStream.splice_async(
      inStream,
      Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
      0,
      null,
      Lang.bind(this, this._onSavedCover)
    );
  },

  _onSavedCover: function (outStream, result) {
    outStream.splice_finish(result, null);
    this.coverPath = this.trackCoverFileTmp.get_path();
    this.parent.updateAlbumArt(this.coverPath);
  },
};

function AlbumArtDesklet(metadata, desklet_id) {
  this._init(metadata, desklet_id);
}

AlbumArtDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function (metadata, desklet_id) {
    try {
      this.player = null;
      this.owner = null;
      this.metadata = metadata;
      Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

      this.setupPlayer();
      this.setupSettings(desklet_id);
      this.setupUI();
    } catch (e) {
      global.logError(e);
    }
  },

  setupPlayer: function () {
    try {
      Interfaces.getDBusAsync(
        Lang.bind(this, function (proxy, error) {
          this._dbus = proxy;

          let name_regex = /^org\.mpris\.MediaPlayer2\.spotify$/;

          this._dbus.ListNamesRemote(
            Lang.bind(this, function (names) {
              for (let n in names[0]) {
                let name = names[0][n];
                if (name_regex.test(name)) {
                  this._dbus.GetNameOwnerRemote(
                    name,
                    Lang.bind(this, function (owner) {
                      this._addPlayer(name, owner);
                    })
                  );
                }
              }
            })
          );

          this._ownerChangedId = this._dbus.connectSignal(
            "NameOwnerChanged",
            Lang.bind(
              this,
              function (_proxy, _sender, [name, old_owner, new_owner]) {
                if (name_regex.test(name)) {
                  if (old_owner && this.player) this._removePlayer();
                  if (new_owner && !this.player)
                    this._addPlayer(name, new_owner);
                }
              }
            )
          );
        })
      );
    } catch (e) {
      global.logError(e);
    }
  },

  _addPlayer: function (name, owner) {
    try {
      this.player = new MediaPlayer(this, owner, name);
      this.owner = owner;
    } catch (e) {
      global.logError(e);
    }
  },

  _removePlayer: function () {
    try {
      // this.player.destroy();
      this.player = null;
      this.owner = null;
    } catch (e) {
      global.logError(e);
    }
  },

  setupSettings: function (desklet_id) {
    this.settings = new Settings.DeskletSettings(
      this,
      this.metadata.uuid,
      desklet_id
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "artSize",
      "artSize",
      this.on_settings_changed
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "textColor",
      "textColor",
      this.on_settings_changed
    );
  },

  on_settings_changed: function () {
    this.updateSettings();
  },

  setupUI: function () {
    this._songTitleStyles =
      "margin-top: 10px; font-size: 20px; font-weight: bold; text-align: center;";
    this._artistStyles =
      "margin-top: 6px; font-size: 12px; text-align: center;";

    this._albumArtStyles = "background-color: rgba(255, 255, 255, 0.1); border-radius: 10px;";

    // make st 1 : 1 layout
    this._st = new St.BoxLayout({ vertical: true });
    this.setContent(this._st);
    this._st.set_width(300);

    // make album art
    this._albumArt = new St.Bin();
    this._st.add_actor(this._albumArt);

    this._albumArt.set_style(this._albumArtStyles);
    this._albumArt.set_size(300, 300);

    // make song title
    this._songTitle = new St.Label({ text: "Unknown Song" });
    this._st.add_actor(this._songTitle);

    this._songTitle.set_style("color: #ffffff;" + this._songTitleStyles);

    // make album title
    //this._albumTitle = new St.Label({ text: "Album Title" });
    //this._st.add_actor(this._albumTitle);
    //this._albumTitle.set_style("color: #ffffff; margin-bottom: 10px; font-size: 20px;");

    // make artist
    this._artist = new St.Label({ text: "Unknown Artist" });
    this._st.add_actor(this._artist);

    this._artist.set_style("color: #ffffff;" + this._artistStyles);

    this.updateSettings();
  },

  updateAlbumArt: function (uri) {
    global.log('updateAlbumArt: ' + uri);
    this._albumArt.set_style(
      "background-image: url('" + uri + "'); background-size: contain;" + this._albumArtStyles
    );
  },

  updateSettings: function () {
    this._st.set_width(this.artSize);
    this._albumArt.set_size(this.artSize, this.artSize);
    this._songTitle.set_style(
      "color: " + this.textColor + ";" + this._songTitleStyles
    );
    this._artist.set_style(
      "color: " + this.textColor + ";" + this._artistStyles
    );
  },
};

function main(metadata, desklet_id) {
  return new AlbumArtDesklet(metadata, desklet_id);
}
