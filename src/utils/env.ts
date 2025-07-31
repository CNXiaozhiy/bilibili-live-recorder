import dotenv from "dotenv";
import { resolve } from "path";
import { getPackageJson } from "./package";

/**
 * @description:初始化环境变量
 * @Date: 2025-3-22
 * @Author: XzY
 */
(function initEnv() {
  const customPath = resolve(process.env.ENV_FILE_FLODER || resolve(process.cwd(), "config"), `.env.${process.env.NODE_ENV}`);
  dotenv.config({ path: customPath });
  const packageJson = getPackageJson();
  process.env.APP_VERSION = packageJson["version"];
  process.env.META_FILE_VERSION = packageJson["meta-file-version"];
})();

export default process.env;
