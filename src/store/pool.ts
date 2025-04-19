import logger from "@/logger";
import { getUpUserInfo, getVideoInfo } from "@/lib/bilibili/api";
import { UserInfo, VideoInfo } from "@/types/bilibili";

const DELAY = process.env.CACHE_POOL_UPDATE_DELAY
  ? parseInt(process.env.CACHE_POOL_UPDATE_DELAY)
  : 60 * 60 * 1000;

const videoInfo = new Map<string, VideoInfo>(); // bvid
const upUserInfo = new Map<number, UserInfo>(); // mid

const updateVideoInfo = async () => {
  const videos = Array.from(videoInfo.keys());
  videos.forEach(async (bvid) => {
    try {
      const info = await getVideoInfo(bvid, undefined, false);
      videoInfo.set(bvid, info);
    } catch (e) {
      logger.error("[Cache Pool]", `更新视频${bvid}信息失败`, e);
    }
  });
};

const updateUpUserInfo = async () => {
  const users = Array.from(upUserInfo.keys());
  users.forEach(async (uid) => {
    try {
      const info = await getUpUserInfo(uid, undefined, false);
      upUserInfo.set(uid, info);
    } catch (e) {
      logger.error("[Cache Pool]", `更新UP${uid}信息失败`, e);
    }
  });
};

const updateAll = async () => {
  logger.info("[Cache Pool]", "更新缓存池");
  await updateVideoInfo();
  await updateUpUserInfo();
  logger.info("[Cache Pool]", "更新缓存池完成");
};

const ready = updateAll();
setInterval(updateAll, DELAY);

const bilibiliCachePool = {
  ready,
  videoInfo,
  upUserInfo,
  updateVideoInfo,
  updateUpUserInfo,
  updateAll,
};

export default bilibiliCachePool;
