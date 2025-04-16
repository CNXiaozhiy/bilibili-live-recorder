import dotenv from "dotenv";
import { resolve } from "path";

/**
 * @description:初始化环境变量
 * @Date: 2025-3-22
 * @Author: XzY
 */
(function initEnv() {
  const customPath = resolve(process.cwd(), `.env.${process.env.NODE_ENV}`);
  dotenv.config({ path: customPath });
})();

export default process.env;
