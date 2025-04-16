// SQLite

export namespace Database {
  export namespace Main {
    export interface SettingsTableRow {
      name: string;
      value: string;
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
