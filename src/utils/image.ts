import fs from "fs";
import path from "path";

export default class ImageUtils {
  static toBase64(inputPath: string): string {
    return fs.readFileSync(inputPath, "base64");
  }
}
