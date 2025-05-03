import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

// 日志审计
import logger from "@/logger";

const FFMPEG_BIN_FOLDER = process.env.FFMPEG_BIN_FOLDER!;
ffmpeg.setFfmpegPath(path.join(FFMPEG_BIN_FOLDER, "./ffmpeg"));
ffmpeg.setFfprobePath(path.join(FFMPEG_BIN_FOLDER, "./ffprobe"));
ffmpeg.setFlvtoolPath(path.join(FFMPEG_BIN_FOLDER, "./flvtool"));

type FfmpegConcatOptions = {
  inputFileList: string[];
  outputPath: string;
  autoDelete?: boolean;
};

const deleteRecordFile = (file: string) => {
  if (process.env.DEBUG_NO_DELETE_RECORD_FILE) return;
  try {
    fs.unlinkSync(file);
  } catch (error) {
    logger.error(`删除录制文件失败：${file}`, error);
  }
};

function addNecessaryInfo(cmd: ffmpeg.FfmpegCommand): ffmpeg.FfmpegCommand {
  return cmd.addInputOption(
    "-headers",
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36\r\nReferer: https://live.bilibili.com/"
  );
}

const FfpmegUtils = {
  rec(input: string, output: string): ffmpeg.FfmpegCommand {
    return addNecessaryInfo(ffmpeg(input))
      .addInputOption(
        "-headers",
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36\r\nReferer: https://live.bilibili.com/"
      )
      .output(output)
      .outputOptions("-c copy");
  },
  concat({ inputFileList, outputPath, autoDelete = true }: FfmpegConcatOptions): Promise<string> {
    const inputListFilePath = path.join(path.dirname(outputPath), `input_list_${Date.now()}.txt`);

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
          if (autoDelete) inputFileList.forEach(deleteRecordFile);
          resolve(outputPath);
        })
        .on("error", (err) => {
          fs.unlinkSync(inputListFilePath);
          reject(err);
        })
        .run();
    });
  },
  captureScreenshot(streamUrl: string, outputPath: string, quality = 2): Promise<void> {
    return new Promise((resolve, reject) => {
      addNecessaryInfo(ffmpeg(streamUrl))
        .inputOptions([`-timeout ${30 * 1e6}`])
        .output(outputPath)
        .outputOptions(["-vframes 1", "-q:v " + quality])
        .native()
        .noAudio()
        .on("start", (cmd) => logger.debug("[Ffmpeg Capture] start", `执行命令: ${cmd}`))
        .on("error", (err) => reject(new Error(`截图失败: ${err.message}`)))
        // .on("stderr", (line) => logger.info("[Ffmpeg Capture] stderr", line))
        .on("end", () => resolve())
        .run();
    });
  },
};

export default FfpmegUtils;
