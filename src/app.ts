/**
 * XzBLR System
 * @version 2.0.0
 */

process.env.APP_VERSION = "2.0.0";

import "./bootstrap";

import XzQbotPlugin from "./lib/xz-qbot/xz-qbot-plugin";
import { Adapter } from "./lib/notification-adapter/adapter";
import XzQbotNotificationAdapter from "./lib/notification-adapter/xz-qbot";
import BilibiliLiveArManager from "./lib/bilibili/live-ar-manager";
import bilibiliStore from "./store/bilibili";
import logger from "./logger";
import { getImageBase64FromUrl } from "./lib/bilibili/api";

let frontEndServices: Promise<any>[] = [];

// 等待 bilibiliStore 准备
frontEndServices.push(bilibiliStore.ready);

const adapter = new Adapter();

// 注册 subAdapter
const subAdapters = [];
if (process.env.ADAPTER_XZQBOT_CONFIG_ENABLE === "true") {
  if (!process.env.ADAPTER_XZQBOT_CONFIG_WS) throw new Error("请设置 ADAPTER_XZQBOT_CONFIG_WS");
  const xzQbotPlugin = new XzQbotPlugin(process.env.ADAPTER_XZQBOT_CONFIG_WS, {
    id: "test",
    name: "test",
    version: "1.0",
    cert: "test",
    sign: "test",
  });
  frontEndServices.push(xzQbotPlugin.ready);
  subAdapters.push(new XzQbotNotificationAdapter(xzQbotPlugin.botInstance));
}

adapter.register(subAdapters);

const app = async () => {
  if (
    bilibiliStore.state.bilibili_cookie === "" ||
    bilibiliStore.state.bilibili_refresh_token === ""
  )
    await bilibiliStore.login();

  setInterval(bilibiliStore.checkAndRefreshCookie, 60 * 60 * 1000);
  bilibiliStore.checkAndRefreshCookie();

  // 初始化 Arm
  const arm = new BilibiliLiveArManager({ saveRecordFolder: process.env.SAVE_RECORD_FOLDER! });
  const rooms = await bilibiliStore.state.db.getSubscribesTable();
  rooms.forEach(({ room_id, group_id, user_id }) =>
    arm.addSubscriber(room_id, `${group_id}_${user_id}`)
  );

  // 启用 Adapter
  adapter.install(arm);
};

Promise.all(frontEndServices)
  .then(() => {
    app()
      .then(() => logger.info("[App]", "App 启动成功✔️"))
      .catch((e) => logger.error("[App Global Catch]", "全局异常捕获❌ -> ", e));
  })
  .catch((e) => {
    logger.error(e);
    process.exit(1);
  });
