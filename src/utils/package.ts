import fs from "fs";
import path from "path";

export function getPackageJson() {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
}
