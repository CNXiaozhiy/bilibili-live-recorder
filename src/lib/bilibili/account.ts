import bilibiliStore from "@/store/bilibili";
import BilibiliUtils from "@/utils/bilibili";

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
  resolve();
});

const bilibiliAccount = { ready };

export default bilibiliAccount;
