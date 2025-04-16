import logger from "@/logger";
import BilibiliLiveArManager from "../bilibili/live-ar-manager";

export interface ISubAdapter {
  name: string;

  init(): void;
  install(arm: BilibiliLiveArManager): void;
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

  install(arm: BilibiliLiveArManager) {
    this.adapters.forEach((adapter) => adapter.install(arm));
  }
}
