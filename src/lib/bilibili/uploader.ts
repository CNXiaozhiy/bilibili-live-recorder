import fs from "fs";
import path from "path";
import logger from "@/logger";
import request from "@/utils/http";
import moment from "moment";
import pLimit from "@/utils/p-limit";
import BilibiliUtils from "@/utils/bilibili";
import { getUploadID, registerVideoStorage, uploadCover, uploadVideo, validateVideo } from "./api";
import { BilibiliUploaderOptions } from "@/types/bilibili";

interface BilibiliUploaderTask {
  upload(): Promise<{ aid: number; bvid: string }>;
  status: {
    name: string;
    status: "pending" | "success" | "error";
    process?: string;
    time: string;
  }[];
}

export default class BilibiliUploader {
  cookie: string;
  CHUNK_SIZE: number;

  taskMap = new Map<number, BilibiliUploaderTask>();
  taskNowMaxId = 0;

  constructor(cookie: string, CHUNK_SIZE = 5 * 1024 * 1024) {
    this.CHUNK_SIZE = CHUNK_SIZE;
    this.cookie = cookie;
  }

  public createTask(options: BilibiliUploaderOptions) {
    const id = ++this.taskNowMaxId;

    const upload = () => this.upload(options, id);
    this.taskMap.set(id, {
      upload,
      status: [],
    });

    return { id, upload };
  }

  public getTask(taskId: number) {
    return this.taskMap.get(taskId);
  }

  private async upload(options: BilibiliUploaderOptions, taskId: number) {
    const taskList: BilibiliUploaderTask["status"] = (this.taskMap.get(taskId)!.status = []);

    /*
      function updateProgress(
        name?: string,
        status: "pending" | "success" | "error" = "pending",
        cover: boolean = false
      ) {
        const currentTask = taskList[taskList.length - 1];
        const task = { name: name || currentTask.name, status, time: moment().format("HH:mm:ss") };

        if (!name || cover) {
          taskList[taskList.length - 1] = task;
        } else {
          taskList.push(task);
        }
      }
    */

    const csrf = BilibiliUtils.getCSRF(this.cookie);

    const video_info = options.video;
    const video_file_path = options.file_path;
    const cover_base64 = options.cover_base64;
    const video_file_name = path.basename(video_file_path);
    const video_file_size = fs.statSync(video_file_path).size;
    const totalChunks = Math.ceil(video_file_size / this.CHUNK_SIZE);

    try {
      // 预上传 - 注册视频存储空间
      // updateProgress("注册视频存储空间");
      taskList[0] = {
        name: "注册视频存储空间",
        status: "pending",
        time: moment().format("HH:mm:ss"),
      };

      const registerVideoStorageResp = await registerVideoStorage(this.cookie, {
        file_name: video_file_name,
        file_size: video_file_size,
      });

      // updateProgress(undefined, "success");
      taskList[0].status = "success";

      const { endpoint, auth, biz_id } = registerVideoStorageResp;

      // 整理信息
      const upos_uri = registerVideoStorageResp.upos_uri.replace("upos://", "");
      const upload_url = `https:${endpoint}/${upos_uri}`;
      const bili_file_name = path.parse(upos_uri).name;

      // 获取上传ID
      // updateProgress("获取上传ID");
      taskList[1] = {
        name: "获取上传ID",
        status: "pending",
        time: moment().format("HH:mm:ss"),
      };

      const { upload_id } = await getUploadID(this.cookie, {
        upload_url,
        file_size: video_file_size,
        partsize: this.CHUNK_SIZE,
        biz_id,
        auth,
      });

      // updateProgress(undefined, "success");
      taskList[1].status = "success";

      // 分片上传
      // updateProgress("视频分片上传");
      taskList[2] = {
        name: "视频分片上传",
        status: "pending",
        time: moment().format("HH:mm:ss"),
      };

      const limit = pLimit(10); // 设置并发数为 10
      const uploadPromises = [];
      let successCount = 0;

      const createTask = (i: number) =>
        limit(async () => {
          // updateProgress(`视频分片上传 ${successCount}/${totalChunks} /${i + 1}`, "pending", true);
          taskList[2].process = successCount + "/" + totalChunks + " /" + (i + 1);

          await this.uploadChunk(
            i,
            upload_url,
            auth,
            upload_id,
            totalChunks,
            video_file_path,
            video_file_size
          );
          successCount++;
        });

      for (let i = 0; i < totalChunks; i++) {
        uploadPromises.push(createTask(i));
      }

      await Promise.all(uploadPromises);

      // updateProgress("视频分片上传 " + totalChunks + "/" + totalChunks, "success", true);
      taskList[2].process = totalChunks + "/" + totalChunks;
      taskList[2].status = "success";

      // 合片
      // updateProgress("视频合片（校验）");
      taskList[3] = {
        name: "视频合片（校验）",
        status: "pending",
        time: moment().format("HH:mm:ss"),
      };

      await validateVideo(this.cookie, {
        upload_url,
        file_name: bili_file_name,
        auth,
        biz_id,
        upload_id,
      });

      // updateProgress(undefined, "success");
      taskList[3].status = "success";

      // 上传封面
      // updateProgress("上传封面");
      taskList[4] = {
        name: "上传封面",
        status: "pending",
        time: moment().format("HH:mm:ss"),
      };

      const { url: cover_url } = await uploadCover(this.cookie, {
        csrf,
        cover: cover_base64,
      });

      // updateProgress(undefined, "success");
      taskList[4].status = "success";

      // 投稿视频
      // updateProgress("正式投稿视频");
      taskList[5] = {
        name: "正式投稿视频",
        status: "pending",
        time: moment().format("HH:mm:ss"),
      };

      const resp = await uploadVideo(this.cookie, {
        csrf,
        data: {
          csrf,
          cover: cover_url,
          title: video_info.title,
          copyright: 1,
          tid: video_info.tid || 27,
          tag: video_info.tag || "直播录像",
          desc_format_id: 0,
          desc: video_info.description,
          recreate: -1,
          dynamic: "",
          interactive: 0,
          videos: [
            {
              filename: bili_file_name,
              title: "",
              desc: "",
              cid: 0,
            },
          ],
          act_reserve_create: 0,
          no_disturbance: 0,
          adorder_type: 9,
          no_reprint: 1,
          subtitle: {
            open: 0,
            lan: "",
          },
          dolby: 0,
          lossless_music: 0,
          up_selection_reply: false,
          up_close_reply: false,
          up_close_danmu: false,
          web_os: 1,
        },
      });

      // updateProgress(undefined, "success");
      taskList[5].status = "success";

      logger.info("[Bili Uploader]", "投稿成功 -> ", resp);
      return resp;
    } catch (error) {
      // updateProgress(undefined, "error");
      taskList[taskList.length - 1].status = "error";
      throw error;
    }
  }

  private async uploadChunk(
    chunkIndex: number,
    upload_url: string,
    auth: string,
    upload_id: string,
    totalChunks: number,
    video_file_path: string,
    video_file_size: number
  ) {
    const start = chunkIndex * this.CHUNK_SIZE;
    const end = Math.min(start + this.CHUNK_SIZE, video_file_size);
    const chunkSize = end - start;

    const chunk = fs.createReadStream(video_file_path, { start, end });

    // 构建参数
    const params = new URLSearchParams({
      partNumber: `${chunkIndex + 1}`,
      uploadId: upload_id,
      chunk: `${start}`,
      chunks: `${totalChunks}`,
      size: `${chunkSize}`,
      start: `${start}`,
      end: `${end}`,
      total: `${video_file_size}`,
    });

    try {
      const resp = await request({
        method: "PUT",
        url: `${upload_url}?${params.toString()}`,
        headers: {
          Origin: "https://member.bilibili.com",
          Referer: "https://member.bilibili.com/",
          Connection: "keep-alive",
          "Content-Type": "application/octet-stream",
          "Content-Length": chunkSize,
          "X-Upos-Auth": auth,
          "No-Throttleo": "1",
        },
        data: chunk,
        maxBodyLength: Infinity,
        timeout: 10000,
      });

      logger.info("[Bili Uploader]", `视频分片上传 ${chunkIndex + 1}/${totalChunks}`, resp.data);
    } catch (e) {
      logger.error(
        "[Bili Uploader]",
        `视频分片上传 ${chunkIndex + 1}/${totalChunks} error`,
        (e as Error).message
      );
      logger.warn("[Bili Uploader]", `开始递归重试`);
      await this.uploadChunk(
        chunkIndex,
        upload_url,
        auth,
        upload_id,
        totalChunks,
        video_file_path,
        video_file_size
      );
    }
  }
}
