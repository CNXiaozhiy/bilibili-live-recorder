import logger from "@/logger";
import axios from "axios";
import axiosRetry from "axios-retry";
import throttledQueue from "throttled-queue";

const throttle = throttledQueue(5, 1000);

const instance = axios.create({
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

axiosRetry(instance as any, {
  retries: 10,
  retryDelay: (retryCount) => retryCount * 1500,
  retryCondition: () => true,
  onRetry: (retryCount, error) => {
    logger.warn("请求失败, 重试次数:" + retryCount, error.response?.data);
  },
});

instance.interceptors.request.use(async (config) => {
  if (!config.headers["No-Throttleo"]) await new Promise<void>((resolve) => throttle(resolve));

  config.headers["User-Agent"] =
    config.headers["User-Agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
  config.headers["Referer"] = config.headers["Referer"] || "https://www.bilibili.com";
  config.headers["Origin"] = config.headers["Origin"] || "https://www.bilibili.com";

  return config;
});

export default instance;
