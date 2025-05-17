import logger from "@/logger";
import QRCode from "qrcode";
import path from "path";
import moment from "moment";
import bilibiliStore from "@/store/bilibili";
import BilibiliLiveRecorder from "@/lib/bilibili/live-recorder";
import {
  checkLoginQrcode,
  checkRefreshCookie,
  generateLoginQrcode,
  getAccountInfo,
  getImageBase64FromUrl,
  getLiveRoomInfo,
  getUpUserInfo,
  refreshCookie,
} from "@/lib/bilibili/api";
import { Bilibili, BilibiliUploaderOptions, LiveRoomInfo, UserInfo } from "@/types/bilibili";
import { SegmentMessages } from "@/types/one-bot";

function transformRecStatus(status: Bilibili.RecorderStatus) {
  switch (status) {
    case Bilibili.RecorderStatus.RECORDING:
      return "正在录制 🟢";
    case Bilibili.RecorderStatus.STOPPING:
      return "正在停止 ⏳";
    case Bilibili.RecorderStatus.NOT_RECORDING:
      return "未在录制 🔴";
    default:
      return "未知状态 ❌";
  }
}

function transformLiveStatus(status: number) {
  switch (status) {
    case Bilibili.LiveRoomStatus.LIVE:
      return "正在直播 🟢";
    case Bilibili.LiveRoomStatus.LIVE_END:
      return "未在直播 🔴";
    case Bilibili.LiveRoomStatus.LIVE_SLIDESHOW:
      return "正在轮播 🟡";
    default:
      return "未知状态 ❌";
  }
}

async function login() {
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
        const accountInfo = await getAccountInfo(cookie!);
        bilibiliStore.state.db.addBiliAccount(accountInfo.data.mid, cookie!, refresh_token!);

        logger.info("[Bili Login]", "登录成功✅");
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

async function checkAndRefreshCookie() {
  logger.info("[Bili Login]", "检查 所有账号 Cookie 状态⏳");

  const accounts = await bilibiliStore.state.db.getBiliAccounts();

  for (const account of accounts) {
    const { uid, bili_cookie, bili_refresh_token } = account;
    const resp = await checkRefreshCookie(bili_cookie);

    if (resp.code === -101 || resp.data.refresh) {
      logger.info("[Bili Login]", `账号 ${uid} Cookie 已过期❌，正在刷新 Cookie⚙️`);
      try {
        const { cookie, refresh_token } = await refreshCookie(bili_cookie, bili_refresh_token);

        await bilibiliStore.state.db.updateBiliAccount(uid, cookie, refresh_token);

        logger.info("[Bili Login]", `账号 ${uid} Cookie 刷新成功✅`);
      } catch (e) {
        if ((e as Error).message.startsWith("[LOGIN_EXPIRED]")) {
          logger.warn("[Bili Login]", (e as Error).message);
          process.exit(0);
        } else {
          logger.error("[Bili Login]", (e as Error).message);
          process.exit(0);
        }
      }
    } else {
      logger.info("[Bili Login]", `账号 ${uid} Cookie 正常✅`);
    }
  }
}

function getCSRF(cookie: string) {
  const match = cookie.match(/bili_jct=([^\s;]+)/);
  if (!match || !Array.isArray(match)) throw new Error("bili_jct not found");
  return match[1];
}

function parseCookies(cookieStrings: string[]): string {
  return cookieStrings
    .map((cookie) => {
      const [keyValue] = cookie.split(";");
      return keyValue.trim();
    })
    .join("; ");
}

/**
 * 根据 LiveRecorder 提供的stat信息快速生成 Uploader Task配置
 * @param recorder
 * @param file
 * @returns
 */
async function generateDefaultUploadrOptions(
  roomId: number,
  stat: BilibiliLiveRecorder["stat"],
  liveRoomInfo: LiveRoomInfo,
  file: string
): Promise<BilibiliUploaderOptions> {
  const userInfo = await getUpUserInfo(liveRoomInfo.uid);
  return {
    file_path: file,

    video: {
      title: `【${userInfo.card.name}】【直播回放】${liveRoomInfo.title} ${liveRoomInfo.live_time}`,
      description:
        `UP主: ${userInfo.card.name}\n` +
        `https://space.bilibili.com/${userInfo.card.mid}\n` +
        `\n` +
        `直播间标题: ${liveRoomInfo.title}\n` +
        `直播间简介: ${liveRoomInfo.description || "无"}\n` +
        `直播间地址: https://live.bilibili.com/${liveRoomInfo.room_id}\n` +
        `开播时间: ${moment(liveRoomInfo.live_time).format("YYYY-MM-DD HH:mm:ss")}\n` +
        `开始录制: ${
          stat.startTime ? moment(stat.startTime).format("YYYY-MM-DD HH:mm:ss") : "未知"
        }\n` +
        `结束录制: ${
          stat.endTime ? moment(stat.endTime).format("YYYY-MM-DD HH:mm:ss") : "未知"
        }\n` +
        `\n` +
        `侵权请联系本人, 本人将立即删除\n\n` +
        `由 Xz-BLR-System ${process.env.APP_VERSION} 系统录制\n`,
      cover: await getImageBase64FromUrl(liveRoomInfo.user_cover),
    },
  };
}

async function generateUploadrOptions(
  roomId: number,
  stat: BilibiliLiveRecorder["stat"],
  liveRoomInfo: LiveRoomInfo,
  file: string
): Promise<BilibiliUploaderOptions> {
  const defaultOptions = await generateDefaultUploadrOptions(roomId, stat, liveRoomInfo, file);
  const customRoomSetting = await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId);
  if (customRoomSetting) {
    if (customRoomSetting.upload_title) defaultOptions.video.title = customRoomSetting.upload_title;
    if (customRoomSetting.upload_desc)
      defaultOptions.video.description = customRoomSetting.upload_desc;
    if (customRoomSetting.upload_cover)
      defaultOptions.video.cover = await getImageBase64FromUrl(customRoomSetting.upload_cover);
    if (customRoomSetting.upload_tid) defaultOptions.video.tid = customRoomSetting.upload_tid;
    if (customRoomSetting.upload_tag) defaultOptions.video.tag = customRoomSetting.upload_tag;
  }
  return defaultOptions;
}

const format = {
  recordStatus: (
    roomInfo: LiveRoomInfo,
    liveRecorder: BilibiliLiveRecorder,
    upUserInfo?: UserInfo
  ): SegmentMessages => {
    const isRecording = liveRecorder.recStatus === Bilibili.RecorderStatus.RECORDING;
    const text =
      (upUserInfo ? `【${upUserInfo.card.name}】${roomInfo.title}\n` : "") +
      `直播间ID: ${roomInfo.room_id}\n` +
      `直播状态: ${transformLiveStatus(roomInfo.live_status)}\n` +
      `录制状态: ${transformRecStatus(liveRecorder.recStatus)}` +
      (isRecording
        ? `\n当前分段: ${liveRecorder.segIndex}\n` +
          `当前帧率: ${liveRecorder.recProgress?.currentFps || "未知"}\n` +
          `录制时长: ${liveRecorder.recProgress?.timemark || "未知"}`
        : "");

    return [
      // { type: "image", data: { file: roomInfo.user_cover } },
      { type: "text", data: { text } },
    ];
  },
  liveRoomInfo: (roomInfo: LiveRoomInfo, upUserInfo?: UserInfo): SegmentMessages => {
    const text =
      (upUserInfo ? `【${upUserInfo.card.name}】${roomInfo.title}\n` : "") +
      `直播间ID: ${roomInfo.room_id}\n` +
      `直播间简介: ${roomInfo.description || "无"}\n` +
      `直播间状态: ${transformLiveStatus(roomInfo.live_status)}\n` +
      `直播间人气: ${roomInfo.online}\n` +
      `开播时间: ${moment(roomInfo.live_time).format("YYYY-MM-DD HH:mm:ss")}\n` +
      `地址: https://live.bilibili.com/${roomInfo.room_id}`;

    return [
      { type: "image", data: { file: roomInfo.user_cover } },
      { type: "text", data: { text } },
    ];
  },
};

export default class BilibiliUtils {
  static transformLiveStatus = transformLiveStatus;
  static transformRecStatus = transformRecStatus;
  static login = login;
  static checkAndRefreshCookie = checkAndRefreshCookie;
  static getCSRF = getCSRF;
  static parseCookies = parseCookies;
  static generateUploadrOptions = generateUploadrOptions;
  static format = format;
}
