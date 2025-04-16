import logger from "@/logger";
import { statSync, existsSync, mkdirSync } from "fs";
import path from "path";

try {
  const env = process.env;
  if (!env.FFMPEG_BIN_FOLDER) throw new Error("未设置环境变量 FFMPEG_BIN_FOLDER");
  if (!env.SAVE_RECORD_FOLDER) throw new Error("未设置环境变量 SAVE_RECORD_FOLDER");
  if (!env.DB_PATH) throw new Error("未设置环境变量 DB_PATH");
  if (!statSync(env.FFMPEG_BIN_FOLDER).isDirectory())
    throw new Error("FFMPEG_BIN_FOLDER 不是文件夹");
  if (!existsSync(env.SAVE_RECORD_FOLDER)) {
    logger.warn("[Bootstrap]", "SAVE_RECORD_FOLDER 不存在, 创建文件夹...");
    mkdirSync(env.SAVE_RECORD_FOLDER, { recursive: true });
  }
  if (!existsSync(path.dirname(env.DB_PATH))) {
    logger.warn("[Bootstrap]", "DB_PATH 的父文件夹不存在, 创建文件夹...");
    mkdirSync(path.dirname(env.DB_PATH), { recursive: true });
  }
} catch (e) {
  logger.error("[Bootstrap]", "加载环境变量失败 -> \n", (e as Error).message);
  process.exit(0);
}
