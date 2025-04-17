import logger from "@/logger";
import BilibiliLiveRecorder from "../bilibili/live-recorder";
import BilibiliLiveMonitor from "../bilibili/live-monitor";
import BilibiliLiveArManager from "../bilibili/live-ar-manager";
import BilibiliAutoUploader from "../bilibili/live-auto-uploader";
import bilibiliStore from "@/store/bilibili";
import { getLiveRoomInfo, getUpUserInfo } from "../bilibili/api";
import { ISubAdapter } from "./adapter";
import { IXzQbot } from "@/types/xzqbot";
import CommandHandler, { UserBase } from "@/utils/message";
import { Bilibili } from "@/types/bilibili";

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

    // 安装机器人消息处理器
    this.installBotMessageHandler(arm);
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
      // 使用 Map 保持类型安全（比普通对象更合适）
      const groupMap = new Map<number, number[]>();

      // 遍历原始数组进行分组
      for (const { group_id, user_id } of users) {
        const existing = groupMap.get(group_id);
        existing ? existing.push(user_id) : groupMap.set(group_id, [user_id]);
      }

      // 转换为目标格式
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
            { type: "text", data: { text: `直播间 ${room_id} 开始直播啦\n\n` } },
            ...generateAt(user_id),
          ])
          .catch((err) => logger.error(err));
      });
    });

    liveMonitor.on("live-end", () => {
      if (isFirst(room_id)) return;
      groups.forEach((group_id) => {
        bot
          .sendGroup(group_id, [{ type: "text", data: { text: `直播间 ${room_id} 结束直播啦` } }])
          .catch((err) => logger.error(err));
      });
    });

    liveRecorder.on("rec-end", () => {
      groups.forEach((group_id) => {
        bot
          .sendGroup(group_id, [{ type: "text", data: { text: `直播间 ${room_id} 录制完成` } }])
          .catch((err) => logger.error(err));
      });
    });

    autoUploader?.on("upload-start", (taskID) => {
      groups.forEach((group_id) => {
        bot
          .sendGroup(group_id, [
            { type: "text", data: { text: `直播间 ${room_id} 开始上传\n\n任务ID: ${taskID}` } },
          ])
          .catch((err) => logger.error(err));
      });
    });

    autoUploader?.on("upload-success", ({ aid, bvid }) => {
      groups.forEach((group_id) => {
        bot
          .sendGroup(group_id, [
            {
              type: "text",
              data: {
                text: `直播间 ${room_id} 上传成功\n\n视频地址: https://www.bilibili.com/video/${bvid}`,
              },
            },
          ])
          .catch((err) => logger.error(err));
      });
    });

    autoUploader?.on("upload-error", (e) => {
      groups.forEach((group_id) => {
        bot
          .sendGroup(group_id, [
            { type: "text", data: { text: `直播间 ${room_id} 上传失败\n\n错误信息: ${e}` } },
          ])
          .catch((err) => logger.error(err));
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
    const handler = new CommandHandler<
      "订阅直播间" | "取消订阅" | "录制状态" | "直播间" | "task" | "所有直播间" | "停止录制",
      User
    >();

    handler
      .register(
        "订阅直播间",
        {
          steps: [{ prompt: "请输入直播间ID: ", validator: (input) => !isNaN(parseInt(input)) }],
        },
        async (user, params) => {
          try {
            const roomId = parseInt(params[0]);
            const roomInfo = await getLiveRoomInfo(roomId);
            const userInfo = await getUpUserInfo(roomInfo.uid);
            arm.addSubscriber(roomId, `${user.group_id}_${user.user_id}`);
            bilibiliStore.state.db.insertSubscribe(roomId, user.group_id, user.user_id);
            return [
              {
                type: "image",
                data: {
                  url: roomInfo.user_cover,
                },
              },
              {
                type: "text",
                data: {
                  text:
                    `订阅成功\n\n` +
                    `直播间ID: ${roomId}\n` +
                    `直播间标题: ${roomInfo.title}\n` +
                    `直播间链接: https://live.bilibili.com/${roomId}\n` +
                    `直播间简介: ${roomInfo.description}\n` +
                    `\n` +
                    `UP主: ${userInfo.card.name}\n`,
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
            arm.reduceSubscriber(roomId, `${user.group_id}_${user.user_id}`);
            bilibiliStore.state.db.deleteSubscribe(roomId, user.group_id, user.user_id);
            return "取消订阅成功";
          } catch (error) {
            return "取消订阅失败: " + error;
          }
        }
      )
      .register("直播间", {}, () => {
        return "Develop";
      })
      .register("录制状态", {}, async (user) => {
        // 获取用户订阅了的直播间
        const rooms = await bilibiliStore.state.db.getSubscribedRoomsByUser(user.user_id);
        // 获取录制状态
        return (
          arm
            .getArs()
            .filter((item) => rooms.includes(item.ar.roomId))
            .map((item) => {
              return (
                `直播间ID: ${item.ar.roomId}\n` +
                `直播状态: ${
                  item.ar.liveMonitor.roomInfo?.live_status === 1 ? "直播中" : "未直播"
                }\n` +
                `录制状态: ${
                  item.ar.liveRecorder.recStatus === Bilibili.RecorderStatus.RECORDING
                    ? "正在录制"
                    : item.ar.liveRecorder.recStatus === Bilibili.RecorderStatus.STOPPING
                    ? "正在停止"
                    : "未在录制"
                }` +
                "\n" +
                (item.ar.liveRecorder.recStatus === 1
                  ? `当前分段: ${item.ar.liveRecorder.segIndex}\n` +
                    `当前帧率: ${item.ar.liveRecorder.recProgress?.currentFps || "未知"}\n` +
                    `录制时长: ${item.ar.liveRecorder.recProgress?.timemark || "未知"}`
                  : ``)
              );
            })
            .join("\n\n") || "没有订阅的直播间"
        );
      })
      .register("所有直播间", {}, () => {
        return (
          arm
            .getArs()
            .map((item) => {
              return (
                `直播间ID: ${item.ar.roomId}\n` +
                `订阅人数: ${item.subscribers}\n\n` +
                `直播状态: ${
                  item.ar.liveMonitor.roomInfo?.live_status === 1 ? "直播中" : "未直播"
                }\n` +
                `直播间简介: ${item.ar.liveMonitor.roomInfo?.title}\n` +
                `录制状态: ${item.ar.liveRecorder.recStatus === 1 ? "正在录制" : "未录制"}` +
                (item.ar.liveRecorder.recStatus === 1
                  ? `\n当前分段: ${item.ar.liveRecorder.segIndex}\n` +
                    `当前帧率: ${item.ar.liveRecorder.recProgress?.currentFps || "未知"}\n` +
                    `录制时长: ${item.ar.liveRecorder.recProgress?.timemark || "未知"}`
                  : ``)
              );
            })
            .join("\n\n") || "没有订阅的直播间"
        );
      })
      .register(
        "task",
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
                  item.status === "success" ? "✔️" : item.status === "pending" ? "⏳" : "❌"
                } ${item.name}`
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
          if (ar.liveRecorder.recStatus !== 1) return "未在录制中";
          ar.liveRecorder.stop();
          return "停止录制成功";
        }
      );

    bot.on("group_message", async (e, reply) => {
      const gid = e.group_id;
      const qid = e.user_id;
      const raw = e.raw_message;
      const message = e.message;
      const symbol = `${gid}_${qid}`;

      if (!gid || !qid || !raw || !message || !Array.isArray(message) || message.length === 0) {
        logger.warn("[XzQBot Message Handler]", "由于消息格式错误，已拦截：", e);
        return;
      }

      const resp = await handler.handleMessage(
        {
          group_id: gid,
          user_id: qid,
          symbol,
        },
        raw
      );
      if (resp) reply(resp);
    });
  }
}
