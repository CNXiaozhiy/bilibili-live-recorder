/**
 * XzBLR System
 * @version 2.0.2
 */

process.env.APP_VERSION = "2.0.2";

import fes from "./bootstrap"; // frontEndServices

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
};

Promise.all(fes)
  .then(() => {
    app()
      .then(() => logger.info("[App]", "App 启动成功✅"))
      .catch((e) => logger.error("[App Global Catch]", "全局异常捕获❌ -> ", e));
  })
  .catch((e) => {
    logger.error("[Bootstrap]", "加载前置服务失败 -> ", e);
    process.exit(1);
  });
