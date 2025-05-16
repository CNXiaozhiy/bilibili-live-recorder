import logger from "@/logger";
import BilibiliLiveRecorder from "../bilibili/live-recorder";
import BilibiliLiveMonitor from "../bilibili/live-monitor";
import BilibiliLiveArManager from "../bilibili/live-ar-manager";
import BilibiliAutoUploader from "../bilibili/live-auto-uploader";
import bilibiliStore from "@/store/bilibili";
import { getLiveRoomInfo, getLiveStreamUrl, getUpUserInfo } from "../bilibili/api";
import { ISubAdapter } from ".";
import { IXzQbot } from "@/types/xzqbot";
import CommandHandler, { UserBase } from "@/utils/message";
import BilibiliUtils from "@/utils/bilibili";
import FfpmegUtils from "@/utils/ffmpeg";
import { FsUtils } from "@/utils/fs";
import ImageUtils from "@/utils/image";
import { SegmentMessage, SegmentMessages } from "@/types/one-bot";
import { getPackageJson } from "@/utils/package";
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
    const getSubscribes = async () => {
      return {
        subscribers: await bilibiliStore.state.db.getSubscriberWithGroup(room_id),
        groups: await bilibiliStore.state.db.getSubscribedGroupsByRoom(room_id),
      };
    };

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
      logger.debug("[XzQbot Adapter]", `Added room ${roomId} to prevent_first`);
      return true;
    };

    liveMonitor.on("live-start", async () => {
      if (isFirst(room_id)) return;

      const { subscribers, groups } = await getSubscribes();

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

    liveMonitor.on("live-end", async () => {
      if (isFirst(room_id)) return;

      const { subscribers, groups } = await getSubscribes();

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

    liveRecorder.on("rec-end", async () => {
      const { subscribers, groups } = await getSubscribes();

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

    autoUploader?.on("upload-start", async (taskID) => {
      const { subscribers, groups } = await getSubscribes();

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

    autoUploader?.on("upload-success", async ({ aid, bvid }) => {
      const { subscribers, groups } = await getSubscribes();

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

    autoUploader?.on("upload-error", async (e) => {
      const { subscribers, groups } = await getSubscribes();

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
      | "关于"
      | "帮助"
      | "订阅直播间"
      | "取消订阅"
      | "录制状态"
      | "直播间"
      | "任务进度"
      | "所有直播间"
      | "结束录制"
      | "设置快捷订阅"
      | "直播间图片";

    const handler = new CommandHandler<Commands, User>();

    handler
      .register("关于", {}, () => {
        const packageJson = getPackageJson();
        const version = process.env.APP_VERSION;
        const changelog = `https://github.com/CNXiaozhiY/bilibili-live-recorder/blob/master/CHANGELOG.md`;
        const support = `Xymao, CNXiaozhiY`;

        return [
          { type: "text", data: { text: "Bilibili Live Recorder\n\n" } },
          { type: "text", data: { text: `当前版本: ${version}\n` } },
          { type: "text", data: { text: `作者: ${packageJson.author}\n` } },
          { type: "text", data: { text: `Github: ${packageJson.repository.url}\n` } },
          { type: "text", data: { text: `更新日志: ${changelog}\n` } },
          { type: "text", data: { text: `鸣谢: ${support}` } },
        ];
      })
      .register("帮助", {}, () => {
        return (
          "BLR XzQBot Adapter 帮助中心\n\n" +
          "1. 订阅直播间\n参数（直播间ID）。若本群有订阅直播间可以在询问是否快捷订阅后发送'是'直接订阅，也可以另外发送直播间ID来订阅\n\n" +
          "2. 取消订阅\n参数（直播间ID）。需要发送直播间ID\n\n" +
          "3. 直播间\n无需参数。查看已经订阅过的所有直播间的详细信息\n\n" +
          "4. 录制状态\n无需参数。查看已经订阅过的所有直播间的录制状态\n\n" +
          "5. 任务进度\n参数（任务ID）。\n\n" +
          "6. 结束录制\n参数（直播间ID）。需要发送直播间ID\n\n" +
          "7. 直播间图片\n无必选参数，可选参数（是否使用高清图片）。查看已经订阅过的所有直播间的直播间截图\n\n" +
          "注：必选参数是指需要单独提供的信息，比如取消订阅时你必须告诉机器人直播间ID，否则机器人无法确认你到底要取消订阅谁。其他指令类似。可选参数则是可以不提供，采用默认值。\n" +
          "在有参数的情况你也可以使用这种格式：“指令名 参数1 参数2 参数n” 来快速操作，这样机器人就不会单独询问参数值。"
        );
      })
      .register(
        "订阅直播间",
        {
          steps: [
            {
              prompt: async (user) => {
                const roomId = await bilibiliStore.state.db.getQuickSubscribe(user.group_id);
                if (!roomId) return "请输入直播间ID: ";

                const roomInfo = await getLiveRoomInfo(roomId);
                return [
                  {
                    type: "text",
                    data: {
                      text: `本群的快捷订阅直播间: ${roomId}\n\n`,
                    },
                  },
                  ...BilibiliUtils.format.liveRoomInfo(roomInfo),
                  {
                    type: "text",
                    data: {
                      text: `\n\n是否继续订阅? \n发送 'y' / 直播间 ID`,
                    },
                  },
                ];
              },
              validator: (input) => input === "y" || !isNaN(parseInt(input)),
            },
          ],
        },
        async (user, params) => {
          try {
            let roomId: number;

            if (params[0] === "y") {
              const quickRoomId = await bilibiliStore.state.db.getQuickSubscribe(user.group_id);
              if (!quickRoomId) return "本群还没有设置快捷订阅";
              roomId = quickRoomId;
            } else {
              roomId = parseInt(params[0]);
            }

            if (arm.hasSubscriber(roomId, user.symbol)) return "您已经订阅了该直播间";
            arm.addSubscriber(roomId, user.symbol);
            await bilibiliStore.state.db.insertSubscribe(roomId, user.group_id, user.user_id);
            return "订阅成功！";
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
          .intersperse<SegmentMessage>({ type: "text", data: { text: "\n\n" } })
          .flat();
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
          .intersperse<SegmentMessage>({ type: "text", data: { text: "\n\n" } })
          .flat();
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
          .intersperse<SegmentMessage>({ type: "text", data: { text: "\n\n" } })
          .flat();
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
        "结束录制",
        {
          steps: [{ prompt: "请输入直播间ID: ", validator: (input) => !isNaN(parseInt(input)) }],
        },
        async (user, params) => {
          const isAdmin = await bilibiliStore.state.db.isAdmin(user.user_id, 2);
          if (!isAdmin) return "权限不足";

          const roomId = parseInt(params[0]);
          const ar = arm.getAr(roomId);
          if (!ar) return "未找到直播间";
          if (ar.liveRecorder.recStatus !== Bilibili.RecorderStatus.RECORDING)
            return "当前未在录制";
          ar.liveRecorder.stop();
          return "停止录制中";
        }
      )
      .register(
        "设置快捷订阅",
        {
          steps: [
            {
              prompt: "请输入本群快捷订阅直播间ID: ",
              validator: (input) => !isNaN(parseInt(input)),
            },
          ],
        },
        async (user, params) => {
          const isAdmin = await bilibiliStore.state.db.isAdmin(user.user_id, 2);
          if (!isAdmin) return "权限不足";

          const roomId = parseInt(params[0]);
          await bilibiliStore.state.db.setQuickSubscribe(user.group_id, roomId);
          return `设置成功！\n\n群聊: ${user.group_id}\n直播间ID: ${roomId}`;
        }
      )
      .register(
        "直播间图片",
        {
          steps: [
            {
              prompt: "是否使用高清图片，这可能会显著延长响应时间 (y/n)",
              required: false,
            },
          ],
        },
        async (user, params) => {
          const rooms = await bilibiliStore.state.db.getSubscribedRoomsByUserAndGroup(
            user.user_id,
            user.group_id
          );
          if (rooms.length === 0) return "没有订阅的直播间";

          const useHighQuality = params[0] === "y";
          try {
            const messages: SegmentMessages[] = [];
            for (const id of rooms) {
              const liveRoomInfo = arm.getAr(id)!.liveMonitor.roomInfo!;
              if (liveRoomInfo.live_status !== Bilibili.LiveRoomStatus.LIVE) {
                messages.push([{ type: "text", data: { text: `直播间 ${id} 未开播` } }]);
                continue;
              }
              const urls = await getLiveStreamUrl(id);
              const tempFile = FsUtils.createTempFilePath(useHighQuality ? ".png" : ".jpg");
              if (useHighQuality) {
                await FfpmegUtils.captureScreenshot(urls[0], tempFile);
              } else {
                await FfpmegUtils.captureScreenshot(urls[0], tempFile, 6);
              }
              const base64 = ImageUtils.toBase64(tempFile);
              FsUtils.fs.unlinkSync(tempFile);
              messages.push([
                { type: "text", data: { text: `直播间 ${id} 实时图片\n` } },
                { type: "image", data: { file: `base64://${base64}` } },
              ]);
            }
            return messages
              .intersperse<SegmentMessage>({ type: "text", data: { text: "\n\n" } })
              .flat();
          } catch (error) {
            logger.error("[XzQBot Message Handler]", "直播间截图失败", error as Error);
            return "失败: " + (error as Error).message;
          }
        }
      );

    const bannedUsers = new Set<string>();
    const usageFrequency = new Map<string, number>();

    setInterval(() => {
      usageFrequency.forEach((_, k) => {
        usageFrequency.set(k, 0);
      });
    }, 60 * 1000);

    bot.on("group_message", (e, reply) => {
      const gid = e.group_id;
      const qid = e.user_id;
      const raw = e.raw_message;
      const message = e.message;
      const symbol = `${gid}_${qid}`;

      if (bannedUsers.has(symbol)) return;

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
          if (!resp) return;

          usageFrequency.set(symbol, (usageFrequency.get(symbol) || 0) + 1);

          reply(resp).catch(this._messageSendError);

          if (usageFrequency.get(symbol)! > 5) {
            bannedUsers.add(symbol);
            setTimeout(() => {
              bannedUsers.delete(symbol);
            }, 30 * 1000);
            reply("你发送指令太过于频繁，请稍后再试", { at: true });
          }
        })
        .catch((e) => logger.error("[XzQBot Message Handler]", "消息处理失败", e));
    });
  }

  private _messageSendError(e: any) {
    logger.error("[XzQBot Message Handler]", "消息发送失败", e as Error);
  }
}
