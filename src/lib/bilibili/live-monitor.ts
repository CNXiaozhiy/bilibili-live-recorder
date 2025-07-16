import EventEmitter from "events";
import { getLiveRoomInfo, getUpUserInfo } from "./api";
import { LiveMonitorEvents, LiveMonitorOptions, LiveRoomInfo, UserInfo } from "@/types/bilibili";

export default class BilibiliLiveMonitor extends EventEmitter<LiveMonitorEvents> {
  public roomId;
  public roomInfoBefore: LiveRoomInfo | null = null;
  public roomInfo: LiveRoomInfo | null = null;
  public userInfo: UserInfo | null = null;

  private pollInterval: NodeJS.Timeout | null = null;
  private oldLiveStatus: number | null = null;
  private slideshowAsEnd: boolean;

  constructor(options: LiveMonitorOptions) {
    super();

    this.roomId = options.roomId;
    this.slideshowAsEnd = options.slideshowAsEnd ?? true;
  }

  startMonitor() {
    const poll = async () => {
      try {
        const roomInfo = await getLiveRoomInfo(this.roomId);

        if (roomInfo.live_status === 1) this.roomInfoBefore = roomInfo;
        this.roomInfo = roomInfo;

        if (this.oldLiveStatus !== roomInfo.live_status) {
          this.emit("status-change", roomInfo);

          switch (roomInfo.live_status) {
            case 0:
              this.emit(
                "live-end",
                roomInfo,
                this.roomInfoBefore?.live_status !== 1 ? 0 : (Date.now() - new Date(this.roomInfoBefore!.live_time).getTime()) / 1000
              );
              break;
            case 1:
              this.emit("live-start", roomInfo);
              break;
            case 2:
              this.emit("live-slideshow", roomInfo);
              if (this.slideshowAsEnd)
                this.emit(
                  "live-end",
                  roomInfo,
                  this.roomInfoBefore?.live_status !== 1 ? 0 : (Date.now() - new Date(this.roomInfoBefore!.live_time).getTime()) / 1000
                );
              break;
            default:
              break;
          }
        }

        this.oldLiveStatus = roomInfo.live_status;

        const userInfo = await getUpUserInfo(roomInfo.uid);

        this.userInfo = userInfo;
      } catch (error) {
        this.emit("monitor-error", error);
      }
    };

    this.pollInterval = setInterval(poll, 10 * 1000);
    poll();

    return this;
  }

  stopMonitor() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    return this;
  }

  destroy() {
    this.stopMonitor();
    this.removeAllListeners();
  }
}
