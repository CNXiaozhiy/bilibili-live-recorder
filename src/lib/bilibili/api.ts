import crypto from "crypto";
import request from "@/utils/http";
import BilibiliUtils from "@/utils/bilibili";
import bilibiliCachePool from "@/store/pool";
import { LiveRoomInfo, LiveRoomPlayInfo, VideoInfo, UserInfo, LoginInfo } from "@/types/bilibili";

type BaseResponse<T = any> = {
  code: number;
  message: string;
  data: T;
};

function checkResponseCode<T>(resp: BaseResponse<T>) {
  if (resp.code !== 0) throw new Error(resp.message);
}

export async function generateLoginQrcode() {
  const resp = await request.get<BaseResponse<{ url: string; qrcode_key: string }>>(
    "https://passport.bilibili.com/x/passport-login/web/qrcode/generate"
  );

  checkResponseCode(resp.data);

  return resp.data.data;
}

export async function checkLoginQrcode(qrcode_key: string) {
  const resp = await request.get<
    BaseResponse<{
      url: string;
      refresh_token: string;
      timestamp: number;
      code: 0 | 86038 | 86090 | 86101;
    }>
  >(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrcode_key}`);

  checkResponseCode(resp.data);

  let cookie: string | null = null;

  if (resp.data.data.code === 0) {
    if (resp.headers["set-cookie"] && Array.isArray(resp.headers["set-cookie"])) {
      cookie = BilibiliUtils.parseCookies(resp.headers["set-cookie"]);
    } else {
      throw new Error("获取 set-cookie 失败");
    }
  }

  return { ...resp.data.data, cookie };
}

export async function checkRefreshCookie(cookie: string) {
  const csrf = BilibiliUtils.getCSRF(cookie);
  const resp = await request.get<{
    code: 0 | -101;
    message: string;
    data: { refresh: boolean; timestamp: number };
  }>(`https://passport.bilibili.com/x/passport-login/web/cookie/info?csrf=${csrf}`, {
    headers: { cookie },
  });

  return resp.data;
}

export async function refreshCookie(cookie: string, refresh_token: string) {
  const timestamp = Date.now();
  const csrf = BilibiliUtils.getCSRF(cookie);

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "RSA",
      n: "y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE",
      e: "AQAB",
    },
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["encrypt"]
  );

  async function getCorrespondPath(timestamp: number) {
    const data = new TextEncoder().encode(`refresh_${timestamp}`);
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, data)
    );
    return encrypted.reduce((str, c) => str + c.toString(16).padStart(2, "0"), "");
  }

  const correspondPath = await getCorrespondPath(timestamp);

  const { data: html } = await request.get<string>(
    `https://www.bilibili.com/correspond/1/${correspondPath}`,
    {
      headers: {
        cookie,
      },
    }
  );

  const regex = /<div id="1-name">(.*?)<\/div>/;
  const match = html.match(regex);

  if (!match || !match[1]) {
    throw new Error("获取 refresh_csrf 失败");
  }

  const refresh_csrf = match[1];

  const resp = await request<
    BaseResponse<{ status: number; message: string; refresh_token: string }>
  >(
    `https://passport.bilibili.com/x/passport-login/web/cookie/refresh?csrf=${csrf}&refresh_csrf=${refresh_csrf}&source=main_web&refresh_token=${refresh_token}`,
    {
      method: "POST", // 奇怪的灰电效应 request.post会报错....
      headers: {
        cookie,
      },
    }
  );

  if (resp.data.code === -101) {
    throw new Error("[LOGIN_EXPIRED] -> 登录已过期请重新登录: " + resp.data.message);
  }

  checkResponseCode(resp.data);

  if (resp.headers["set-cookie"] && Array.isArray(resp.headers["set-cookie"])) {
    const new_refresh_token = resp.data.data.refresh_token;
    const newCookie = BilibiliUtils.parseCookies(resp.headers["set-cookie"]);

    await request.post(
      `https://passport.bilibili.com/x/passport-login/web/confirm/refresh?csrf=${csrf}&refresh_token=${refresh_token}`,
      {
        headers: {
          cookie: newCookie,
        },
      }
    );

    return {
      cookie: newCookie,
      refresh_token: new_refresh_token,
    };
  } else {
    throw new Error("获取 cookie 失败");
  }
}

/**
 * 获取直播流 Url
 * @param roomId
 * @param cookie 选填，为了更好的画质
 * @returns
 */
export async function getLiveStreamUrl(roomId: string | number, cookie?: string) {
  const resp = await request.get<BaseResponse<LiveRoomPlayInfo>>(
    `https://api.live.bilibili.com/room/v1/Room/playUrl?cid=${roomId}&qn=0&platform=web`,
    {
      headers: {
        Referer: "https://live.bilibili.com/",
        cookie,
      },
    }
  );

  checkResponseCode(resp.data);

  if (!resp.data.data.durl || resp.data.data.durl.length === 0) throw new Error("durl not found");
  const urls = resp.data.data.durl.map((item) => item?.url).filter((url) => url !== undefined);
  return urls;
}

export async function getLiveRoomInfo(roomId: string | number, cookie?: string, useCache = true) {
  const resp = await request.get<BaseResponse<LiveRoomInfo>>(
    `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`,
    {
      headers: {
        Referer: "https://live.bilibili.com/",
        cookie,
      },
    }
  );

  checkResponseCode(resp.data);

  return resp.data.data;
}

export async function getVideoInfo(bvid: string, cookie?: string, useCache = true) {
  // 使用 Cache Pool
  if (useCache) {
    const cache = bilibiliCachePool.videoInfo.get(bvid);
    if (cache) return cache;
  }

  const resp = await request.get<BaseResponse<VideoInfo>>(
    `https://api.bilibili.com/x/web-interface/wbi/view?bvid=${bvid}`,
    {
      headers: {
        Referer: "https://live.bilibili.com/",
        cookie,
      },
    }
  );

  checkResponseCode(resp.data);

  bilibiliCachePool.videoInfo.set(bvid, resp.data.data);
  return resp.data.data;
}

export async function getUpUserInfo(mid: string | number, cookie?: string, useCache = true) {
  mid = typeof mid === "string" ? parseInt(mid) : mid;

  // 使用 Cache Pool
  if (useCache) {
    const cache = bilibiliCachePool.upUserInfo.get(mid);
    if (cache) return cache;
  }

  const resp = await request.get<BaseResponse<UserInfo>>(
    `https://api.bilibili.com/x/web-interface/card?mid=${mid}`,
    {
      headers: { cookie },
    }
  );

  checkResponseCode(resp.data);

  bilibiliCachePool.upUserInfo.set(mid, resp.data.data);
  return resp.data.data;
}

export async function isLiveStreamAvailable(url: string) {
  try {
    const response = await request.get(url, {
      responseType: "stream",
      timeout: 10000,
    });

    response.data.destroy();
    return true;
  } catch (error) {
    return false;
  }
}

export async function registerVideoStorage(
  cookie: string,
  options: { file_name: string; file_size: number }
) {
  const resp = await request<{
    OK: number;
    upos_uri: string;
    endpoint: string;
    auth: string;
    biz_id: string;
  }>(
    `https://member.bilibili.com/preupload?name=${options.file_name}&upcdn=bldsa&zone=cs&r=upos&profile=ugcfx%2Fbup&ssl=0&size=${options.file_size}&version=2.14.0.0`,
    {
      headers: {
        Referer: "https://member.bilibili.com/platform/upload/video/frame",
        cookie,
      },
    }
  );

  if (resp.data.OK !== 1) throw new Error("注册视频存储空间失败");

  return resp.data;
}

export async function getUploadID(
  cookie: string,
  options: { upload_url: string; file_size: number; partsize: number; biz_id: string; auth: string }
) {
  const resp = await request<{ OK: number; bucket: string; key: string; upload_id: string }>(
    `${options.upload_url}?uploads&output=json&profile=ugcfx%2Fbup&filesize=${options.file_size}&partsize=${options.partsize}&biz_id=${options.biz_id}`,
    {
      method: "POST",
      headers: {
        Origin: "https://member.bilibili.com",
        Referer: "https://member.bilibili.com/",
        "X-Upos-Auth": options.auth,
        cookie,
      },
    }
  );

  if (resp.data.OK !== 1) throw new Error("获取上传 ID 失败");
  return resp.data;
}

export async function validateVideo(
  cookie: string,
  options: {
    upload_url: string;
    file_name: string;
    auth: string;
    biz_id: string;
    upload_id: string;
  }
) {
  const resp = await request<{ OK: number; location: string; bucket: string; key: string }>(
    `${options.upload_url}?output=json&name=${options.file_name}&profile=ugcfx%2Fbup&uploadId=${options.upload_id}&biz_id=${options.biz_id}`,
    {
      method: "POST",
      headers: {
        Origin: "https://member.bilibili.com",
        Referer: "https://member.bilibili.com/",
        "X-Upos-Auth": options.auth,
        Cookie: cookie,
      },
    }
  );

  if (resp.data.OK !== 1) throw new Error("视频合片失败");
  return resp.data;
}

export async function uploadCover(cookie: string, options: { csrf: string; cover: string }) {
  const resp = await request<{
    code: number;
    message: string;
    ttl: number;
    data: { url: string };
  }>(`https://member.bilibili.com/x/vu/web/cover/up`, {
    method: "POST",
    headers: {
      Origin: "https://member.bilibili.com",
      Referer: "https://member.bilibili.com/",
      "Content-Type": "multipart/form-data",
      Cookie: cookie,
    },
    data: {
      csrf: options.csrf,
      cover: options.cover,
    },
  });

  if (resp.data.code !== 0) throw new Error(resp.data.message);

  return resp.data.data;
}

export async function uploadVideo(cookie: string, options: { csrf: string; data: any }) {
  const resp = await request<{
    code: number;
    message: string;
    ttl: number;
    data: { aid: number; bvid: string };
  }>(`https://member.bilibili.com/x/vu/web/add/v3?csrf=${options.csrf}`, {
    method: "POST",
    headers: {
      Origin: "https://member.bilibili.com",
      Referer: "https://member.bilibili.com/",
      "Content-Type": "application/json",
      cookie,
    },
    data: options.data,
  });

  if (resp.data.code !== 0) throw new Error(resp.data.message);

  return resp.data.data;
}

export async function getImageBase64FromUrl(url: string): Promise<string> {
  const res = await request<any>({
    method: "GET",
    url: url,
    responseType: "arraybuffer",
  });

  return new Promise((resolve) => {
    const imgBase64 = Buffer.from(res.data, "binary").toString("base64");
    const imageUrl = `data:image/png;base64,${imgBase64}`;
    resolve(imageUrl);
  });
}

export async function getAccountInfo(cookie: string) {
  const resp = await request<BaseResponse<LoginInfo>>(
    "https://api.bilibili.com/x/web-interface/nav",
    {
      headers: { cookie },
    }
  );

  checkResponseCode(resp.data);

  return resp.data;
}
