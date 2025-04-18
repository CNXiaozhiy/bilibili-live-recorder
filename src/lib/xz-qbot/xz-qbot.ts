import { WebSocket } from "ws";
import { v4 as uuid } from "uuid";
import EventEmitter from "events";
import * as OneBot from "@/types/one-bot";
import logger from "@/logger";

type ReplyFunction<T> = (message: OneBot.Messages, reference?: boolean) => Promise<T>;

export interface XzQbotEvents {
  event: [data: { e: OneBot.Events }];
  message: [
    e: OneBot.MessageEvent,
    reply: ReplyFunction<
      OneBot.ActionOkResponse<"send_group_msg"> | OneBot.ActionOkResponse<"send_private_msg">
    >
  ];
  group_message: [
    e: OneBot.GroupMessageEvent | OneBot.GroupMessageSentEvent,
    reply: ReplyFunction<OneBot.ActionOkResponse<"send_group_msg">>
  ];
  private_message: [
    e: OneBot.PrivateMessageEvent | OneBot.PrivateMessageSentEvent,
    reply: ReplyFunction<OneBot.ActionOkResponse<"send_private_msg">>
  ];
  group_recall: [e: OneBot.GroupMessageRecallNoticeEvent, message: OneBot.SegmentMessages];
}

export type ListenerHandler<T> = (data: T, uninstall: () => void) => void;

export default class XzQbot extends EventEmitter<XzQbotEvents> {
  private ws: WebSocket;
  private connectionPromise: Promise<void> | null = null;

  constructor(websUrl: string) {
    super();
    this.ws = new WebSocket(websUrl);
    this.ws.setMaxListeners(Infinity);
    this.installDefaultListener();
  }

  async connect() {
    if (!this.connectionPromise) {
      this.connectionPromise = new Promise((resolve) => {
        if (this.ws.readyState === WebSocket.OPEN) {
          resolve();
        } else {
          this.ws.on("open", resolve);
        }
      });
    }
    return this.connectionPromise;
  }

  private installDefaultListener() {
    const chooseHandler = (e: OneBot.Events) => {
      if (!e.post_type) return;
      if (e.post_type === "relay-welcome") this._xzQBotGroupRelayHandler(e);
      else if (e.post_type === "message") this._messageHandler(e);
      else if (e.post_type === "message_sent") this._messageHandler(e);
      else if (e.post_type === "notice") this._notifyHandler(e);
      else if (e.post_type === "meta_event") this._metaEventHandler(e);
      else if (e.post_type === "request") this._requestHandler(e);
      else {
        logger.warn("未订阅的事件", (e as any).post_type);
      }
    };
    this._createWsListener<OneBot.Events>("message", (e) => chooseHandler(e));
  }

  private _xzQBotGroupRelayHandler(e: OneBot.RelayEvent) {
    logger.info("[XzQBot Group Relay]", e.message);
  }

  private _messageHandler(e: OneBot.MessageEvent | OneBot.MessageSentEvent) {
    if (e.message_type === "group") {
      const reply: ReplyFunction<OneBot.ActionOkResponse<"send_group_msg">> = (
        message,
        reference
      ) => this._action({ action: "send_group_msg", params: { group_id: e.group_id, message } });
      this.emit("group_message", e, reply);
    } else if (e.message_type === "private") {
      const reply: ReplyFunction<OneBot.ActionOkResponse<"send_private_msg">> = (
        message,
        reference
      ) => this._action({ action: "send_private_msg", params: { user_id: e.user_id, message } });
      this.emit("private_message", e, reply);
    }
  }

  private _notifyHandler(e: OneBot.NoticeEvent) {
    if (e.notice_type === "group_recall") {
      this.getMsg(e.message_id)
        .then((resp) => {
          this.emit("group_recall", e, resp.data.message);
        })
        .catch((e) => logger.error(e));
    }
  }

  private _metaEventHandler(e: OneBot.MetaEvent) {}

  private _requestHandler(e: OneBot.RequestEvent) {}

  private __send(data: OneBot.ActionPayload<OneBot.Actions>): void {
    this.ws.send(JSON.stringify(data));
  }

  private _send<A extends OneBot.Actions>(
    params: OneBot.ActionPayload<A>
  ): Promise<OneBot.ActionOkResponse<A>> {
    if (!this.connect()) return Promise.reject("Websocket not connected");

    const echo = uuid();
    this.__send({ ...params, echo });

    return new Promise((resolve, reject) => {
      this._createWsListener("message", (data, uninstall) => {
        if (data.echo !== echo) return;
        delete data.echo;

        uninstall();
        if (data.status !== "ok") {
          reject(data.message);
          return;
        }
        resolve(data);
      });
    });
  }

  private _createWsListener<T = any>(
    eventType: keyof WebSocketEventMap,
    handler: ListenerHandler<T>
  ) {
    const listener = (event: any) => {
      const uninstall = () => {
        this.ws.removeEventListener(eventType, listener);
      };
      handler(JSON.parse(event.toString()) as T, uninstall);
    };

    this.ws.on(eventType, listener);

    return () => {
      this.ws.off(eventType, listener);
    };
  }

  /**
   * 内部方法
   * @param params ActionPayload
   * @returns
   */
  public _action = this._send;

  getLoginInfo() {
    return this._action({ action: "get_login_info", params: null });
  }

  setQQProfile(params: OneBot.ActionMap["set_qq_profile"]["params"]) {
    return this._action({ action: "set_qq_profile", params });
  }

  getQidianAccountInfo() {
    return this._action({ action: "qidian_get_account_info", params: null });
  }

  sendGroup(group_id: number, message: OneBot.SegmentMessages) {
    return this._action({ action: "send_group_msg", params: { group_id, message } });
  }

  sendPrivate(user_id: number, message: OneBot.SegmentMessages) {
    return this._action({ action: "send_private_msg", params: { user_id, message } });
  }

  getMsg(message_id: OneBot.MessageID) {
    return this._action({ action: "get_msg", params: { message_id } });
  }
}
