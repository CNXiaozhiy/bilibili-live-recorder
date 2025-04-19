import XzLogger from "@/utils/xz-logger";
import logo from "./logo";

class Logger extends XzLogger {
  constructor() {
    super({ level: "TRACE" });
  }

  logo() {
    console.log(logo);
    console.log("\x1B[4m" + "XzBLR Version: " + "\x1B[31m" + process.env.APP_VERSION + "\x1B[0m");
    console.log(
      "\x1B[4m" + `Github: https://github.com/CNXiaozhiY/bilibili-live-recorder` + "\x1B[0m" + "\n"
    );
  }
}

const logger = new Logger();

export default logger;
