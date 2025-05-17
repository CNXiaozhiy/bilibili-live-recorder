import logger from "@/logger";
import BilibiliLiveAcManager from "../bilibili/live-ac-manager";

export interface ISubAdapter {
  name: string;

  init(): void;
  install(arm: BilibiliLiveAcManager): void;
}

export class Adapter {
  private adapters: ISubAdapter[] = [];

  constructor() {}

  register(subAdapters: ISubAdapter[]) {
    subAdapters.forEach((adapter) => {
      logger.info("[Adapter]", `Register Adapter: ${adapter.name}`);
      adapter.init();
      this.adapters.push(adapter);
    });
  }

  install(arm: BilibiliLiveAcManager) {
    this.adapters.forEach((adapter) => adapter.install(arm));
  }
}
