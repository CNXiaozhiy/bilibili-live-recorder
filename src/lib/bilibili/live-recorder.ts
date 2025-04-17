import fs from "fs";
import path from "path";
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
} from "@/types/bilibili";

// 日志审计
import logger from "@/logger";

const FFMPEG_BIN_FOLDER = process.env.FFMPEG_BIN_FOLDER!;
ffmpeg.setFfmpegPath(path.join(FFMPEG_BIN_FOLDER, "./ffmpeg"));
ffmpeg.setFfprobePath(path.join(FFMPEG_BIN_FOLDER, "./ffprobe"));
ffmpeg.setFlvtoolPath(path.join(FFMPEG_BIN_FOLDER, "./flvtool"));

export default class BilibiliLiveRecorder extends EventEmitter<LiveRecoderEvents> {
  public roomId;
  private saveRecordFolder;
  private recCommand: ffmpeg.FfmpegCommand | null = null;
  private segmentFiles: string[] = [];

  public recStatus = Bilibili.RecorderStatus.NOT_RECORDING;
  public recProgress: FfmpegCommandProgress | null = null;
  public stat: LiveRecoderStat = {};

  // temp variable
  private _froceStop = false;

  get segIndex() {
    return this.segmentFiles.length;
  }

  constructor(options: LiveRecorderOptions) {
    super();
    this.roomId = options.roomId;
    this.saveRecordFolder = options.saveRecordFolder;
  }

  private _generateRecordFilePath(): string {
    return path.join(
      this.saveRecordFolder,
      `${this.roomId}_${moment().format("YYYY-MM-DD_HH-mm-ss")}.flv`
    );
  }

  private _generateMergedFilePath(): string {
    return path.join(
      this.saveRecordFolder,
      `${this.roomId}_merged_${moment().format("YYYY-MM-DD_HH-mm-ss")}.flv`
    );
  }

  private _stopRec() {
    const onFinlish = (mergedFilePath: string) => {
      this.emit("rec-end", mergedFilePath);
      logger.info("[Live Recorder]", `房间 ${this.roomId} 停止录制成功`);
    };
    const onError = (error: unknown) => {
      this.emit("rec-merge-error", error);
      logger.error("[Live Recorder]", `房间 ${this.roomId} 合并分片失败: ${error}`);
    };
    const onFinally = () => {
      this.recStatus = Bilibili.RecorderStatus.NOT_RECORDING;
      this._CleanAfterStop();
    };

    logger.info("[Live Recorder]", `房间 ${this.roomId} 正在停止录制`);

    this.stat.endTime = new Date();
    this.recStatus = Bilibili.RecorderStatus.STOPPING;

    this._mergeSegmentFiles().then(onFinlish).catch(onError).finally(onFinally);
  }

  private _CleanAfterStop() {
    this.segmentFiles = [];
    this.recCommand = null;
    this.recProgress = null;
  }

  private _mergeSegmentFiles() {
    this.cleanNullSegmentFiles();
    if (this.segmentFiles.length === 1) {
      const mergedFilePath = this._generateMergedFilePath();
      fs.renameSync(this.segmentFiles[0], mergedFilePath);
      return Promise.resolve(mergedFilePath);
    }
    return this._ffmpegConcat(this.segmentFiles, this._generateMergedFilePath());
  }

  private _ffmpegConcat(inputFileList: string[], outputPath: string, autoDelete: boolean = true) {
    const inputListFilePath = path.join(
      this.saveRecordFolder,
      `input_list_${this.roomId}_${Date.now()}.txt`
    );

    const inputListContent = inputFileList.map((file) => `file '${file}'`).join("\n");
    fs.writeFileSync(inputListFilePath, inputListContent);

    return new Promise<string>((resolve, reject) => {
      ffmpeg()
        .input(inputListFilePath)
        .inputOptions("-safe 0")
        .inputFormat("concat")
        .outputOptions("-c copy")
        .output(outputPath)
        .on("end", () => {
          fs.unlinkSync(inputListFilePath);
          if (autoDelete) inputFileList.forEach(fs.unlinkSync);
          resolve(outputPath);
        })
        .on("error", (err) => {
          fs.unlinkSync(inputListFilePath);
          reject(err);
        })
        .run();
    });
  }

  private _firstRec() {
    getLiveRoomInfo(this.roomId).then((resp) => (this.stat.liveRoomInfo = resp));
    this.stat.startTime = new Date();
    this.stat.endTime = undefined;
    this.recProgress = null;
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

    this.recCommand = ffmpeg(liveStreamUrl)
      .addInputOption(
        "-headers",
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36\r\nReferer: https://live.bilibili.com/"
      )
      .output(outputFilePath)
      .outputOptions("-c copy");

    this.recCommand
      .once("start", () => {
        this.segmentFiles.push(outputFilePath);
        if (this.segmentFiles.length === 1) this._firstRec();
        this.recStatus = Bilibili.RecorderStatus.RECORDING;
        this.emit("rec-start");

        logger.info("[Live Recorder]", `房间 ${this.roomId} 开始录制`);
      })
      .once("error", (err) => {
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

  public destroy() {
    this.stop();
    this.removeAllListeners();
  }
}
