import "@/utils/env";
import logger from "@/logger";
logger.logo();

// 分服务
import "./env";

// 其他分服务

// 初始化 Cache Pool
import "@/store/pool";
import "@/store/bilibili";
