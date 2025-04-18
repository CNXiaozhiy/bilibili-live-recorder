// @/utils/db.ts
import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import { Database } from "@/types/db";
import { QQNumber } from "@/types/one-bot";

export function createDatabase(dbFilePath: string): sqlite3.Database {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

  return new sqlite3.Database(dbFilePath, (err) => {
    if (err) {
      console.error("Failed to connect to database:", err.message);
      throw err;
    }
  });
}

class Main {
  db: sqlite3.Database;

  constructor(dbFilePath: string) {
    this.db = createDatabase(dbFilePath);
  }

  public _init(bilibili_cookie?: string, bilibili_refresh_token?: string) {
    try {
      this.db.serialize(() => {
        // Create tables
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS settings (
            name VARCHAR PRIMARY KEY NOT NULL,
            value VARCHAR NOT NULL
          );
          
          CREATE TABLE IF NOT EXISTS subscribe (
            room_id INTEGER NOT NULL,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY (room_id, group_id, user_id)
          );
          
          CREATE TABLE IF NOT EXISTS quick_subscribe (
            group_id INTEGER PRIMARY KEY NOT NULL,
            room_id INTEGER NOT NULL
          );
          
          CREATE TABLE IF NOT EXISTS bot_admin (
            user_id INTEGER PRIMARY KEY NOT NULL,
            permission INTEGER NOT NULL
          );
        `);

        // Initialize settings
        const settings = [
          ["bilibili_cookie", bilibili_cookie || null],
          ["bilibili_refresh_token", bilibili_refresh_token || null],
        ];
        const stmt = this.db.prepare("INSERT OR IGNORE INTO settings (name, value) VALUES (?, ?)");
        settings.forEach(([name, value]) => stmt.run(name, value));
        stmt.finalize();

        // Initialize bot admins
        const admins = process.env.BOT_ADMINS?.split(",") || [];
        const permissions = process.env.BOT_ADMIN_PERMISSIONS?.split(",") || [];

        if (admins.length !== permissions.length) {
          throw new Error("BOT_ADMINS 和 BOT_ADMIN_PERMISSIONS 长度不匹配");
        }

        const adminStmt = this.db.prepare(
          "INSERT OR REPLACE INTO bot_admin (user_id, permission) VALUES (?, ?)"
        );
        admins.forEach((userId, index) => adminStmt.run(userId.trim(), permissions[index].trim()));
        adminStmt.finalize();
      });
    } catch (error) {
      console.error("Database initialization failed:", error);
      throw error;
    }
    return this;
  }

  public getSettings() {
    return new Promise<Database.Main.SettingsTableRow[]>((resolve, reject) => {
      this.db.all<Database.Main.SettingsTableRow>("SELECT * FROM settings", (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  public getSetting(name: string) {
    return new Promise<string | null>((resolve, reject) => {
      this.db.get<Database.Main.SettingsTableRow>(
        `SELECT * FROM settings WHERE name = ?`,
        [name],
        (err, row) => {
          if (err) {
            reject(err);
          } else if (row) {
            resolve(row.value);
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  public setSetting(name: string, value: string) {
    return new Promise<void>((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)`,
        [name, value],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  public getAdmins() {
    return new Promise<Database.Main.BotAdminTableRow[]>((resolve, reject) => {
      this.db.all<Database.Main.BotAdminTableRow>("SELECT * FROM bot_admin", (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  public setAdmin(userId: string, permission: number) {
    return new Promise<void>((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO bot_admin (user_id, permission) VALUES (?, ?)`,
        [userId, permission],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  public getSubscribesTable() {
    return new Promise<Database.Main.SubscribeTableRow[]>((resolve, reject) => {
      this.db.all<Database.Main.SubscribeTableRow>("SELECT * FROM subscribe", (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  public getSubscribeTable(roomId: number) {
    return new Promise<Database.Main.SubscribeTableRow[]>((resolve, reject) => {
      this.db.all<Database.Main.SubscribeTableRow>(
        `SELECT * FROM subscribe WHERE room_id = ?`,
        [roomId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }

  public getSubscriber(roomId: number) {
    return new Promise<QQNumber[]>((resolve, reject) => {
      this.db.all<Pick<Database.Main.SubscribeTableRow, "user_id">>(
        `SELECT DISTINCT user_id FROM subscribe WHERE room_id = ?`,
        [roomId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows.map((row) => row.user_id));
          }
        }
      );
    });
  }

  /**
   * 根据房间号获取订阅了该房间的所有用户和其所在的群
   * @param roomId
   * @returns
   */
  public getSubscriberWithGroup(roomId: number) {
    return new Promise<Pick<Database.Main.SubscribeTableRow, "user_id" | "group_id">[]>(
      (resolve, reject) => {
        this.db.all<Pick<Database.Main.SubscribeTableRow, "user_id" | "group_id">>(
          `SELECT DISTINCT user_id, group_id FROM subscribe WHERE room_id = ?`,
          [roomId],
          (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows);
            }
          }
        );
      }
    );
  }

  /**
   * 根据房间号获取订阅了该房间的所有群
   * @param roomId
   * @returns groupId[]
   */
  public getSubscribedGroupsByRoom(roomId: number) {
    return new Promise<QQNumber[]>((resolve, reject) => {
      this.db.all<Pick<Database.Main.SubscribeTableRow, "group_id">>(
        `SELECT DISTINCT group_id FROM subscribe WHERE room_id = ?`,
        [roomId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows.map((row) => row.group_id));
          }
        }
      );
    });
  }

  /**
   * 根据群号获取订阅了该直播间的所有用户
   * @param groupId
   * @returns {user_id: number, room_id: number}[]
   */
  public getSubscriberByGroup(groupId: QQNumber) {
    return new Promise<Pick<Database.Main.SubscribeTableRow, "user_id" | "room_id">[]>(
      (resolve, reject) => {
        this.db.all<Pick<Database.Main.SubscribeTableRow, "user_id" | "room_id">>(
          `SELECT user_id, room_id FROM subscribe WHERE group_id = ?`,
          [groupId],
          (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows);
            }
          }
        );
      }
    );
  }

  /**
   * 获取所有被订阅了的直播间
   * @returns number[]
   */
  public getSubscribedRooms() {
    return new Promise<number[]>((resolve, reject) => {
      this.db.all<Pick<Database.Main.SubscribeTableRow, "room_id">>(
        `SELECT DISTINCT room_id FROM subscribe`,
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows.map((row) => row.room_id));
          }
        }
      );
    });
  }

  /**
   * 根据用户 ID 获取该用户订阅了的所有直播间
   * @param userId
   * @returns roomId[]
   */
  public getSubscribedRoomsByUser(userId: number) {
    return new Promise<number[]>((resolve, reject) => {
      this.db.all<Pick<Database.Main.SubscribeTableRow, "room_id">>(
        `SELECT DISTINCT room_id FROM subscribe WHERE user_id = ?`,
        [userId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows.map((row) => row.room_id));
          }
        }
      );
    });
  }

  /**
   * 根据 用户 ID 和 群ID 获取某群某用户订阅了的所有直播间
   * @param userId
   * @returns roomId[]
   */
  public getSubscribedRoomsByUserAndGroup(userId: number, groupId: number) {
    return new Promise<number[]>((resolve, reject) => {
      this.db.all<Pick<Database.Main.SubscribeTableRow, "room_id">>(
        `SELECT DISTINCT room_id FROM subscribe WHERE user_id = ? AND group_id = ?`,
        [userId, groupId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows.map((row) => row.room_id));
          }
        }
      );
    });
  }

  public insertSubscribe(roomId: number, groupId: number, userId: number) {
    return new Promise<void>((resolve, reject) => {
      this.db.run(
        `INSERT OR IGNORE INTO subscribe (room_id, group_id, user_id) VALUES (?, ?, ?)`,
        [roomId, groupId, userId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  public deleteSubscribe(roomId: number, groupId: number, userId: number) {
    return new Promise<void>((resolve, reject) => {
      this.db.run(
        `DELETE FROM subscribe WHERE room_id = ? AND group_id = ? AND user_id = ?`,
        [roomId, groupId, userId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }
}

export const Datebase = {
  Main,
};
