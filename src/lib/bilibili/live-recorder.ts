import fs from "fs";
import path from "path";
import crypto from "crypto";
import ffmpeg from "fluent-ffmpeg";
import moment from "moment";
import EventEmitter from "events";
import { getLiveRoomInfo, getLiveStreamUrl, isLiveStreamAvailable } from "./api";
import {
  LiveRecoderEvents,
  Bilibili,
  LiveRecoderStat,
  FfmpegCommandProgress,
  LiveRecorderOptions,
  RecordFileMeta,
} from "@/types/bilibili";

import logger from "@/logger";
import FileNameUtils from "@/utils/file-name";
import FfpmegUtils from "@/utils/ffmpeg";
import FileTreeParse from "./file-tree-parse";
import { shutdownManager } from "@/utils/shutdown-manager";

export default class BilibiliLiveRecorder extends EventEmitter<LiveRecoderEvents> {
  public roomId;
  private saveRecordFolder;
  private recCommand: ffmpeg.FfmpegCommand | null = null;
  private segmentFiles: string[] = [];

  public recStatus = Bilibili.RecorderStatus.NOT_RECORDING;
  public recProgress: FfmpegCommandProgress | null = null;
  public stat: LiveRecoderStat = {};
  public recHash: string | null = null;

  // temp variable
  private _froceStop = false;

  get segIndex() {
    return this.segmentFiles.length;
  }

  constructor(options: LiveRecorderOptions) {
    super();
    this.roomId = typeof options.roomId === "number" ? options.roomId : parseInt(options.roomId);
    this.saveRecordFolder = options.saveRecordFolder;

    shutdownManager.registerCleanupTask(() => {
      return new Promise<void>((resolve) => {
        if (!this.recCommand) return resolve();
        this.recCommand.removeAllListeners();
        this.recCommand.addListener("end", () => {
          logger.info("[Live Recorder Cleanup]", "Command End -> " + this.recHash);
          resolve();
        });
        this._stop();
      });
    });
  }

  private getRecordFileMetaFilePath() {
    return path.join(this.saveRecordFolder, `${this.recHash}.meta.json`);
  }

  private _generateRecordFilePath(): string {
    return FileNameUtils.generateRecordFilePath(this.saveRecordFolder, this.roomId);
  }

  private _recoverRecorderState() {
    const metaFilePath = this.getRecordFileMetaFilePath();
    if (!fs.existsSync(metaFilePath)) return;
    const metaData = FileTreeParse.verify(metaFilePath, "live-recorder") as RecordFileMeta | null;
    if (!metaData) return;

    this.stat.startTime = new Date(metaData.recorder_stat.start_time);
    this.segmentFiles = metaData.record_files.filter((file) => fs.existsSync(file));

    logger.debug("[Live Recorder Recovery]", `恢复部分录制信息成功：`, {
      hash: this.recHash,
      roomId: this.roomId,
      recStartTime: this.stat.startTime,
      segmentFiles: this.segmentFiles,
    });
  }

  private _createRecordFileMetaFile() {
    if (!this.stat.liveRoomInfo || !this.recHash) throw new Error("缺少必要的信息");

    const metaFilePath = this.getRecordFileMetaFilePath();

    const metaData: RecordFileMeta = {
      type: "live-recorder",
      version: process.env.META_FILE_VERSION!,
      record_files: this.segmentFiles,
      room_id: this.roomId,
      live_start_time: new Date(this.stat.liveRoomInfo.live_time).getTime(),
      hash: this.recHash,

      recorder_stat: {
        start_time: this.stat.startTime?.getTime() || Date.now(),
        end_time: null,
        live_room_info: this.stat.liveRoomInfo,
      },
      live_room_info: this.stat.liveRoomInfo,
    };

    fs.writeFileSync(metaFilePath, JSON.stringify(metaData, null, 2));

    return metaFilePath;
  }

  private _updateRecordFileMeta() {
    const metaFilePath = this.getRecordFileMetaFilePath();
    if (!fs.existsSync(metaFilePath)) return;
    const metaData = FileTreeParse.verify(metaFilePath, "live-recorder") as RecordFileMeta | null;
    if (!metaData) return;

    metaData.record_files = this.segmentFiles;
    metaData.recorder_stat.end_time = this.stat.endTime?.getTime() || null;

    fs.writeFileSync(metaFilePath, JSON.stringify(metaData, null, 2));
  }

  private _generateMergedFilePath(): string {
    return FileNameUtils.generateMergedFilePath(this.saveRecordFolder, this.roomId);
  }

  private _stopRec() {
    const onFinlish = (mergedFilePath: string) => {
      if (!process.env.DEBUG_NO_DELETE_RECORD_FILE) this._deleteRecordFileMeta(); // 清理 Meta
      this.emit("rec-end", mergedFilePath);
      logger.info("[Live Recorder]", `房间 ${this.roomId} 停止录制成功`);
    };
    const onError = (error: unknown) => {
      this.emit("rec-merge-error", error);
      logger.error("[Live Recorder]", `房间 ${this.roomId} 合并分片失败: ${error}`);
    };
    const onFinally = () => {
      this.recStatus = Bilibili.RecorderStatus.NOT_RECORDING;
      this._cleanAfterStop();
    };

    logger.info("[Live Recorder]", `房间 ${this.roomId} 正在停止录制`);

    this.stat.endTime = new Date();
    this.recStatus = Bilibili.RecorderStatus.STOPPING;

    this._mergeSegmentFiles().then(onFinlish).catch(onError).finally(onFinally);
  }

  private _cleanAfterStop() {
    this.segmentFiles = [];
    this.recCommand = null;
    this.recProgress = null;
  }

  private _deleteRecordFile(file: string) {
    if (process.env.DEBUG_NO_DELETE_RECORD_FILE) return;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  private _deleteRecordFileMeta() {
    const metaFilePath = this.getRecordFileMetaFilePath();

    if (fs.existsSync(metaFilePath)) fs.unlinkSync(metaFilePath);
  }

  private _mergeSegmentFiles() {
    this.cleanNullSegmentFiles();
    if (this.segmentFiles.length === 1) {
      const mergedFilePath = this._generateMergedFilePath();
      fs.renameSync(this.segmentFiles[0], mergedFilePath);
      return Promise.resolve(mergedFilePath);
    }

    return FfpmegUtils.concat({
      inputFileList: this.segmentFiles,
      outputPath: this._generateMergedFilePath(),
    });
  }

  private async _firstRec() {
    this.stat.liveRoomInfo = await getLiveRoomInfo(this.roomId);
    this.stat.startTime = new Date();
    this.stat.endTime = undefined;
    this.recProgress = null;

    const _liveStartTime = new Date(this.stat.liveRoomInfo.live_time).getTime();
    this.recHash = crypto
      .createHash("md5")
      .update(`${this.roomId}_${_liveStartTime}`)
      .digest("hex");

    const metaFilePath = this.getRecordFileMetaFilePath();

    if (fs.existsSync(metaFilePath)) {
      logger.info(
        "[Live Recorder Recovery]",
        `房间 ${this.roomId} 已经有录制信息，可能出现了意外情况，正在恢复`
      );
      this._recoverRecorderState();
    } else {
      this._createRecordFileMetaFile();
    }
  }

  private cleanNullSegmentFiles() {
    for (let i = 0; i < this.segmentFiles.length; i++) {
      const file = this.segmentFiles[i];
      if (!fs.existsSync(file)) {
        this.segmentFiles.splice(i, 1);
        i--;
      } else if (fs.statSync(file).size === 0) {
        fs.unlinkSync(file);
        this.segmentFiles.splice(i, 1);
        i--;
      }
    }
  }

  private retryRec(timeout = 5000) {
    setTimeout(() => this.rec(), timeout);
  }

  public stop() {
    this._froceStop = true;
    this._stop();
  }

  private _stop() {
    if (!this.recCommand) return;
    const stdin: NodeJS.WritableStream = (this.recCommand as any).ffmpegProc?.stdin;
    stdin.write("q");
  }

  public async rec() {
    // 判断是否强制停止录制
    if (this.recStatus === Bilibili.RecorderStatus.RECORDING && this._froceStop) {
      this._froceStop = false;
      this._stopRec();
      return;
    }

    // 判断直播间是否开播
    if ((await getLiveRoomInfo(this.roomId)).live_status !== Bilibili.LiveRoomStatus.LIVE) {
      if (this.recStatus === Bilibili.RecorderStatus.RECORDING) this._stopRec();
      return;
    }
    // 获取直播流
    let liveStreamUrl;
    // 判断直播流是否可用
    try {
      const liveStreamUrls = await getLiveStreamUrl(this.roomId);
      for (let i = 0; i < liveStreamUrls.length; i++) {
        if (await isLiveStreamAvailable(liveStreamUrls[i])) {
          liveStreamUrl = liveStreamUrls[i];
          break;
        }
        if (!liveStreamUrl) throw new Error("无可用的直播流");
      }
    } catch (error) {
      logger.warn("[Live Recorder]", `获取直播流失败: ${error}`);
      this.retryRec();
      return;
    }

    const outputFilePath = this._generateRecordFilePath();

    this.recCommand = FfpmegUtils.rec(liveStreamUrl!, outputFilePath);

    this.recCommand
      .once("start", async () => {
        if (this.segmentFiles.length === 0) await this._firstRec();
        this.segmentFiles.push(outputFilePath);

        this._updateRecordFileMeta();

        this.recStatus = Bilibili.RecorderStatus.RECORDING;
        this.emit("rec-start");

        logger.info("[Live Recorder]", `房间 ${this.roomId} 开始录制`);

        setTimeout(() => {
          if (!fs.existsSync(outputFilePath)) {
            // this.recCommand?.emit("error", new Error("录制文件长时间未生成"));
            logger.warn("[Live Recorder]", `房间 ${this.roomId} 录制文件长时间未生成`);
            this.recCommand?.kill("SIGKILL");
            this.retryRec();
          }
        }, 60 * 1000);
      })
      .once("error", (err) => {
        logger.error("[Live Recorder]", `房间 ${this.roomId} 录制失败: ${err}`);
        this.emit("rec-error", err);
        this.retryRec();
      })
      .once("end", () => this.retryRec());

    this.recCommand.on("progress", (progress) => {
      this.recProgress = progress;
      this.emit("rec-progress", progress);
    });

    this.recCommand.run();
  }

  public destroy(cleanFile: boolean = true) {
    this.removeAllListeners();
    this.recCommand?.removeAllListeners();
    this.recCommand?.on("error", () => {
      if (cleanFile) {
        this._deleteRecordFileMeta();
        this.segmentFiles.forEach(this._deleteRecordFile);
      }
      this.recCommand?.removeAllListeners();
    });
    this.recCommand?.kill("SIGKILL");
    this._cleanAfterStop();
  }
}
