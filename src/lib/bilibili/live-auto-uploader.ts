import logger from "@/logger";
import fs from "fs";
import EventEmitter from "events";
import bilibiliStore from "@/store/bilibili";
import BilibiliUtils from "@/utils/bilibili";
import { AutoUploaderEvents, BilibiliAutoUploaderOptions } from "@/types/bilibili";

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
      const task = this.uploaderInstance.createTask(
        await BilibiliUtils.generateUploadrOptions(this.options.liveRecorder, file)
      );
      this.emit("upload-start", task.id);
      const result = await task.upload();
      this.emit("upload-success", result);

      if (this.autoClean) {
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
