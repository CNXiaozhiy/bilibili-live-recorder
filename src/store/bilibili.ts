import BilibiliUploader from "@/lib/bilibili/uploader";
import { Datebase } from "@/utils/db";
import path from "path";

type StoreState = {
  db: InstanceType<typeof Datebase.Main>;
};

let state: StoreState;

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), process.env.DB_PATH!);

let initPromise = new Promise<void>(async (resolve) => {
  const dbInstance = new Datebase.Main(dbPath)._init();
  state = {
    db: dbInstance,
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
