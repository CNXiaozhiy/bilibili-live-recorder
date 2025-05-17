import { LiveAutoControllerManagerEvents, LiveAutoRecorderManagerOptions } from "@/types/bilibili";
import BilibiliLiveAutoRecorder from "./live-auto-controller";
import EventEmitter from "events";

// Ac -> auto recorder

export default class BilibiliLiveAcManager extends EventEmitter<LiveAutoControllerManagerEvents> {
  private config: LiveAutoRecorderManagerOptions;
  private rooms: Map<number, BilibiliLiveAutoRecorder> = new Map();
  private subscribers: Map<number, string[]> = new Map();

  constructor(config: LiveAutoRecorderManagerOptions) {
    super();
    this.config = config;
  }

  public hasSubscriber(roomId: number, user: string) {
    return this.subscribers.has(roomId) && this.subscribers.get(roomId)!.includes(user);
  }

  public addSubscriber(roomId: number, user: string) {
    if (this.rooms.has(roomId)) {
      if (!this.subscribers.get(roomId)?.includes(user)) this.subscribers.get(roomId)!.push(user);
      return;
    }

    const ac = new BilibiliLiveAutoRecorder({ ...this.config, roomId });
    this.rooms.set(roomId, ac);
    this.subscribers.set(roomId, [user]);
    this.emit("hot-reload-add", ac);
  }

  public reduceSubscriber(roomId: number, user: string) {
    if (!this.rooms.has(roomId)) return;

    this.subscribers.get(roomId)!.splice(this.subscribers.get(roomId)!.indexOf(user), 1);

    if (this.subscribers.get(roomId)!.length === 0) {
      const ac = this.rooms.get(roomId);
      if (!ac) return;

      this.emit("hot-reload-remove", ac);
      ac.destroy();
      this.rooms.delete(roomId);
    }
  }

  public getAc(roomId: number) {
    return this.rooms.get(roomId);
  }

  public getAcs() {
    return Array.from(this.rooms.values()).map((ac) => {
      return { ac, subscribers: this.subscribers.get(ac.roomId)?.length };
    });
  }

  public destroy() {
    this.rooms.forEach((ac) => ac.destroy());
  }
}
