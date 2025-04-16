// utils/file-name

// 目的是为了统一文件名规范

import path from "path";
import moment from "moment";

const FileNameUtils = {
  generateRecordFilePath(dirname: string, sign: string | number, ext = "flv"): string {
    return path.join(dirname, `${sign}_${moment().format("YYYY-MM-DD_HH-mm-ss")}.${ext}`);
  },
  generateMergedFilePath(dirname: string, sign: string | number, ext = "flv"): string {
    return path.join(dirname, `${sign}_merged_${moment().format("YYYY-MM-DD_HH-mm-ss")}.${ext}`);
  },
};

export default FileNameUtils;
