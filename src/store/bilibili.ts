import BilibiliUploader from "@/lib/bilibili/uploader";
import { Datebase } from "@/utils/db";
import path from "path";

type StoreState = {
  bilibili_cookie: string;
  bilibili_refresh_token: string;
  db: InstanceType<typeof Datebase.Main>;
  publicUploader: InstanceType<typeof BilibiliUploader>;
};

let state: StoreState;

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), process.env.DB_PATH!);

let initPromise = new Promise<void>(async (resolve) => {
  const dbInstance = new Datebase.Main(dbPath)._init();
  const bilibili_cookie = (await dbInstance.getSetting("bilibili_cookie")) || "";
  const bilibili_refresh_token = (await dbInstance.getSetting("bilibili_refresh_token")) || "";
  const uploaderInstance = new BilibiliUploader(bilibili_cookie);
  state = {
    bilibili_cookie: bilibili_cookie,
    bilibili_refresh_token: bilibili_refresh_token,
    db: dbInstance,
    publicUploader: uploaderInstance,
  };
  resolve();
});

const bilibiliStore = {
  ready: initPromise,

  get state(): StoreState {
    return state;
  },

  updateField<K extends keyof StoreState>(key: K, value: StoreState[K]): void {
    state[key] = value;
  },

  setState(newState: Partial<StoreState>): void {
    state = { ...state, ...newState };
  },
};

export default bilibiliStore;
