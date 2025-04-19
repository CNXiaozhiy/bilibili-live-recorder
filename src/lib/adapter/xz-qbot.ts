import logger from "@/logger";
import BilibiliLiveRecorder from "../bilibili/live-recorder";
import BilibiliLiveMonitor from "../bilibili/live-monitor";
import BilibiliLiveArManager from "../bilibili/live-ar-manager";
import BilibiliAutoUploader from "../bilibili/live-auto-uploader";
import bilibiliStore from "@/store/bilibili";
import { getLiveRoomInfo, getUpUserInfo } from "../bilibili/api";
import { ISubAdapter } from ".";
import { IXzQbot } from "@/types/xzqbot";
import CommandHandler, { UserBase } from "@/utils/message";
import BilibiliUtils from "@/utils/bilibili";
import { SegmentMessage } from "@/types/one-bot";

export default class XzQbotNotificationAdapter implements ISubAdapter {
  public name = "xz-qbot";

  constructor(private xzQbot: IXzQbot) {}
  init(): void {}
  install(arm: BilibiliLiveArManager): void {
    // 初始化监听器
    arm.getArs().forEach(({ ar }) => {
      this.installListener(ar.roomId, ar.liveMonitor, ar.liveRecorder, ar.autoUploader);
    });
    arm.on("hot-reload-add", (ar) => {
      this.installListener(ar.roomId, ar.liveMonitor, ar.liveRecorder, ar.autoUploader);
    });

    this.xzQbot.connect().then(() => {
      this.xzQbot
        .getLoginInfo()
        .then((info) => {
          logger.info("[XzQBot Adapter]", "XzQBot 对接成功✅");
          logger.info("[XzQBot Account]", "XzQBot 登录成功✅");
          logger.info("[XzQBot Account Info]", "机器人QQ:", info.data.user_id);
          logger.info("[XzQBot Account Info]", "机器人昵称:", info.data.nickname);

          // 安装机器人消息处理器
          this.installBotMessageHandler(arm);
        })
        .catch((err) => {
          logger.error("[XzQBot Adapter]", "XzQBot 对接失败", err);
        });
    });
  }

  private preventFirst = new Set();
  async installListener(
    room_id: number,
    liveMonitor: BilibiliLiveMonitor,
    liveRecorder: BilibiliLiveRecorder,
    autoUploader: BilibiliAutoUploader | null
  ) {
    // const bot = this.xzQbotPlugin.botInstance;
    const bot = this.xzQbot;

    // 获取当前直播间的所有订阅者
    const subscribers = await bilibiliStore.state.db.getSubscriberWithGroup(room_id);
    const groups = await bilibiliStore.state.db.getSubscribedGroupsByRoom(room_id);

    type GroupUser = {
      group_id: number;
      user_id: number;
    };

    type GroupedUsers = {
      group_id: number;
      user_id: number[];
    };

    function groupUsers(users: GroupUser[]): GroupedUsers[] {
      const groupMap = new Map<number, number[]>();

      for (const { group_id, user_id } of users) {
        const existing = groupMap.get(group_id);
        existing ? existing.push(user_id) : groupMap.set(group_id, [user_id]);
      }

      return Array.from(groupMap.entries()).map(([group_id, user_id]) => ({
        group_id,
        user_id,
      }));
    }

    function generateAt(users: GroupedUsers["user_id"]) {
      return users.map<{ type: "at"; data: { qq: number } }>((id) => ({
        type: "at",
        data: { qq: id },
      }));
    }

    const isFirst = (roomId: number) => {
      if (this.preventFirst.has(roomId)) return false;
      this.preventFirst.add(roomId);
      logger.debug("[XzQbot]", `Added room ${roomId} to prevent_first`);
      return true;
    };

    liveMonitor.on("live-start", () => {
      if (isFirst(room_id)) return;
      groupUsers(subscribers).forEach(({ group_id, user_id }) => {
        bot
          .sendGroup(group_id, [
            { type: "text", data: { text: `您订阅的直播间开始直播啦\n\n` } },
            ...BilibiliUtils.format.liveRoomInfo(liveMonitor.roomInfo!, liveMonitor.userInfo!),
            { type: "text", data: { text: "\n\n" } },
            ...generateAt(user_id),
          ])
          .catch(this._messageSendError);
      });
    });

    liveMonitor.on("live-end", () => {
      if (isFirst(room_id)) return;
      groups.forEach((group_id) => {
        bot
          .sendGroup(group_id, [
            { type: "text", data: { text: `您订阅的直播间结束直播啦\n\n` } },
            ...BilibiliUtils.format.liveRoomInfo(liveMonitor.roomInfo!, liveMonitor.userInfo!),
          ])
          .catch(this._messageSendError);
      });
    });

    liveMonitor.on("live-slideshow", () => {
      if (isFirst(room_id)) return;
    });

    liveRecorder.on("rec-end", () => {
      groups.forEach((group_id) => {
        bot
          .sendGroup(group_id, [
            {
              type: "text",
              data: {
                text: `直播间 ${room_id} 录制结束\n\n录制时长: ${
                  liveRecorder.recProgress?.timemark || "未知"
                }`,
              },
            },
          ])
          .catch(this._messageSendError);
      });
    });

    autoUploader?.on("upload-start", (taskID) => {
      groups.forEach((group_id) => {
        bot
          .sendGroup(group_id, [
            {
              type: "text",
              data: {
                text: `直播间 ${room_id} 开始投稿\n\n任务ID: ${taskID}\n发送 '任务进度 ${taskID}' 查询任务进度`,
              },
            },
          ])
          .catch(this._messageSendError);
      });
    });

    autoUploader?.on("upload-success", ({ aid, bvid }) => {
      groups.forEach((group_id) => {
        bot
          .sendGroup(group_id, [
            {
              type: "text",
              data: {
                text: `直播间 ${room_id} 录像投稿成功\n\n视频地址: https://www.bilibili.com/video/${bvid}`,
              },
            },
          ])
          .catch(this._messageSendError);
      });
    });

    autoUploader?.on("upload-error", (e) => {
      groups.forEach((group_id) => {
        bot
          .sendGroup(group_id, [
            { type: "text", data: { text: `直播间 ${room_id} 上传失败\n\n错误信息: ${e}` } },
          ])
          .catch(this._messageSendError);
      });
    });
  }

  installBotMessageHandler(arm: BilibiliLiveArManager): void {
    // const bot = this.xzQbotPlugin.botInstance;
    const bot = this.xzQbot;

    interface User extends UserBase {
      group_id: number;
      user_id: number;
    }
    type Commands =
      | "订阅直播间"
      | "取消订阅"
      | "录制状态"
      | "直播间"
      | "任务进度"
      | "所有直播间"
      | "停止录制";

    const handler = new CommandHandler<Commands, User>();

    handler
      .register(
        "订阅直播间",
        {
          steps: [{ prompt: "请输入直播间ID: ", validator: (input) => !isNaN(parseInt(input)) }],
        },
        async (user, params) => {
          try {
            const roomId = parseInt(params[0]);
            if (arm.hasSubscriber(roomId, user.symbol)) return "您已经订阅了该直播间";
            const roomInfo = await getLiveRoomInfo(roomId);
            const userInfo = await getUpUserInfo(roomInfo.uid);
            arm.addSubscriber(roomId, user.symbol);
            bilibiliStore.state.db.insertSubscribe(roomId, user.group_id, user.user_id);
            return [
              {
                type: "image",
                data: {
                  file: roomInfo.user_cover,
                },
              },
              {
                type: "text",
                data: {
                  text:
                    `订阅成功\n\n` +
                    `UP主: ${userInfo.card.name}\n` +
                    `直播间ID: ${roomId}\n` +
                    `直播间标题: ${roomInfo.title}\n` +
                    `直播间简介: ${roomInfo.description}\n`,
                },
              },
            ];
          } catch (error) {
            return "订阅失败: " + error;
          }
        }
      )
      .register(
        "取消订阅",
        {
          steps: [{ prompt: "请输入直播间ID: ", validator: (input) => !isNaN(parseInt(input)) }],
        },
        async (user, params) => {
          try {
            const roomId = parseInt(params[0]);
            if (!arm.hasSubscriber(roomId, user.symbol)) return "您还没有订阅该直播间";
            arm.reduceSubscriber(roomId, user.symbol);
            bilibiliStore.state.db.deleteSubscribe(roomId, user.group_id, user.user_id);
            return "取消订阅成功";
          } catch (error) {
            return "取消订阅失败: " + error;
          }
        }
      )
      .register("直播间", {}, async (user) => {
        const rooms = await bilibiliStore.state.db.getSubscribedRoomsByUserAndGroup(
          user.user_id,
          user.group_id
        );
        const message = arm
          .getArs()
          .filter((item) => rooms.includes(item.ar.roomId))
          .map((item) =>
            BilibiliUtils.format.liveRoomInfo(
              item.ar.liveMonitor.roomInfo!,
              item.ar.liveMonitor.userInfo!
            )
          )
          .flat()
          .intersperse<SegmentMessage>({ type: "text", data: { text: "\n\n" } });
        return message.length > 0 ? message : "您还没有订阅直播间";
      })
      .register("录制状态", {}, async (user) => {
        const rooms = await bilibiliStore.state.db.getSubscribedRoomsByUserAndGroup(
          user.user_id,
          user.group_id
        );
        const message = arm
          .getArs()
          .filter((item) => rooms.includes(item.ar.roomId))
          .map((item) =>
            BilibiliUtils.format.recordStatus(
              item.ar.liveMonitor.roomInfo!,
              item.ar.liveRecorder,
              item.ar.liveMonitor.userInfo!
            )
          )
          .flat()
          .intersperse<SegmentMessage>({ type: "text", data: { text: "\n\n" } });
        return message.length > 0 ? message : "您还没有订阅直播间";
      })
      .register("所有直播间", {}, () => {
        const message = arm
          .getArs()
          .map((item) =>
            BilibiliUtils.format.liveRoomInfo(
              item.ar.liveMonitor.roomInfo!,
              item.ar.liveMonitor.userInfo!
            )
          )
          .flat()
          .intersperse<SegmentMessage>({ type: "text", data: { text: "\n\n" } });
        return message.length > 0 ? message : "无房间";
      })
      .register(
        "任务进度",
        {
          steps: [{ prompt: "请输入任务ID: ", validator: (input) => !isNaN(parseInt(input)) }],
        },
        async (_, params) => {
          const taskId = parseInt(params[0]);
          const task = bilibiliStore.state.publicUploader.getTask(taskId);
          if (!task) return "任务不存在";
          return task.status
            .map(
              (item) =>
                `${item.time} ${
                  item.status === "success" ? "✅" : item.status === "pending" ? "⏳" : "❌"
                } ${item.name} ${item.process || ""}`
            )
            .join("\n");
        }
      )
      .register(
        "停止录制",
        {
          steps: [{ prompt: "请输入直播间ID: ", validator: (input) => !isNaN(parseInt(input)) }],
        },
        async (user, params) => {
          const roomId = parseInt(params[0]);
          const ar = arm.getAr(roomId);
          if (!ar) return "未找到直播间";
          if (ar.liveRecorder.recStatus !== 1) return "当前未在录制";
          ar.liveRecorder.stop();
          return "停止录制中";
        }
      );

    bot.on("group_message", (e, reply) => {
      const gid = e.group_id;
      const qid = e.user_id;
      const raw = e.raw_message;
      const message = e.message;
      const symbol = `${gid}_${qid}`;

      if (!gid || !qid || !raw || !message || !Array.isArray(message) || message.length === 0) {
        if (typeof raw === "string" || (Array.isArray(message) && message.length === 0)) {
          logger.warn("[XzQBot Message Handler]", "收到空白消息，已跳过处理");
        } else {
          logger.warn("[XzQBot Message Handler]", "由于消息格式错误，已拦截：", e);
        }
        return;
      }

      // 处理消息
      handler
        .handleMessage({ group_id: gid, user_id: qid, symbol }, raw)
        .then((resp) => {
          resp && reply(resp).catch(this._messageSendError);
        })
        .catch((e) => logger.error("[XzQBot Message Handler]", "消息处理失败", e));
    });
  }

  private _messageSendError(e: any) {
    logger.error("[XzQBot Message Handler]", "消息发送失败", e as Error);
  }
}
