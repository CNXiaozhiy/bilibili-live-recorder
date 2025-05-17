import { RecordFileMeta, UploadFileMeta } from "@/types/bilibili";
import fs from "fs";
import path from "path";

export function generateRecordMetaFilePath(hash: string, folder: string) {
  return path.join(folder, `${hash}.meta.json`);
}

export function generateUploadMetaFilePath(hash: string, folder: string) {
  return path.join(folder, `${hash}.upload.meta.json`);
}

export function createUploadMetaFile(
  hash: string,
  folder: string,
  data: Omit<UploadFileMeta, "type" | "version" | "hash">
) {
  const metaFilePath = generateUploadMetaFilePath(hash, folder);

  const meta: UploadFileMeta = {
    type: "uploader",
    version: process.env.META_FILE_VERSION!,
    hash: hash,

    merged_record_file: data.merged_record_file,
    room_id: data.room_id,
    live_start_time: data.live_start_time,
    live_recoder_stat: data.live_recoder_stat,
    uploader_options: data.uploader_options,
  };

  fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2));

  return metaFilePath;
}

export function createRecordMetaFile(
  hash: string,
  folder: string,
  data: Omit<RecordFileMeta, "type" | "version" | "hash">
) {
  const metaFilePath = generateRecordMetaFilePath(hash, folder);

  const metaData: RecordFileMeta = {
    type: "live-recorder",
    version: process.env.META_FILE_VERSION!,
    hash: hash,

    record_files: data.record_files,
    room_id: data.room_id,
    live_start_time: new Date(data.live_room_info.live_time).getTime(),

    start_time: data.start_time,
    end_time: null,
    live_room_info: data.live_room_info,
  };

  fs.writeFileSync(metaFilePath, JSON.stringify(metaData, null, 2));

  return metaFilePath;
}

export function updateRecordMetaFile(
  hash: string,
  folder: string,
  data: Partial<Omit<RecordFileMeta, "type" | "version" | "hash">>
) {
  const metaFilePath = generateRecordMetaFilePath(hash, folder);
  const oldData = readMetaFile(metaFilePath);
  const newData = { ...oldData, ...data };
  fs.writeFileSync(metaFilePath, JSON.stringify(newData, null, 2));
}

export function getRecordMetaFile(hash: string, folder: string) {
  const metaFilePath = generateRecordMetaFilePath(hash, folder);
  return readMetaFile(metaFilePath);
}

export function deleteMetaFile(file: string) {
  fs.unlinkSync(file);
}

function readMetaFile(metaFilePath: string) {
  return JSON.parse(fs.readFileSync(metaFilePath).toString("utf-8"));
}
