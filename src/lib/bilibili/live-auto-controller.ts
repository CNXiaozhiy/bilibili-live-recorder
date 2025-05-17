import {
  LiveAutoControllerEvents,
  LiveAutoRecorderOptions,
  LiveRecoderStat,
} from "@/types/bilibili";
import BilibiliLiveMonitor from "./live-monitor";
import BilibiliLiveRecorder from "./live-recorder";
import BilibiliUtils from "@/utils/bilibili";
import { createTask } from "@/gInstance/uploader";
import EventEmitter from "events";
import logger from "@/logger";
import {
  createRecordMetaFile,
  createUploadMetaFile,
  deleteMetaFile,
  updateRecordMetaFile,
} from "@/utils/meta-file";
import fs from "fs";

// Ac -> auto controller

export default class BilibiliLiveAutoController extends EventEmitter<LiveAutoControllerEvents> {
  public roomId: number;
  public liveMonitor: BilibiliLiveMonitor;
  public liveRecorder: BilibiliLiveRecorder;

  private options: LiveAutoRecorderOptions;

  constructor(options: LiveAutoRecorderOptions) {
    super();

    this.options = options;
    this.roomId = typeof options.roomId === "string" ? parseInt(options.roomId) : options.roomId;

    this.liveMonitor = new BilibiliLiveMonitor(options);
    this.liveRecorder = new BilibiliLiveRecorder(options);

    this.installListener();
    this.liveMonitor.startMonitor();
  }

  private installListener() {
    let recordMetaFilePath: string;

    this.liveMonitor.on("live-start", () => {
      this.liveRecorder.rec();
    });

    this.liveMonitor.on("status-change", (roomInfo) => {
      logger.info(
        "[Live Auto Controller]",
        `房间 ${this.roomId} 状态变化`,
        BilibiliUtils.transformLiveStatus(roomInfo.live_status)
      );
    });

    this.liveRecorder.on("rec-start", (hash) => {
      const roomInfo = this.liveMonitor.roomInfoBefore!;
      recordMetaFilePath = createRecordMetaFile(hash, this.options.saveRecordFolder, {
        record_files: [],
        room_id: this.roomId,
        live_start_time: new Date(roomInfo.live_time).getTime(),
        start_time: this.liveRecorder.stat.startTime!.getTime(),
        end_time: null,
        live_room_info: roomInfo,
      });
    });

    this.liveRecorder.on("rec-stoping", (hash) => {
      logger.debug("[Live Auto Controller]", `${hash} recorder stoping...`);
      updateRecordMetaFile(hash, this.options.saveRecordFolder, { end_time: Date.now() });
    });

    this.liveRecorder.on("segment-change", (hash, newSegmentFiles) => {
      logger.debug("[Live Auto Controller]", `${hash} recorder segment change`, newSegmentFiles);
      updateRecordMetaFile(hash, this.options.saveRecordFolder, { record_files: newSegmentFiles });
    });

    this.liveRecorder.on("rec-end", (hash, mergedFilePath) => {
      logger.debug("[Live Auto Controller]", `${hash} recorder end`, mergedFilePath);
      deleteMetaFile(recordMetaFilePath);
      this.startUpload(hash, mergedFilePath);
    });

    // this.liveMonitor.on("live-end", () => {
    //   this.liveRecorder.stop();
    // });
  }

  private async startUpload(hash: string, mergedFilePath: string) {
    const options = await BilibiliUtils.generateUploadrOptions(
      this.roomId,
      this.liveRecorder.stat,
      this.liveMonitor.roomInfoBefore!,
      mergedFilePath
    );

    const uploadMetaFilePath = createUploadMetaFile(hash, this.options.saveRecordFolder, {
      merged_record_file: mergedFilePath,
      room_id: this.roomId,
      live_start_time: new Date(this.liveMonitor.roomInfoBefore!.live_time).getTime(),
      live_recoder_stat: this.liveRecorder.stat as Required<LiveRecoderStat>,
      uploader_options: options,
    });

    const { id, upload } = await createTask(options, this.roomId);

    this.emit("upload-start", id);

    try {
      logger.info("[Live Auto Controller]", `开始上传 TaskID: ${id}`);
      const { aid, bvid } = await upload();
      this.emit("upload-success", { aid, bvid });
      logger.info("[Live Auto Controller]", `上传成功 ✅ -> bvid: ${bvid}`);

      deleteMetaFile(uploadMetaFilePath);
      fs.rmSync(mergedFilePath);
    } catch (error) {
      this.emit("upload-error", error);
    }
  }

  destroy() {
    this.liveMonitor.destroy();
    this.liveRecorder.destroy();
  }
}
