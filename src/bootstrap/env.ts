import logger from "@/logger";
import { statSync } from "fs";

try {
  const env = process.env;
  if (!env.FFMPEG_BIN_FOLDER) throw new Error("未设置环境变量 FFMPEG_BIN_FOLDER");
  if (!env.SAVE_RECORD_FOLDER) throw new Error("未设置环境变量 SAVE_RECORD_FOLDER");
  if (!statSync(env.FFMPEG_BIN_FOLDER).isDirectory())
    throw new Error("FFMPEG_BIN_FOLDER 不是文件夹");
  if (!statSync(env.SAVE_RECORD_FOLDER).isDirectory())
    throw new Error("SAVE_RECORD_FOLDER 不是文件夹");
} catch (e) {
  logger.error("[Bootstrap]", "加载环境变量失败 -> \n", (e as Error).message);
  process.exit(0);
}
