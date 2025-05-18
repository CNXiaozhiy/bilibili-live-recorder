import Log4js from "log4js";
import logo from "./logo";

Log4js.configure({
  appenders: {
    out: { type: "stdout" },
    app: {
      type: "dateFile",
      filename: "logs/app.log",
      encoding: "utf-8",
      pattern: "yyyy-MM-dd",
      maxLogSize: 10485760,
      numBackups: 2,
      keepFileExt: true,
      alwaysIncludePattern: true,
      compress: true,
    },
    http: {
      type: "dateFile",
      filename: "logs/http.log",
      encoding: "utf-8",
      pattern: "yyyy-MM-dd",
      maxLogSize: 10485760,
      numBackups: 2,
      keepFileExt: true,
      alwaysIncludePattern: true,
      compress: true,
    },
  },
  categories: {
    default: { appenders: ["out", "app"], level: "debug" },
    http: { appenders: ["http"], level: "debug" },
  },
});

console.log(logo);
console.log("\x1B[4m" + "XzBLR Version: " + "\x1B[31m" + process.env.APP_VERSION + "\x1B[0m");
console.log("\x1B[4m" + `Github: https://github.com/CNXiaozhiY/bilibili-live-recorder` + "\x1B[0m" + "\n");

export default Log4js.getLogger("app");
export const httpLogger = Log4js.getLogger("http");
