import logger from "@/logger";
import { FileMeta, RecordFileMeta, UploadFileMeta } from "@/types/bilibili";
import fs from "fs";
import path from "path";

export default class FileTreeParse {
  directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }

  static ascension(metaFilePath: string) {
    return false;
  }

  static verify(metaFilePath: string, type?: FileMeta["type"]) {
    const json: FileMeta = JSON.parse(fs.readFileSync(metaFilePath).toString("utf-8"));

    if (!json.type || typeof json.type !== "string") {
      logger.warn("[File Tree Parse - Meta Verify]", `元文件 ${metaFilePath} 格式有误`);
      fs.unlinkSync(metaFilePath);
      return null;
    } else if (json.type !== "live-recorder" && json.type !== "auto-uploader") {
      logger.warn("[File Tree Parse - Meta Verify]", `元文件 ${metaFilePath} 类型不支持`);
      fs.unlinkSync(metaFilePath);
      return null;
    } else if (json.version !== process.env.META_FILE_VERSION!) {
      logger.warn(
        "[File Tree Parse - Meta Verify]",
        `元文件 ${metaFilePath} 版本不匹配, 当前支持的版本是 ${process.env.META_FILE_VERSION}, 但是元文件的版本是 ${json.version}`
      );

      if (FileTreeParse.ascension(metaFilePath)) {
        logger.info("[File Tree Parse - Meta Verify]", `元文件 ${metaFilePath} 版本提升成功`);
        return json;
      } else {
        logger.warn(
          "[File Tree Parse - Meta Verify]",
          `元文件 ${metaFilePath} 版本提升失败, 删除元文件`
        );
        // 无法提升
        fs.unlinkSync(metaFilePath);
        return null;
      }
    }

    if (type && json.type !== type) {
      return null;
    }

    return json;
  }

  parse() {
    if (!fs.existsSync(this.directory) || !fs.statSync(this.directory).isDirectory())
      throw new Error("目录不存在或不是文件夹");

    // 开始解析元数据文件
    const files = fs.readdirSync(this.directory);

    const recordMeteFiles: string[] = [];
    const uploadMeteFiles: string[] = [];

    const recordFiles: string[] = [];
    const mergedRecordFiles: string[] = [];

    const recordMeteFilesMap = new Map<string, RecordFileMeta>();
    const uploadMeteFilesMap = new Map<string, UploadFileMeta>();

    let unknownDir: string[] = [];
    let unknownFile: string[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(this.directory, file);

        if (fs.statSync(filePath).isDirectory() && file !== "recovery") {
          unknownDir.push(filePath);
          continue;
        }
        if (!file.endsWith(".meta.json")) {
          unknownFile.push(filePath);
          continue;
        }

        const json = FileTreeParse.verify(filePath);
        if (!json) {
          unknownFile.push(filePath);
          continue;
        }

        if (json.type === "live-recorder") {
          if (!json.record_files || !Array.isArray(json.record_files))
            throw new Error(`元文件 ${file} 格式有误`);

          json.record_files.forEach((recordFile) => {
            if (!fs.existsSync(recordFile) || !fs.statSync(recordFile).isFile())
              throw new Error(`元文件 ${recordFile} 原始录像文件丢失或文件格式错误`);
          });

          recordMeteFilesMap.set(filePath, json);
          recordMeteFiles.push(filePath);
          recordFiles.push(...json.record_files);
        } else if (json.type === "auto-uploader") {
          if (!json.merged_record_file || typeof json.merged_record_file !== "string")
            throw new Error(`元文件 ${file} 格式有误`);

          if (!fs.existsSync(json.merged_record_file)) {
            throw new Error(`元文件 ${file} 原始合并录像文件丢失或文件格式错误`);
          }

          uploadMeteFilesMap.set(filePath, json);
          uploadMeteFiles.push(filePath);
          mergedRecordFiles.push(json.merged_record_file);
        }
      } catch (e) {
        logger.error(`元文件 ${file} 解析失败: `, e);
        continue;
      }
    }

    unknownFile = unknownFile.filter((file) => !recordFiles.includes(file));

    return {
      recordMeteFiles,
      uploadMeteFiles,
      recordFiles,
      mergedRecordFiles,
      unknownDir,
      unknownFile,
      recordMeteFilesMap,
      uploadMeteFilesMap,
    };
  }
}
