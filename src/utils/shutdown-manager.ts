export class ShutdownManager {
  private cleanupTasks: Array<() => void | Promise<void>> = [];
  private isShuttingDown = false;
  private readonly TIMEOUT_MS = 10000; // 10秒超时

  constructor() {
    this.setupSignalHandlers();
  }

  // 注册清理任务
  registerCleanupTask(task: () => void | Promise<void>) {
    this.cleanupTasks.push(task);
  }

  private setupSignalHandlers() {
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

    signals.forEach((signal) => {
      process.once(signal, async () => {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        console.log(`\nReceived ${signal}, starting cleanup...`);

        try {
          await this.executeCleanupTasks();
          console.log("Cleanup completed, exiting...");
          process.exit(0);
        } catch (err) {
          console.error("Cleanup failed:", err);
          process.exit(1);
        }
      });
    });
  }

  private async executeCleanupTasks() {
    const timer = setTimeout(() => {
      console.error("Cleanup timeout exceeded, forcing exit");
      process.exit(1);
    }, this.TIMEOUT_MS);

    try {
      await Promise.all(
        this.cleanupTasks.map(async (task) => {
          try {
            await task();
          } catch (err) {
            console.error("Cleanup task error:", err);
          }
        })
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export const shutdownManager = new ShutdownManager();
