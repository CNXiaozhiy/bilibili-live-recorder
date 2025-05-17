import logger from "@/logger";
import bilibiliStore from "@/store/bilibili";
import BilibiliUtils from "@/utils/bilibili";
import { getAccountInfo } from "./api";

import readline from "readline";

const ready = new Promise<void>(async (resolve) => {
  await bilibiliStore.ready;
  if ((await bilibiliStore.state.db.getBiliAccounts()).length === 0) {
    logger.warn("[Bilibili Account]", "未登录任何账号 ⚠️");
    try {
      await BilibiliUtils.addAccountSync();
    } catch (e) {
      logger.error("[Bilibili Account]", (e as Error).message);
      process.exit(0);
    }
  }

  let defaultAccount = await bilibiliStore.state.db.getDefaultBiliAccount();

  if (defaultAccount === null) {
    logger.warn("[Bilibili Account]", "未设置默认账号 ⚠️");

    const accounts = await bilibiliStore.state.db.getBiliAccounts();
    const list = accounts.map((account, i) => `${i + 1}. ${account.uid}`).join("\n");
    logger.info("[Bilibili Account]", "账号列表:\n" + list);

    await new Promise<void>((resolve) => {
      const rl = readline.createInterface(process.stdin, process.stdout);
      rl.question("请输入默认账号序号: ", async (answer) => {
        rl.close();
        try {
          if (answer === "") throw new Error();
          if (parseInt(answer) < 1 || parseInt(answer) > accounts.length) throw new Error();
        } catch (e) {
          logger.error("[Bilibili Account]", "请输入正确的账号序号");
          process.exit(0);
        }

        await bilibiliStore.state.db.setDefaultBiliAccount(accounts[parseInt(answer) - 1].uid);

        resolve();
      });
    });

    defaultAccount = await bilibiliStore.state.db.getDefaultBiliAccount();
  }

  await BilibiliUtils.checkAndRefreshCookie();
  setInterval(BilibiliUtils.checkAndRefreshCookie, 60 * 60 * 1000);

  const accounts = await bilibiliStore.state.db.getBiliAccounts();

  logger.info("[Bilibili Account]", "所有账号数:", accounts.length);
  logger.info("[Bilibili Account]", "默认账号:", defaultAccount?.uid);

  for (const account of accounts) {
    const { bili_cookie } = account;
    const accountInfo = (await getAccountInfo(bili_cookie)).data;
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
  }

  resolve();
});

const bilibiliAccount = { ready };

export default bilibiliAccount;
