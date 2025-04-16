import { LiveAutoRecorderOptions } from "@/types/bilibili";
import BilibiliLiveMonitor from "./live-monitor";
import BilibiliLiveRecorder from "./live-recorder";
import BilibiliAutoUploader from "./live-auto-uploader";

// Ar -> auto recorder

export default class BilibiliLiveAutoRecorder {
  public roomId: number;
  public liveMonitor: BilibiliLiveMonitor;
  public liveRecorder: BilibiliLiveRecorder;
  public autoUploader: BilibiliAutoUploader | null = null;

  constructor(options: LiveAutoRecorderOptions, autoUpload: Boolean = true) {
    this.roomId = typeof options.roomId === "string" ? parseInt(options.roomId) : options.roomId;

    this.liveMonitor = new BilibiliLiveMonitor(options);
    this.liveRecorder = new BilibiliLiveRecorder(options);

    if (autoUpload)
      this.autoUploader = new BilibiliAutoUploader({
        roomId: this.roomId,
        liveRecorder: this.liveRecorder,
        autoClean: true,
      });

    this.installListener();
    this.liveMonitor.startMonitor();
  }

  private installListener() {
    this.liveMonitor.on("live-start", () => {
      this.liveRecorder.rec();
    });
  }

  destroy() {
    this.liveMonitor.destroy();
    this.liveRecorder.destroy();
  }
}
