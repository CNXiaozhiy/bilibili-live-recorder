import BilibiliUploader from "@/lib/bilibili/uploader";
import bilibiliStore from "@/store/bilibili";
import { BilibiliUploaderOptions } from "@/types/bilibili";

const bilibiliUploader = new BilibiliUploader();

export const createTask = async (options: BilibiliUploaderOptions, room_id: number) => {
  const customRoomSetting = await bilibiliStore.state.db.getCustomRoomSettingByRoomId(room_id);

  let cookie;

  if (!customRoomSetting || !customRoomSetting.upload_account_uid) {
    const defaultAccount = await bilibiliStore.state.db.getDefaultBiliAccount();
    if (!defaultAccount) throw new Error("未设置默认账号");

    cookie = defaultAccount.bili_cookie;
  } else {
    const account = await bilibiliStore.state.db.getBiliAccountByUid(
      customRoomSetting.upload_account_uid
    );
    if (!account) throw new Error("账号不存在: " + customRoomSetting.upload_account_uid);

    cookie = account.bili_cookie;
  }

  return bilibiliUploader.createTask(options, cookie);
};

export const getTask = (taskId: number) => bilibiliUploader.getTask(taskId);
