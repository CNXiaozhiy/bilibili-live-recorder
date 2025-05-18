import "@/utils/env";
import "@/utils/extensions";

import logger from "@/logger";

logger.info("[System]", "正在启动...");
logger.info("[Bootstrap]", "加载前置服务...");

import "./env";
import "./file-clean";

import bilibiliCachePool from "@/store/pool";
import bilibiliStore from "@/store/bilibili";
import bilibiliAccount from "@/lib/bilibili/account";

import AdaptersReady from "./adapter";

export default [bilibiliCachePool.ready, bilibiliStore.ready, bilibiliAccount.ready, ...AdaptersReady] as Promise<unknown>[];
