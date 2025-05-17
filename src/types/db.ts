// SQLite

export namespace Database {
  export namespace Main {
    export interface SettingsTableRow {
      name: string;
      value: string;
    }

    export interface BiliAccountsTableRow {
      uid: number;
      is_default: 1 | 0;
      bili_cookie: string;
      bili_refresh_token: string;
    }

    export interface CustomRoomSettingsTableRow {
      room_id: number;
      group_id: number | null;
      notice_message_1: string | null; // 开播
      notice_message_2: string | null; // 结束
      notice_message_3: string | null; // 投稿成功
      upload_account_uid: number | null;
      upload_cover: string | null; // 图片 (BASE64)
      upload_title: string | null;
      upload_desc: string | null;
      upload_tid: number | null; // , 分割
      upload_tag: string | null; // , 分割
    }

    export interface SubscribeTableRow {
      room_id: number;
      group_id: number;
      user_id: number;
    }

    export interface QuickSubscribeTableRow {
      group_id: number;
      room_id: number;
    }

    export interface BotAdminTableRow {
      user_id: number;
      permission: number;
    }

    export type SettingsTableRows = SettingsTableRow[];
    export type SubscribeTableRows = SubscribeTableRow[];
    export type QuickSubscribeTableRows = QuickSubscribeTableRow[];
    export type BotAdminTableRows = BotAdminTableRow[];
  }
}
