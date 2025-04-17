import EventEmitter from "events";
import XzQbot from "./xz-qbot";

export interface MetaData {
  id: string;
  name: string;
  version: string;
  cert: string;
  sign: string;
}

export default class XzQbotPlugin extends EventEmitter {
  private _botInstance: XzQbot;
  private _ready = false;
  private _error = false;

  constructor(_bot: XzQbot | string, private meta: MetaData) {
    super();
    typeof _bot === "string" ? (this._botInstance = new XzQbot(_bot)) : (this._botInstance = _bot);
    this._botInstance.connect().then(() => this._init());
  }

  private _init() {
    this._ready = true;
    this.emit("ready");

    return;
    this.botInstance
      ._action({
        action: "register_plugin",
        params: this.meta,
      })
      .then(() => {
        this._ready = true;
        this.emit("ready");
      })
      .catch((e) => {
        this._error = true;
        this.emit("error", "XzQBot-Plugin 插件注册失败");
      });
  }

  get botInstance() {
    return this._botInstance;
  }

  get ready() {
    return this._ready
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          this.on("ready", resolve);
          this.on("error", reject);
        });
  }
}
