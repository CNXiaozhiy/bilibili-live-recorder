import { LiveAutoRecorderManagerEvents, LiveAutoRecorderManagerOptions } from "@/types/bilibili";
import BilibiliLiveAutoRecorder from "./live-auto-recoder";
import EventEmitter from "events";

// Ar -> auto recorder

export default class BilibiliLiveArManager extends EventEmitter<LiveAutoRecorderManagerEvents> {
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

    const ar = new BilibiliLiveAutoRecorder({ ...this.config, roomId });
    this.rooms.set(roomId, ar);
    this.subscribers.set(roomId, [user]);
    this.emit("hot-reload-add", ar);
  }

  public reduceSubscriber(roomId: number, user: string) {
    if (!this.rooms.has(roomId)) return;

    this.subscribers.get(roomId)!.splice(this.subscribers.get(roomId)!.indexOf(user), 1);

    if (this.subscribers.get(roomId)!.length === 0) {
      const ar = this.rooms.get(roomId);
      if (!ar) return;

      this.emit("hot-reload-remove", ar);
      ar.destroy();
      this.rooms.delete(roomId);
    }
  }

  public getAr(roomId: number) {
    return this.rooms.get(roomId);
  }

  public getArs() {
    return Array.from(this.rooms.values()).map((ar) => {
      return { ar, subscribers: this.subscribers.get(ar.roomId)?.length };
    });
  }

  public destroy() {
    this.rooms.forEach((ar) => ar.destroy());
  }
}
