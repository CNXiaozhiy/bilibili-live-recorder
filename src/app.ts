/**
 * XzBLR System
 */

process.env.APP_VERSION = "2.0.8";
process.env.META_FILE_VERSION = "1.0.0";

import fes from "./bootstrap"; // frontEndServices

import { taskRecovery } from "./utils/task-recovery";
import BilibiliLiveArManager from "./lib/bilibili/live-ar-manager";
import bilibiliStore from "./store/bilibili";
import adapterStore from "./store/adapter";
import logger from "./logger";

const app = async () => {
  const arm = new BilibiliLiveArManager({ saveRecordFolder: process.env.SAVE_RECORD_FOLDER! });
  const rooms = await bilibiliStore.state.db.getSubscribesTable();
  rooms.forEach(({ room_id, group_id, user_id }) =>
    arm.addSubscriber(room_id, `${group_id}_${user_id}`)
  );

  adapterStore.adapterInstance.install(arm);

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

process.on("uncaughtException", function (e) {
  logger.error("[Global UncaughtException]", "全局异常捕获❌ -> ", e);
});
