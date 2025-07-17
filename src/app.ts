/**
 * XzBLR System
 */

import fes from "./bootstrap"; // frontEndServices

import { taskRecovery } from "./utils/task-recovery";
import BilibiliLiveAcManager from "./lib/bilibili/live-ac-manager";
import bilibiliStore from "./store/bilibili";
import adapterStore from "./store/adapter";
import logger from "./logger";

const app = async () => {
  logger.info("[App]", "正在启动...");

  const acm = new BilibiliLiveAcManager({ saveRecordFolder: process.env.SAVE_RECORD_FOLDER! });
  const rooms = await bilibiliStore.state.db.getSubscribesTable();
  rooms.forEach(({ room_id, group_id, user_id }) => acm.addSubscriber(room_id, `${group_id}_${user_id}`));

  adapterStore.adapterInstance.install(acm);

  taskRecovery().catch((e) => logger.error("[Task Recovery]", "任务恢复失败 -> ", e));
};

Promise.all(fes)
  .then(() => {
    app()
      .then(() => logger.info("[App]", "App 启动成功✅"))
      .catch((e) => logger.error("[App Global Catch]", "APP 全局异常捕获❌ -> ", e));
  })
  .catch((e) => {
    logger.error("[Bootstrap]", "加载前置服务失败 -> ", e);
    process.exit(1);
  });

if (process.env.NODE_ENV === "production") {
  process.on("uncaughtException", function (e) {
    logger.error("[Global UncaughtException]", "全局异常捕获❌ -> ", e);
  });
}
