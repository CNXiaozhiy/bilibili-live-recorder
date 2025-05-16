// web-adapter.ts
import express from "express";
import { ISubAdapter } from "@/lib/adapter";
import BilibiliLiveArManager from "@/lib/bilibili/live-ar-manager";
import logger from "@/logger";
import path from "path";
import apiRouter from "./router";

const PROCESS_START_TIME = Date.now();
const NOCACHE = process.env.NODE_ENV !== "production";

export default class WebAdapter implements ISubAdapter {
  public name = "web";

  private PORT: number;

  private app: express.Application | null = null;
  private arm: BilibiliLiveArManager | null = null;

  constructor(port: number) {
    this.PORT = port;
  }

  init(): void {
    logger.info("[Web Adapter]", `init`);
  }

  install(arm: BilibiliLiveArManager): void {
    this.arm = arm;
    this.createWebServer();
  }

  createWebServer() {
    if (!this.arm) throw new Error("[Web Adapter] arm is null");

    this.app = express();

    this.app.use(express.static(path.join(process.cwd(), "public")));
    this.app.use("/api", apiRouter(this.arm));

    this.app.listen(this.PORT, () => {
      logger.info("[Web Adapter]", `Web Adapter 服务启动成功✔️`);
    });
  }
}
