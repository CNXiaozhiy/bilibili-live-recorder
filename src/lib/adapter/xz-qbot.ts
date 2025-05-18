import logger from "@/logger";
import BilibiliLiveAcManager from "../bilibili/live-ac-manager";
import BilibiliLiveAutoController from "../bilibili/live-auto-controller";
import bilibiliStore from "@/store/bilibili";
import { getImageBase64FromUrl, getLiveRoomInfo, getLiveStreamUrl, getUpUserInfo } from "../bilibili/api";
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
import { getTask } from "@/gInstance/uploader";

export default class XzQbotNotificationAdapter implements ISubAdapter {
  public name = "xz-qbot";

  constructor(private xzQbot: IXzQbot) {}
  init(): void {}
  install(acm: BilibiliLiveAcManager): void {
    // 初始化监听器
    acm.getAcs().forEach(({ ac }) => {
      this.installListener(ac.roomId, ac);
    });
    acm.on("hot-reload-add", (ac) => {
      this.installListener(ac.roomId, ac);
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
          this.installBotMessageHandler(acm);
        })
        .catch((err) => {
          logger.error("[XzQBot Adapter]", "XzQBot 对接失败", err);
        });
    });
  }

  private preventFirst = new Set();
  async installListener(room_id: number, autoController: BilibiliLiveAutoController) {
    const { liveMonitor, liveRecorder } = autoController;

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
      // logger.debug("[XzQbot Adapter]", `Added room ${roomId} to prevent_first`);
      return true;
    };

    type CustomMessageFormatParams = {
      room_id: number;
      bvid?: string;
    };

    const customFormatRender = (message: string, params: CustomMessageFormatParams): SegmentMessages => {
      message = message.replaceAll("@time", new Date().toLocaleTimeString("zh-CN"));
      message = message.replaceAll("@date", new Date().toLocaleDateString("zh-CN"));
      message = message.replaceAll("@id", `${params.room_id}`);
      message = message.replaceAll("@url", `https://live.bilibili.com/${params.room_id}`);
      message = message.replaceAll("@vurl", params.bvid ? `https://www.bilibili.com/video/${params.bvid}` : "");

      message = message.replaceAll("@title", liveMonitor.roomInfo!.title);
      message = message.replaceAll("@desc", liveMonitor.roomInfo!.description);
      message = message.replaceAll("@online", liveMonitor.roomInfo!.online.toString());
      message = message.replaceAll("@cover", liveMonitor.roomInfo!.user_cover);
      message = message.replaceAll("@background", liveMonitor.roomInfo!.background);
      message = message.replaceAll("@area", liveMonitor.roomInfo!.area_name);
      message = message.replaceAll("@tag", liveMonitor.roomInfo!.tags);

      message = message.replaceAll("@name", liveMonitor.userInfo!.card.name);

      return [{ type: "text", data: { text: message } }];
    };

    liveMonitor.on("live-start", async () => {
      if (isFirst(room_id)) return;

      const { subscribers, groups } = await getSubscribes();
      const customRoomSetting = await bilibiliStore.state.db.getCustomRoomSettingByRoomId(room_id);
      const customMessage = customRoomSetting?.notice_message_1 ? customFormatRender(customRoomSetting.notice_message_1, { room_id }) : null;

      groupUsers(subscribers).forEach(({ group_id, user_id }) => {
        bot
          .sendGroup(
            group_id,
            [
              customMessage || [
                { type: "text", data: { text: `您订阅的直播间开始直播啦\n\n` } },
                ...BilibiliUtils.format.liveRoomInfo(liveMonitor.roomInfo!, liveMonitor.userInfo!),
                { type: "text", data: { text: "\n\n" } },
              ],
              customRoomSetting?.group_id === group_id ? { type: "at", data: { qq: "all" } } : generateAt(user_id),
            ].flat() as SegmentMessages
          )
          .catch(this._messageSendError);
      });
    });

    liveMonitor.on("live-end", async () => {
      if (isFirst(room_id)) return;

      const { subscribers, groups } = await getSubscribes();
      const _customMessage = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(room_id))?.notice_message_2;
      const customMessage = _customMessage ? customFormatRender(_customMessage, { room_id }) : null;

      groups.forEach((group_id) => {
        bot
          .sendGroup(
            group_id,
            customMessage || [
              { type: "text", data: { text: `您订阅的直播间结束直播啦\n\n` } },
              ...BilibiliUtils.format.liveRoomInfo(liveMonitor.roomInfo!, liveMonitor.userInfo!),
            ]
          )
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
                text: `直播间 ${room_id} 录制结束\n\n录制时长: ${liveRecorder.recProgress?.timemark || "未知"}`,
              },
            },
          ])
          .catch(this._messageSendError);
      });
    });

    autoController.on("upload-start", async (taskID) => {
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

    autoController.on("upload-success", async ({ aid, bvid }) => {
      const { subscribers, groups } = await getSubscribes();
      const _customMessage = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(room_id))?.notice_message_3;
      const customMessage = _customMessage ? customFormatRender(_customMessage, { room_id, bvid }) : null;

      groups.forEach((group_id) => {
        bot
          .sendGroup(
            group_id,
            customMessage || [
              {
                type: "text",
                data: {
                  text: `直播间 ${room_id} 录像投稿成功\n\n视频地址: https://www.bilibili.com/video/${bvid}`,
                },
              },
            ]
          )
          .catch(this._messageSendError);
      });
    });

    autoController.on("upload-error", async (e) => {
      const { subscribers, groups } = await getSubscribes();

      groups.forEach((group_id) => {
        bot.sendGroup(group_id, [{ type: "text", data: { text: `直播间 ${room_id} 上传失败\n\n错误信息: ${e}` } }]).catch(this._messageSendError);
      });
    });
  }

  installBotMessageHandler(acm: BilibiliLiveAcManager): void {
    // const bot = this.xzQbotPlugin.botInstance;
    const bot = this.xzQbot;

    interface User extends UserBase {
      group_id: number;
      user_id: number;
    }

    type ManagedRoomCommand = "结束录制" | "投稿账号" | "官群" | "封面" | "标题" | "简介" | "分区" | "标签" | "消息1" | "消息2" | "消息3" | "退出";

    type Commands =
      | "关于"
      | "帮助"
      | "添加账号"
      | "管理直播间"
      | "添加管理员"
      | "订阅直播间"
      | "取消订阅"
      | "录制状态"
      | "直播间"
      | "任务进度"
      | "所有直播间"
      | "设置快捷订阅"
      | "直播间图片";

    const handler = new CommandHandler<Commands, User>();
    const managedRoomHandler = new CommandHandler<ManagedRoomCommand, User>();
    const managedRoomHandler_userState = new Map<string, number>(); // symbol -> room_id

    const defaultCustomRoomSetting = {
      group_id: null,
      notice_message_1: null,
      notice_message_2: null,
      notice_message_3: null,
      upload_cover: null,
      upload_desc: null,
      upload_tid: null,
      upload_title: null,
      upload_tag: null,
      upload_account_uid: null,
    };

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
          "6. 直播间图片\n无必选参数，可选参数（是否使用高清图片）。查看已经订阅过的所有直播间的直播间截图\n\n" +
          "注：必选参数是指需要单独提供的信息，比如取消订阅时你必须告诉机器人直播间ID，否则机器人无法确认你到底要取消订阅谁。其他指令类似。可选参数则是可以不提供，采用默认值。\n" +
          "在有参数的情况你也可以使用这种格式：“指令名 参数1 参数2 参数n” 来快速操作，这样机器人就不会单独询问参数值。"
        );
      })
      .register("添加账号", {}, async (user) => {
        const isAdmin = await bilibiliStore.state.db.isAdmin(user.user_id, 5);
        if (!isAdmin) return "权限不足";

        const { qrcode_url, local_qrcode_path, base64_qrcode, web_qrcode_url, login_result } = await BilibiliUtils.addAccount();

        bot.sendGroup(user.group_id, BilibiliUtils.format.loginQrCode(base64_qrcode, web_qrcode_url));

        login_result
          .then((loginInfo) => {
            bot.sendGroup(user.group_id, BilibiliUtils.format.loginSuccessResult(loginInfo));
          })
          .catch((e) => {
            bot.sendGroup(user.group_id, [{ type: "text", data: { text: "添加账号失败\n\n" + e } }]);
          });

        return "";
      })
      .register(
        "管理直播间",
        {
          steps: [{ prompt: "请输入直播间ID: ", validator: (input) => !isNaN(parseInt(input)) }],
        },
        async (user, params) => {
          const isAdmin = await bilibiliStore.state.db.isAdmin(user.user_id, 2);
          if (!isAdmin) return "权限不足";

          managedRoomHandler_userState.set(user.symbol, parseInt(params[0]));

          return (
            `您已进入管理模式\n指令列表\n\n` +
            "1.投稿账号\n2.官群\n3.封面\n4.标题\n5.简介\n6.分区\n7.标签\n8.消息1\n9.消息2\n10.消息3\n11.结束录制\n12.退出\n\n" +
            "注：\n分区：若不知道分区列表切勿盲目设置\n标签：使用英文逗号分隔\n" +
            "消息1：开播时通知的消息\n消息2：关播时通知的消息\n消息3：投稿成功后通知的消息\n\n" +
            "自定义消息可用占位符\n@time: 当前时间\n@date: 当前日期\n@id: 当前直播间ID\n@url: 当前直播间链接\n@vurl: 当前投稿的视频链接（仅消息3中有效）\n" +
            "@title: 当前直播间标题\n@desc: 当前直播间简介\n@online: 当前直播间人气\n@cover: 当前直播间封面（弃用）\n@background: 当前直播间背景（弃用）\n@area: 当前直播间分区\n@tag: 当前直播间标签\n" +
            "@name: 当前直播间主播名字\n\n" +
            "投稿视频（标题、简介）可用占位符\n@title: 当前直播间标题\n@desc: 当前直播间简介\n@time: 开播时间\n@url: 当前直播间链接\n@space: 主播空间地址\n@tag: 当前直播间标签\n\n" +
            "请输入指令（非序号）"
          );
        }
      )
      .register("添加管理员", { steps: [{ prompt: "请输入QQ号: ", validator: (input) => !isNaN(parseInt(input)) }] }, async (user, params) => {
        const isAdmin = await bilibiliStore.state.db.isAdmin(user.user_id, 5);
        if (!isAdmin) return "权限不足";

        await bilibiliStore.state.db.setAdmin(parseInt(params[0]), 2);
        return "添加成功";
      })
      .register(
        "订阅直播间",
        {
          steps: [
            {
              prompt: async (user) => {
                const roomId =
                  (await bilibiliStore.state.db.getCustomRoomSettingByGroupId(user.group_id))?.room_id ||
                  (await bilibiliStore.state.db.getQuickSubscribe(user.group_id));

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
                      text: `\n\n是否继续订阅? \n发送 '是' / 直播间 ID`,
                    },
                  },
                ];
              },
              validator: (input) => input === "是" || !isNaN(parseInt(input)),
            },
          ],
        },
        async (user, params) => {
          try {
            let roomId: number;

            if (params[0] === "是") {
              const quickRoomId = await bilibiliStore.state.db.getQuickSubscribe(user.group_id);
              if (!quickRoomId) return "本群还没有设置快捷订阅";
              roomId = quickRoomId;
            } else {
              roomId = parseInt(params[0]);
            }

            if (acm.hasSubscriber(roomId, user.symbol)) return "您已经订阅了该直播间";
            acm.addSubscriber(roomId, user.symbol);
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
            if (!acm.hasSubscriber(roomId, user.symbol)) return "您还没有订阅该直播间";
            acm.reduceSubscriber(roomId, user.symbol);
            bilibiliStore.state.db.deleteSubscribe(roomId, user.group_id, user.user_id);
            return "取消订阅成功";
          } catch (error) {
            return "取消订阅失败: " + error;
          }
        }
      )
      .register("直播间", {}, async (user) => {
        const rooms = await bilibiliStore.state.db.getSubscribedRoomsByUserAndGroup(user.user_id, user.group_id);
        const message = acm
          .getAcs()
          .filter((item) => rooms.includes(item.ac.roomId))
          .map((item) => BilibiliUtils.format.liveRoomInfo(item.ac.liveMonitor.roomInfo!, item.ac.liveMonitor.userInfo!))
          .intersperse<SegmentMessage>({ type: "text", data: { text: "\n\n" } })
          .flat();
        return message.length > 0 ? message : "您还没有订阅直播间";
      })
      .register("录制状态", {}, async (user) => {
        const rooms = await bilibiliStore.state.db.getSubscribedRoomsByUserAndGroup(user.user_id, user.group_id);
        const message = acm
          .getAcs()
          .filter((item) => rooms.includes(item.ac.roomId))
          .map((item) => BilibiliUtils.format.recordStatus(item.ac.liveMonitor.roomInfo!, item.ac.liveRecorder, item.ac.liveMonitor.userInfo!))
          .intersperse<SegmentMessage>({ type: "text", data: { text: "\n\n" } })
          .flat();
        return message.length > 0 ? message : "您还没有订阅直播间";
      })
      .register("所有直播间", {}, () => {
        const message = acm
          .getAcs()
          .map((item) => BilibiliUtils.format.liveRoomInfo(item.ac.liveMonitor.roomInfo!, item.ac.liveMonitor.userInfo!))
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
          const task = getTask(taskId);
          if (!task) return "任务不存在";
          return task.status
            .map(
              (item) =>
                `${item.time} ${item.status === "success" ? "✅" : item.status === "pending" ? "⏳" : "❌"} ${item.name} ${item.process || ""}`
            )
            .join("\n");
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
          const rooms = await bilibiliStore.state.db.getSubscribedRoomsByUserAndGroup(user.user_id, user.group_id);
          if (rooms.length === 0) return "没有订阅的直播间";

          const useHighQuality = params[0] === "是";
          try {
            const messages: SegmentMessages[] = [];
            for (const id of rooms) {
              const liveRoomInfo = acm.getAc(id)!.liveMonitor.roomInfo!;
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
            return messages.intersperse<SegmentMessage>({ type: "text", data: { text: "\n\n" } }).flat();
          } catch (error) {
            logger.error("[XzQBot Message Handler]", "直播间截图失败", error as Error);
            return "失败: " + (error as Error).message;
          }
        }
      );

    managedRoomHandler
      .register("结束录制", {}, async (user) => {
        const roomId = managedRoomHandler_userState.get(user.symbol)!;
        const ar = acm.getAc(roomId);
        if (!ar) return "未找到直播间";
        if (ar.liveRecorder.recStatus !== Bilibili.RecorderStatus.RECORDING) return "当前未在录制";
        ar.liveRecorder.stop();
        return "结束录制中";
      })
      .register(
        "投稿账号",
        {
          steps: [
            {
              prompt: async () => {
                return (
                  "请输入账号序号: \n\n" + (await bilibiliStore.state.db.getBiliAccounts()).map((account, i) => `${i + 1}. ${account.uid}`).join("\n")
                );
              },
              validator: (input) => !isNaN(parseInt(input)),
            },
          ],
        },
        async (user, params) => {
          const index = parseInt(params[0]);
          const accounts = await bilibiliStore.state.db.getBiliAccounts();
          if (index > accounts.length) return "错误的账号序号";
          const account = accounts[index - 1];
          if (!account) return "账号不存在";

          const roomId = managedRoomHandler_userState.get(user.symbol)!;

          const old = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId)) || defaultCustomRoomSetting;

          bilibiliStore.state.db.setCustomRoomSettings(roomId, {
            ...old,
            upload_account_uid: account.uid,
          });

          return `设置成功！`;
        }
      )
      .register("官群", {}, async (user) => {
        const roomId = managedRoomHandler_userState.get(user.symbol)!;
        const old = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId)) || defaultCustomRoomSetting;
        bilibiliStore.state.db.setCustomRoomSettings(roomId, { ...old, group_id: user.group_id });
        return "设置本群为官方群成功！";
      })
      .register("封面", { steps: [{ prompt: "请发送封面图片: " }] }, async (user, params) => {
        const roomId = managedRoomHandler_userState.get(user.symbol)!;
        const fileName = params[0].match(/file=([^,]+)/)?.[1];
        if (!fileName) return "图片无效";
        try {
          const result = await bot.getImage(fileName);
          const base64 = await getImageBase64FromUrl(result.data.url);
          const old = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId)) || defaultCustomRoomSetting;
          bilibiliStore.state.db.setCustomRoomSettings(roomId, { ...old, upload_cover: base64 });
          return "设置成功！";
        } catch (error) {
          logger.error("[XzQBot Message Handler]", "获取图片失败", error as Error);
          return "失败: " + (error as Error).message;
        }
      })
      .register("标题", { steps: [{ prompt: "请输入直播间标题: " }] }, async (user, params) => {
        const roomId = managedRoomHandler_userState.get(user.symbol)!;
        const old = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId)) || defaultCustomRoomSetting;
        bilibiliStore.state.db.setCustomRoomSettings(roomId, { ...old, upload_title: params[0] });
        return "设置成功！";
      })
      .register("简介", { steps: [{ prompt: "请输入直播间简介: " }] }, async (user, params) => {
        const roomId = managedRoomHandler_userState.get(user.symbol)!;
        const old = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId)) || defaultCustomRoomSetting;
        bilibiliStore.state.db.setCustomRoomSettings(roomId, { ...old, upload_desc: params[0] });
        return "设置成功！";
      })
      .register("分区", { steps: [{ prompt: "请输入直播间分区: " }] }, async (user, params) => {
        const roomId = managedRoomHandler_userState.get(user.symbol)!;
        if (parseInt(params[0]) < 0) return "分区不存在，请先查询分区列表，勿盲目设置";
        const old = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId)) || defaultCustomRoomSetting;
        bilibiliStore.state.db.setCustomRoomSettings(roomId, { ...old, upload_tid: parseInt(params[0]) });
        return "设置成功！";
      })
      .register("标签", { steps: [{ prompt: "请输入直播间标签: " }] }, async (user, params) => {
        const roomId = managedRoomHandler_userState.get(user.symbol)!;
        const old = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId)) || defaultCustomRoomSetting;
        bilibiliStore.state.db.setCustomRoomSettings(roomId, { ...old, upload_tag: params[0] });
        return "设置成功！";
      })
      .register("消息1", { steps: [{ prompt: "请输入开播通知消息: " }] }, async (user, params) => {
        const roomId = managedRoomHandler_userState.get(user.symbol)!;
        const old = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId)) || defaultCustomRoomSetting;
        bilibiliStore.state.db.setCustomRoomSettings(roomId, { ...old, notice_message_1: params[0] });
        return "设置成功！";
      })
      .register("消息2", { steps: [{ prompt: "请输入关播通知消息: " }] }, async (user, params) => {
        const roomId = managedRoomHandler_userState.get(user.symbol)!;
        const old = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId)) || defaultCustomRoomSetting;
        bilibiliStore.state.db.setCustomRoomSettings(roomId, { ...old, notice_message_2: params[0] });
        return "设置成功！";
      })
      .register("消息3", { steps: [{ prompt: "请输入投稿成功通知消息: " }] }, async (user, params) => {
        const roomId = managedRoomHandler_userState.get(user.symbol)!;
        const old = (await bilibiliStore.state.db.getCustomRoomSettingByRoomId(roomId)) || defaultCustomRoomSetting;
        bilibiliStore.state.db.setCustomRoomSettings(roomId, { ...old, notice_message_3: params[0] });
        return "设置成功！";
      })
      .register("退出", {}, async (user) => {
        managedRoomHandler_userState.delete(user.symbol);
        return "您已退出管理模式";
      });

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
      if (managedRoomHandler_userState.has(symbol)) {
        managedRoomHandler
          .handleMessage({ group_id: gid, user_id: qid, symbol }, raw)
          .then((resp) => {
            if (!resp) return;
            reply(resp).catch(this._messageSendError);
          })
          .catch((e) => logger.error("[XzQBot Message Handler]", "消息处理失败", e));
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
