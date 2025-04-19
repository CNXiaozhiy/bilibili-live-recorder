import logger from "@/logger";
import bilibiliStore from "@/store/bilibili";
import BilibiliUtils from "@/utils/bilibili";
import { getAccountInfo } from "./api";

const ready = new Promise<void>(async (resolve) => {
  await bilibiliStore.ready;
  if (
    bilibiliStore.state.bilibili_cookie === "" ||
    bilibiliStore.state.bilibili_refresh_token === ""
  ) {
    await BilibiliUtils.login();
  }
  await BilibiliUtils.checkAndRefreshCookie();
  setInterval(BilibiliUtils.checkAndRefreshCookie, 60 * 60 * 1000);

  const accountInfo = (await getAccountInfo(bilibiliStore.state.bilibili_cookie)).data;
  logger.info("[Bilibili Account]", "登录成功✅");
  logger.info("[Bilibili Account Info]", "账号MID:", accountInfo.mid);
  logger.info("[Bilibili Account Info]", "账号昵称:", accountInfo.uname);
  logger.info("[Bilibili Account Extra Info]", "硬币数:", accountInfo.money);
  logger.info(
    "[Bilibili Account Extra Info]",
    "当前等级:",
    "Lv" + accountInfo.level_info.current_level
  );
  logger.info("[Bilibili Account Extra Info]", "VIP等级:", accountInfo.vip_label.text || "无");
  resolve();
});

const bilibiliAccount = { ready };

export default bilibiliAccount;
