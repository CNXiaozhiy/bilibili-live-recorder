import fs from "fs";
import crypto from "crypto";
import ffmpeg from "fluent-ffmpeg";
import EventEmitter from "events";
import { getLiveRoomInfo, getLiveStreamUrl, getAvailableLiveStream } from "./api";
import { LiveRecoderEvents, Bilibili, LiveRecoderStat, FfmpegCommandProgress, LiveRecorderOptions, RecordFileMeta } from "@/types/bilibili";

import logger from "@/logger";
import FileNameUtils from "@/utils/file-name";
import FfpmegUtils from "@/utils/ffmpeg";
import FileTreeParse from "./file-tree-parse";
import { shutdownManager } from "@/utils/shutdown-manager";
import { generateRecordMetaFilePath } from "@/utils/meta-file";
import { sleep } from "@/utils/promise";

const CHECK_FILE_EXIST_INTERVAL = 30 * 1000;
const CHECK_FILE_SIZE_INTERVAL = 60 * 1000;

export default class BilibiliLiveRecorder extends EventEmitter<LiveRecoderEvents> {
  public roomId;
  private saveRecordFolder;
  private recCommand: ffmpeg.FfmpegCommand | null = null;
  private segmentFiles: string[] = [];

  private recWatchDog: NodeJS.Timeout | null = null;
  private recWatchDog_lastFileSize = 0;

  public recStatus = Bilibili.RecorderStatus.NOT_RECORDING;
  public recProgress: FfmpegCommandProgress | null = null;
  public recDuration = 0;
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
        this.recCommand?.removeAllListeners();
        this.recCommand?.on("error", () => resolve());
        this.recCommand?.kill("SIGTERM");
      });
    });
  }

  private _generateRecordFilePath(): string {
    return FileNameUtils.generateRecordFilePath(this.saveRecordFolder, this.roomId);
  }

  private _generateMergedFilePath(): string {
    return FileNameUtils.generateMergedFilePath(this.saveRecordFolder, this.roomId);
  }

  private _recoverRecorderState() {
    const metaFilePath = generateRecordMetaFilePath(this.recHash!, this.saveRecordFolder);
    if (!fs.existsSync(metaFilePath)) return;
    const metaData = FileTreeParse.verify(metaFilePath, "live-recorder") as RecordFileMeta | null;
    if (!metaData) return;

    this.stat.startTime = new Date(metaData.start_time);
    this.segmentFiles = metaData.record_files.filter((file) => fs.existsSync(file));

    logger.debug("[Live Recorder Recovery]", `恢复部分录制信息成功：`, {
      hash: this.recHash,
      roomId: this.roomId,
      recStartTime: this.stat.startTime,
      segmentFiles: this.segmentFiles,
    });
  }

  private _stopRec() {
    if (!this.recCommand || this.recStatus === Bilibili.RecorderStatus.STOPPING) return;
    this._changeRecStatus(Bilibili.RecorderStatus.STOPPING);
    this.emit("rec-stoping", this.recHash!);
    this._froceStop = false;

    logger.debug("[Live Recorder]", `房间 ${this.roomId} _stopRec()`);

    logger.debug("[Live Recorder]", `stdin <- 'q' 已弃用`);
    // const stdin: NodeJS.WritableStream = (this.recCommand as any).ffmpegProc?.stdin;
    // if (stdin) stdin.write('q');

    this.recCommand?.removeAllListeners();
    this.recCommand?.on("error", () => {});
    this.recCommand?.kill("SIGTERM");

    const onFinlish = (mergedFilePath: string) => {
      this.emit("rec-end", this.recHash!, mergedFilePath, this.recDuration);
      logger.info(
        "[Live Recorder]",
        `房间 ${this.roomId} 停止录制成功, recHash: ${this.recHash}, mergedFilePath: ${mergedFilePath}, recDuration: ${this.recDuration}`
      );
    };
    const onError = (error: unknown) => {
      this.emit("rec-merge-error", error);
      logger.error("[Live Recorder]", `房间 ${this.roomId} 合并分片失败: ${error}`);
    };
    const onFinally = () => {
      this._changeRecStatus(Bilibili.RecorderStatus.NOT_RECORDING);
      this._cleanAfterStop();
    };

    logger.info("[Live Recorder]", `房间 ${this.roomId} 正在停止录制（合并分片）`);

    this.stat.endTime = new Date();

    this._mergeSegmentFiles().then(onFinlish).catch(onError).finally(onFinally);
  }

  private _mergeSegmentFiles() {
    Tools._cleanNullFiles(this.segmentFiles, true);

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

  private _clearRecWatchDog() {
    if (this.recWatchDog) {
      clearTimeout(this.recWatchDog);
      this.recWatchDog = null;
      this.recWatchDog_lastFileSize = 0;
    }
  }

  private _cleanAfterStop() {
    this.segmentFiles = [];
    this.recCommand = null;
    this.recProgress = null;
    this.recDuration = 0;
    this.stat = {};
  }

  private _deleteRecordFile(file: string) {
    if (process.env.DEBUG_NO_DELETE_RECORD_FILE) return;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  private _changeRecStatus(newStatus: Bilibili.RecorderStatus) {
    if (newStatus === Bilibili.RecorderStatus.NOT_RECORDING) this._clearRecWatchDog();
    this.recStatus = newStatus;
  }

  // 情况处理
  private async _handleRecFirstStart() {
    this._changeRecStatus(Bilibili.RecorderStatus.RECORDING);

    this.stat.startTime = new Date();
    this.stat.endTime = undefined;

    const liveRoomInfo = await getLiveRoomInfo(this.roomId);
    const liveStartTime = new Date(liveRoomInfo.live_time).getTime();
    this.recHash = crypto.createHash("md5").update(`${this.roomId}_${liveStartTime}`).digest("hex");

    this.emit("rec-start", this.recHash);

    const metaFilePath = generateRecordMetaFilePath(this.recHash, this.saveRecordFolder);

    if (fs.existsSync(metaFilePath)) {
      logger.info("[Live Recorder Recovery]", `房间 ${this.roomId} 已经存在录制信息，可能出现了意外情况，正在恢复`);
      this._recoverRecorderState();
    }
  }

  private _publicHandleRecEnd() {
    this._changeRecStatus(Bilibili.RecorderStatus.NOT_RECORDING);
    this.recDuration += Tools.timeToSeconds(this.recProgress!.timemark);
  }

  private async _handleRecError(err: unknown) {
    logger.debug("[Live Recorder]", `房间 ${this.roomId} -> _handleRecError`);
    this._publicHandleRecEnd();

    logger.trace("[Live Recorder]", "录制过程中出现意外的错误: ", err);
    logger.error("[Live Recorder]", `房间 ${this.roomId} 录制失败: ${err}`);
    this.emit("rec-error", err);
    this.retryRec();
  }

  private async _handleRecEnd() {
    logger.debug("[Live Recorder]", `房间 ${this.roomId} -> _handleRecEnd`);
    this._publicHandleRecEnd();

    logger.debug("[Live Recorder]", `房间 ${this.roomId} 录制被结束，正在核验是否为意外情况`);

    // 判断是否强制停止录制（不管是否是意外结束）
    if (this._froceStop) {
      logger.debug("[Live Recorder]", `房间 ${this.roomId} 正在强制停止录制`);
      this._stopRec();
      return;
    }

    for (let index = 0; index < 24; index++) {
      // 判断是否为意外的结束
      try {
        if ((await Tools.getLiveRoomLiveStatus(this.roomId)) === Bilibili.LiveRoomStatus.LIVE) {
          // 意外的录制结束
          logger.warn("[Live Recorder]", "意外的录制结束，正在重新录制");
          // 重新录制
          this.retryRec();
        } else {
          // 正常的录制结束
          logger.info("[Live Recorder]", "正常的录制结束，正在结束录制");
          // 结束录制
          this._stopRec();
        }
        return;
      } catch (error) {
        logger.error("[Live Recorder]", `房间 ${this.roomId} 意外的录制结束核验失败: ${error}`);
        logger.warn("[Live Recorder]", "尝试重新核验，共 24 次，当前第 " + (index + 1) + " 次");
        await sleep(5000);
      }
    }

    logger.warn("[Live Recorder]", `核验失败，结束录制`);
    this._stopRec();
  }

  public async rec() {
    if (this.recStatus === Bilibili.RecorderStatus.RECORDING) return;

    // 基础条件检查
    try {
      // 判断直播间是否开播
      if ((await Tools.getLiveRoomLiveStatus(this.roomId)) !== Bilibili.LiveRoomStatus.LIVE) {
        logger.warn("[Live Recorder]", `基础条件检查未通过: 直播间未开播`);
        return;
      } else {
        logger.debug("[Live Recorder]", `基础条件检查通过: 直播间已开播`);
      }
    } catch (error) {
      logger.warn("[Live Recorder]", `基础条件检查失败: ${error}，正在重试`);
      // 重试
      this.retryRec();
      return;
    }

    // 录制所需必要信息采集
    let liveStreamUrl;

    try {
      const liveStreamUrls = await getLiveStreamUrl(this.roomId);
      liveStreamUrl = await getAvailableLiveStream(liveStreamUrls);
      logger.debug("[Live Recorder]", `房间 ${this.roomId} 直播流采集成功: ${liveStreamUrl}`);
      if (!liveStreamUrl) throw new Error("无可用的直播流");
    } catch (error) {
      logger.warn("[Live Recorder]", `录制所需必要信息采集失败: ${error}，正在重试`);
      // 重试
      this.retryRec();
      return;
    }

    const outputFilePath = this._generateRecordFilePath();

    this.recCommand = FfpmegUtils.rec(liveStreamUrl, outputFilePath);

    this.recCommand
      .once("start", async () => {
        if (this.segmentFiles.length === 0) await this._handleRecFirstStart();

        this.segmentFiles.push(outputFilePath);

        this.emit("segment-change", this.recHash!, this.segmentFiles);

        logger.info("[Live Recorder]", `房间 ${this.roomId} 开始录制，当前分段：${this.segIndex}`);

        // 检查录制文件是否生成
        setTimeout(() => {
          if (!fs.existsSync(outputFilePath)) {
            // this.recCommand?.emit("error", new Error("录制文件长时间未生成"));
            logger.warn("[Live Recorder]", `房间 ${this.roomId} 录制文件长时间未生成`);
            this.recCommand?.removeAllListeners();
            this.recCommand?.kill("SIGTERM");
            this.segmentFiles.pop();
            this.recCommand?.emit("error", new Error("录制文件长时间未生成"));
          }
        }, CHECK_FILE_EXIST_INTERVAL);

        // 检查录制文件是否变化
        this.recWatchDog = setInterval(() => {
          const fileSize = fs.statSync(outputFilePath).size;

          if (this.recWatchDog_lastFileSize === fileSize) {
            // this.recCommand?.emit("error", new Error("录制文件长时间无变化"));
            logger.warn("[Live Recorder]", `房间 ${this.roomId} 录制文件长时间无变化，正在重新录制`);
            this.recCommand?.emit("error", new Error("录制文件长时间无变化"));
            this.recCommand?.kill("SIGTERM"); // 由于.once('error'), 这里不会被 _handleRecError 处理
            Tools._cleanNullFiles([outputFilePath], false);
            this._clearRecWatchDog();
          }
        }, CHECK_FILE_SIZE_INTERVAL);
      })
      .once("error", (e) => this._handleRecError(e))
      .once("end", () => this._handleRecEnd());

    this.recCommand.on("progress", (progress) => {
      this.recProgress = progress;
      this.emit("rec-progress", progress);
    });

    this.recCommand.run();
  }

  private retryRec(timeout = 5000) {
    if (this.recStatus === Bilibili.RecorderStatus.RECORDING) {
      logger.warn("[Live Recorder]", `出现逻辑错误：当前录制状态不符合RetryRec的逻辑，重试被忽略`);
      return;
    }
    setTimeout(() => this.rec(), timeout);
  }

  public stop() {
    this._froceStop = true;
    this._stopRec();
  }

  public destroy(cleanFile: boolean = true) {
    this.removeAllListeners();
    this.recCommand?.removeAllListeners();
    this.recCommand?.on("error", () => {
      if (cleanFile) {
        this.segmentFiles.forEach(this._deleteRecordFile);
      }
      this.recCommand?.removeAllListeners();
    });
    this.recCommand?.kill("SIGTERM");
    this._cleanAfterStop();
  }
}

class Tools {
  static async getLiveRoomLiveStatus(roomId: number): Promise<Bilibili.LiveRoomStatus> {
    return (await getLiveRoomInfo(roomId)).live_status;
  }

  /**
   * 删除空文件，或者也删除对应的数组成员
   * @param files
   * @param [changeArray=true]
   */
  static _cleanNullFiles(files: string[], changeArray: boolean = false) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!fs.existsSync(file)) {
        if (changeArray) files.splice(i, 1);
        i--;
      } else if (fs.statSync(file).size === 0) {
        fs.unlinkSync(file);
        if (changeArray) files.splice(i, 1);
        i--;
      }
    }
  }

  static timeToSeconds(timeStr: string) {
    const [hours, minutes, seconds] = timeStr.split(":").map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }
}
