import logger from "@/logger";
import fs from "fs";
import EventEmitter from "events";
import bilibiliStore from "@/store/bilibili";
import BilibiliUtils from "@/utils/bilibili";
import {
  AutoUploaderEvents,
  BilibiliAutoUploaderOptions,
  LiveRecoderStat,
  UploadFileMeta,
} from "@/types/bilibili";
import path from "path";

export default class BilibiliAutoUploader extends EventEmitter<AutoUploaderEvents> {
  private autoClean: boolean;

  get uploaderInstance() {
    return bilibiliStore.state.publicUploader;
  }

  constructor(private options: BilibiliAutoUploaderOptions) {
    super();

    this.autoClean = !!options.autoClean;
    this.installListener();
  }

  private installListener() {
    const recorder = this.options.liveRecorder;
    recorder.on("rec-end", async (mergedFilePath) => this._upload(mergedFilePath));
  }

  private async _upload(file: string) {
    try {
      const options = await BilibiliUtils.generateUploadrOptions(
        this.options.roomId,
        this.options.liveRecorder.stat,
        file
      );

      // 创建Meta文件

      const _hash = this.options.liveRecorder.recHash!;
      const _stat = this.options.liveRecorder.stat as Required<LiveRecoderStat>;

      const metaFilePath = path.join(path.dirname(file), `${_hash}.upload.meta.json`);

      const meta: UploadFileMeta = {
        type: "auto-uploader",
        version: process.env.META_FILE_VERSION!,
        merged_record_file: file,
        room_id: this.options.roomId,
        live_start_time: _stat.startTime.getTime(),
        hash: _hash,
        liveRecoderStat: _stat,
        uploaderOptions: options,
      };

      fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2));

      const task = this.uploaderInstance.createTask(options);
      this.emit("upload-start", task.id);
      const result = await task.upload();
      this.emit("upload-success", result);

      if (!process.env.DEBUG_NO_DELETE_RECORD_FILE) fs.unlinkSync(metaFilePath);

      if (this.autoClean) {
        if (process.env.DEBUG_NO_DELETE_RECORD_FILE) return;

        fs.unlink(file, (err) => {
          if (err) {
            logger.warn("[Bili Auto Uploader]", "清理录制文件失败", err);
          } else {
            logger.info("[Bili Auto Uploader]", "清理录制文件成功");
          }
        });
      }
    } catch (e) {
      this.emit("upload-error", e);
    }
  }
}
