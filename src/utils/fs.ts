// src/utils/fs.ts

import fs from "fs";
import path from "path";
import { v4 } from "uuid";
import { shutdownManager } from "./shutdown-manager";

const ERROR_DESTROYED = "FolderVersionManager 已销毁";

const globalTempFolderPath = fs.mkdtempSync(path.join(process.cwd(), "temp-"));

shutdownManager.registerCleanupTask(() => {
  fs.rmdirSync(globalTempFolderPath);
});

export class FsUtils {
  static copyFolderSync(from: string, to: string) {
    const sourcePath = path.resolve(from);
    const targetPath = path.resolve(to);

    const relativePath = path.relative(sourcePath, targetPath);
    if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      throw new Error(`目标路径 ${targetPath} 不能是源路径 ${sourcePath} 的子目录`);
    }

    fs.mkdirSync(targetPath, { recursive: true });
    for (const item of fs.readdirSync(sourcePath)) {
      const itemPath = path.join(sourcePath, item);
      const targetItemPath = path.join(targetPath, item);
      if (fs.statSync(itemPath).isDirectory()) {
        FsUtils.copyFolderSync(itemPath, targetItemPath);
      } else {
        fs.copyFileSync(itemPath, targetItemPath);
      }
    }
  }

  static cleanFolderSync(folderPath: string, ignoreFiles?: string[]) {
    fs.readdirSync(folderPath)
      .filter((item) => !ignoreFiles?.includes(item))
      .forEach((item) => {
        const itemPath = path.join(folderPath, item);
        fs.rmSync(itemPath, { recursive: true, force: true });
      });
  }

  static createTempFilePath(ext: string, tempFolderPath?: string): string {
    if (!tempFolderPath) tempFolderPath = globalTempFolderPath;
    return path.join(tempFolderPath, `${v4()}.tmp.${ext}`);
  }

  static get fs() {
    return fs;
  }
}

type VersionMeta = {
  version: string;
  timestamp: number;
  size: number;
};

export class FolderVersionManager {
  private readonly backupRoot: string;
  private readonly maxVersions: number;
  private destroyed = false;

  constructor(
    private readonly targetFolder: string,
    options?: {
      backupRoot?: string;
      maxVersions?: number;
    }
  ) {
    // 重解析
    this.targetFolder = path.resolve(targetFolder);

    // 参数校验
    if (!fs.existsSync(this.targetFolder)) {
      throw new Error(`目标文件夹不存在: ${targetFolder}`);
    }

    // 设置备份根目录（默认为目标文件夹同级目录）
    this.backupRoot = options?.backupRoot
      ? path.resolve(options.backupRoot)
      : path.join(path.dirname(targetFolder), `${path.basename(targetFolder)}_versions`);

    // 创建备份根目录
    fs.mkdirSync(this.backupRoot, { recursive: true });

    // 设置最大保留版本数
    this.maxVersions = options?.maxVersions || 5;
  }

  /**
   * 创建备份
   * @returns 版本号
   */
  public createBackup(): string {
    if (this.destroyed) throw new Error(ERROR_DESTROYED);

    this.validateTargetFolder();
    const versionId = this.generateVersionId();
    const backupPath = this.getVersionPath(versionId);

    // 检查备份路径是否合法
    const relative = path.relative(path.resolve(this.targetFolder), backupPath);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      throw new Error(`备份路径不能位于目标文件夹内部: ${backupPath}`);
    }

    // 执行复制
    FsUtils.copyFolderSync(this.targetFolder, backupPath);

    // 记录元数据
    this.writeMetadata(versionId);

    // 清理旧版本
    this.purgeOldVersions();

    return versionId;
  }

  /**
   * 回滚至指定版本
   * @param versionId 版本号
   */
  public rollback(versionId: string): void {
    if (this.destroyed) throw new Error(ERROR_DESTROYED);

    const backupPath = this.getVersionPath(versionId);

    // 校验版本是否存在
    if (!fs.existsSync(backupPath)) {
      throw new Error(`版本不存在: ${versionId}`);
    }

    // 备份当前状态（防止回滚失败导致数据丢失）
    const tempBackup = this.createTempBackup();

    try {
      this.cleanTargetFolder();

      FsUtils.copyFolderSync(backupPath, this.targetFolder);
    } catch (error: any) {
      // 回滚失败时恢复临时备份
      FsUtils.copyFolderSync(tempBackup, this.targetFolder);
      throw new Error(`回滚失败，已恢复原始状态: ${error.message}`);
    } finally {
      // 清理临时备份
      fs.rmSync(tempBackup, { recursive: true, force: true });
    }
  }

  /**
   * 列出所有版本
   * @returns 版本元数据[]
   */
  public listVersions(): VersionMeta[] {
    if (this.destroyed) throw new Error(ERROR_DESTROYED);

    return fs
      .readdirSync(this.backupRoot)
      .filter((name) => fs.statSync(path.join(this.backupRoot, name)).isDirectory())
      .map((version) => this.readMetadata(version))
      .filter((meta): meta is VersionMeta => !!meta)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 清除所有历史版本（清空备份根目录）
   */
  public purgeAllVersions(): void {
    if (this.destroyed) throw new Error(ERROR_DESTROYED);

    this._purgeAllVersions();
  }

  /**
   * 销毁 FolderVersionManager
   * @param purgeAllVersions 是否清除所有历史版本
   */
  public destroy(purgeAllVersions: boolean = false): void {
    if (this.destroyed) throw new Error(ERROR_DESTROYED);
    if (purgeAllVersions) this._purgeAllVersions(true);

    this.destroyed = true;
  }

  private _purgeAllVersions(removeFolder: boolean = false): void {
    if (fs.existsSync(this.backupRoot)) {
      if (removeFolder) {
        fs.rmSync(this.backupRoot, { recursive: true, force: true });
      } else {
        FsUtils.cleanFolderSync(this.backupRoot);
      }
    }
  }

  private generateVersionId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private getVersionPath(versionId: string): string {
    return path.join(this.backupRoot, versionId);
  }

  private writeMetadata(versionId: string): void {
    const metaPath = path.join(this.getVersionPath(versionId), ".backupmeta");
    const stats = fs.statSync(this.targetFolder);

    const meta: VersionMeta = {
      version: versionId,
      timestamp: Date.now(),
      size: this.calculateFolderSize(this.targetFolder),
    };

    fs.writeFileSync(metaPath, JSON.stringify(meta));
  }

  private readMetadata(versionId: string): VersionMeta | null {
    const metaPath = path.join(this.getVersionPath(versionId), ".backupmeta");

    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch {
      return null;
    }
  }

  private calculateFolderSize(folderPath: string): number {
    let totalSize = 0;

    const stack = [folderPath];
    while (stack.length > 0) {
      const currentPath = stack.pop()!;

      fs.readdirSync(currentPath).forEach((item) => {
        const itemPath = path.join(currentPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
          stack.push(itemPath);
        } else {
          totalSize += stats.size;
        }
      });
    }

    return totalSize;
  }

  private purgeOldVersions(): void {
    const versions = this.listVersions();

    if (versions.length > this.maxVersions) {
      versions.slice(this.maxVersions).forEach((version) => {
        fs.rmSync(this.getVersionPath(version.version), { recursive: true, force: true });
      });
    }
  }

  private createTempBackup(): string {
    const tempPath = path.join(this.backupRoot, `temp_${Date.now()}`);
    FsUtils.copyFolderSync(this.targetFolder, tempPath);
    return tempPath;
  }

  private cleanTargetFolder(): void {
    FsUtils.cleanFolderSync(this.targetFolder);
  }

  private validateTargetFolder(): void {
    if (!fs.existsSync(this.targetFolder)) {
      throw new Error("目标文件夹已被删除");
    }

    try {
      fs.accessSync(this.targetFolder, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error: any) {
      throw new Error(`无权限访问目标文件夹: ${error.message}`);
    }
  }
}
