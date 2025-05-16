import logger from "@/logger";
import fs from "fs";

fs.readdirSync(process.cwd()).forEach((file) => {
  if (file.startsWith("temp-") && fs.statSync(file).isDirectory())
    fs.rmdir(file, (err) => {
      if (err) logger.error(err);
    });
});
