import fs from "fs";
import logger from "@/logger";
import FileTreeParse from "@/lib/bilibili/file-tree-parse";
import { RecordFileMeta, UploadFileMeta } from "@/types/bilibili";
import { getLiveRoomInfo } from "@/lib/bilibili/api";
import FfpmegUtils from "./ffmpeg";
import FileNameUtils from "./file-name";
import BilibiliUtils from "./bilibili";
import { createTask } from "@/gInstance/uploader";

async function checkRecordMetaCanReused(recordFileMetaMap: Map<string, RecordFileMeta>) {
  for (const [key, value] of recordFileMetaMap) {
    const roomInfo = await getLiveRoomInfo(value.room_id);
    if (
      roomInfo.live_status !== 1 ||
      new Date(roomInfo.live_time).getTime() !== value.live_start_time
    ) {
      logger.info("[Task Recovery]", value.hash, `直播已结束，该录制已完成✅`);

      try {
        const output = await FfpmegUtils.concat({
          inputFileList: value.record_files,
          outputPath: FileNameUtils.generateMergedFilePath(
            process.env.SAVE_RECORD_FOLDER!,
            value.room_id
          ),
        });

        const options = await BilibiliUtils.generateUploadrOptions(
          value.room_id,
          {
            startTime: new Date(value.start_time),
            endTime: value.end_time ? new Date(value.end_time) : undefined,
          },
          value.live_room_info,
          output
        );

        const { id, upload } = await createTask(options, value.room_id);
        logger.info("[Task Recovery]", value.hash, `开始上传 TaskID: ${id}`);

        try {
          const { aid, bvid } = await upload();
          logger.info("[Task Recovery]", value.hash, `重新投稿成功✅`);
          logger.info(
            "[Task Recovery Result]",
            value.hash,
            `视频地址: https://www.bilibili.com/video/${bvid}`
          );

          logger.info("[Task Recovery Result]", value.hash, `开始清理元文件和录制文件`);

          value.record_files.forEach((file) => {
            fs.unlinkSync(file);
          });
          fs.unlinkSync(output);
          fs.unlinkSync(key);

          logger.info("[Task Recovery Result]", value.hash, `清理元文件和录制文件完成✅`);
        } catch (error) {
          logger.error("[Task Recovery]", value.hash, `重新投稿失败❌`, error);
        }

        logger.info("[Task Recovery]", value.hash, `恢复任务完成✅`);
      } catch (error) {
        logger.error("[Task Recovery]", value.hash, `恢复任务失败❌`, error);
      }
    } else {
      logger.info("[Task Recovery]", value.hash, `直播未结束，等待录制器复用`);
    }
  }
}

async function recoverUpload(uploadMeteFilesMap: Map<string, UploadFileMeta>) {
  for (const [key, value] of uploadMeteFilesMap) {
    logger.info("[Task Recovery]", `开始恢复投稿 ${value.hash} ${value.room_id}⏳`);
    const { id, upload } = await createTask(value.uploader_options, value.room_id);
    logger.info("[Task Recovery]", value.hash, `开始上传 TaskID: ${id}`);
    try {
      const { aid, bvid } = await upload();
      logger.info("[Task Recovery]", value.hash, `重新投稿成功✅`);
      logger.info(
        "[Task Recovery Result]",
        value.hash,
        `视频地址: https://www.bilibili.com/video/${bvid}`
      );

      logger.info("[Task Recovery Result]", value.hash, `开始清理元文件和录制文件`);

      try {
        fs.rmSync(key);
        fs.rmSync(value.merged_record_file);

        logger.info("[Task Recovery Result]", value.hash, `清理元文件和录制文件完成✅`);
      } catch (error) {
        logger.error("[Task Recovery]", value.hash, `清理元文件和录制文件失败❌`, error);
      }
    } catch (error) {
      logger.error("[Task Recovery]", value.hash, `${value.hash} 投稿失败❌`, error);
    }
  }
}

export async function taskRecovery() {
  const ftp = new FileTreeParse(process.env.SAVE_RECORD_FOLDER!);

  const result = ftp.parse();

  logger.info("[Task Recovery]", "文件树解析完成");

  logger.info("[Task Recovery Result]", `未处理的录制元文件数: ${result.recordMeteFiles.length}`);
  logger.info("[Task Recovery Result]", `未处理的上传元文件数: ${result.uploadMeteFiles.length}`);
  logger.info("[Task Recovery Result]", `未处理的录制文件数: ${result.recordFiles.length}`);
  logger.info(
    "[Task Recovery Result]",
    `未处理的Merged录制文件数: ${result.mergedRecordFiles.length}`
  );
  logger.info("[Task Recovery Result]", `未知目录数: ${result.unknownDir.length}`);
  logger.info("[Task Recovery Result]", `未知文件数: ${result.unknownFile.length}`);

  if (process.env.DEBUG_NO_DELETE_RECORD_FILE) {
    logger.warn("[Task Recovery]", "警告： DEBUG_NO_DELETE_RECORD_FILE 开启，已禁用 Task Recovery");
    return;
  }
  await checkRecordMetaCanReused(result.recordMeteFilesMap);
  await recoverUpload(result.uploadMeteFilesMap);
}
