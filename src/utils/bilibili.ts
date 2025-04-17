import logger from "@/logger";
import QRCode from "qrcode";
import path from "path";
import bilibiliStore from "@/store/bilibili";
import BilibiliLiveRecorder from "@/lib/bilibili/live-recorder";
import {
  checkLoginQrcode,
  checkRefreshCookie,
  generateLoginQrcode,
  getImageBase64FromUrl,
  getLiveRoomInfo,
  getUpUserInfo,
  refreshCookie,
} from "@/lib/bilibili/api";
import { BilibiliUploaderOptions } from "@/types/bilibili";

export async function login() {
  let retryTimes = 0;
  while (true) {
    retryTimes += 1;
    if (retryTimes > 3) {
      logger.error("登录失败");
      process.exit(0);
    }
    const { url, qrcode_key } = await generateLoginQrcode();
    const qrcode_path = path.join(process.cwd(), "qrcode.png");
    logger.info("[Bili Login]", "请扫二维码");
    console.log("* 终端二维码");
    console.log(await QRCode.toString(url, { type: "terminal", small: true }));
    QRCode.toFile(qrcode_path, url, { type: "png" });
    console.log("* 本地二维码路径", qrcode_path);
    console.log(
      "* 打开浏览器扫描二维码",
      `https://api.qrtool.cn/?text=${encodeURIComponent(url)}&size=500&margin=20&level=H`
    );

    waitScan: while (true) {
      const { code, cookie, refresh_token } = await checkLoginQrcode(qrcode_key);
      if (code === 0) {
        await bilibiliStore.updateField("bilibili_cookie", cookie!);
        await bilibiliStore.updateField("bilibili_refresh_token", refresh_token!);
        await bilibiliStore.state.db.setSetting("bilibili_cookie", cookie!);
        await bilibiliStore.state.db.setSetting("bilibili_refresh_token", refresh_token!);

        logger.info("[Bili Login]", "登录成功✔️");
        return;
      } else if (code === 86038) {
        logger.warn("[Bili Login]", "t二维码已过期❌，正在刷新二维码⚙️");
        break waitScan;
      } else if (code === 86090) {
        logger.info("[Bili Login]", "等待用户确认登录⏳");
      } else if (code === 86101) {
        logger.info("[Bili Login]", "等待扫描二维码⏳");
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export async function checkAndRefreshCookie() {
  logger.info("[Bili Login]", "检查 Cookie 状态⏳");

  const { bilibili_cookie, bilibili_refresh_token } = bilibiliStore.state;
  const resp = await checkRefreshCookie(bilibili_cookie);

  if (resp.code === -101 || resp.data.refresh) {
    logger.info("[Bili Login]", "Cookie 已过期❌，正在刷新 Cookie⚙️");
    try {
      const { cookie, refresh_token } = await refreshCookie(
        bilibili_cookie,
        bilibili_refresh_token
      );

      await bilibiliStore.updateField("bilibili_cookie", cookie);
      await bilibiliStore.updateField("bilibili_refresh_token", refresh_token);

      await bilibiliStore.state.db.setSetting("bilibili_cookie", cookie);
      await bilibiliStore.state.db.setSetting("bilibili_refresh_token", refresh_token);

      logger.info("[Bili Login]", "Cookie 刷新成功✔️");
    } catch (e) {
      if ((e as Error).message.startsWith("[LOGIN_EXPIRED]")) {
        logger.warn("[Bili Login]", (e as Error).message);
        await bilibiliStore.state.db.setSetting("bilibili_cookie", "");
        await bilibiliStore.state.db.setSetting("bilibili_refresh_token", "");
        process.exit(0);
      } else {
        logger.error("[Bili Login]", (e as Error).message);
        process.exit(0);
      }
    }
  } else {
    logger.info("[Bili Login]", "Cookie 正常✔️");
  }
}

export function getCSRF(cookie: string) {
  const match = cookie.match(/bili_jct=([^\s;]+)/);
  if (!match || !Array.isArray(match)) throw new Error("bili_jct not found");
  return match[1];
}

export function parseCookies(cookieStrings: string[]): string {
  return cookieStrings
    .map((cookie) => {
      const [keyValue] = cookie.split(";");
      return keyValue.trim();
    })
    .join("; ");
}

/**
 * 根据 LiveRecorder 提供的信息快速生成 Uploader Task配置
 * @param recorder
 * @param file
 * @returns
 */
export async function generateUploadrOptions(
  recorder: BilibiliLiveRecorder,
  file: string
): Promise<BilibiliUploaderOptions> {
  const liveRoomInfo = recorder.stat.liveRoomInfo || (await getLiveRoomInfo(recorder.roomId));
  const userInfo = await getUpUserInfo(liveRoomInfo.uid);
  return {
    file_path: file,
    cover_base64: await getImageBase64FromUrl(liveRoomInfo.user_cover),
    video: {
      title: `【${userInfo.card.name}】【直播回放】${liveRoomInfo.title} ${liveRoomInfo.live_time}`,
      description:
        `UP主: ${userInfo.card.name}\n` +
        `https://space.bilibili.com/${userInfo.card.mid}\n` +
        `\n` +
        `直播间标题: ${liveRoomInfo.title}\n` +
        `直播间简介: ${liveRoomInfo.description}\n` +
        `直播间地址: https://live.bilibili.com/${liveRoomInfo.room_id}\n` +
        `开播时间: ${liveRoomInfo.live_time}\n` +
        `开始录制: ${recorder.stat.startTime?.toLocaleString().replaceAll("/", "-")}\n` +
        `结束录制: ${recorder.stat.endTime?.toLocaleString().replaceAll("/", "-")}\n` +
        `\n` +
        `侵权请联系本人, 本人将立即删除\n\n` +
        `由 Xz-BLR-System 2.0 系统录制\n`,
    },
  };
}
