import BilibiliLiveAutoController from "@/lib/bilibili/live-auto-controller";
import BilibiliLiveRecorder from "@/lib/bilibili/live-recorder";

export namespace Bilibili {
  export enum LiveRoomStatus {
    "LIVE_END",
    "LIVE",
    "LIVE_SLIDESHOW",
  }

  export enum RecorderStatus {
    "NOT_RECORDING",
    "RECORDING",
    "STOPPING",
  }
}

export interface LiveRoomPlayInfo {
  current_quality: number;
  accept_quality: string[];
  current_qn: number;
  quality_description: {
    qn: number;
    desc: string;
  }[];
  durl: {
    url: string;
    length: number;
    order: number;
    stream_type: number;
    p2p_type: number;
  }[];
}

export interface UserInfo {
  card: {
    mid: number;
    name: string;
    approve: boolean;
    sex: "男" | "女";
    rank: number;
    face: string;
    face_nft: number;
    face_nft_type: number;
    DisplayRank: number;
    regtime: number;
    spacesta: number;
    birthday: string;
    place: string;
    description: string;
    article: number;
    attentions: any[];
    fans: number;
    friend: number;
    attention: number;
    sign: string;
    level_info: {
      current_level: number;
      current_min: number;
      current_exp: number;
      next_exp: number;
    };
    pendant: {
      pid: number;
      name: string;
      image: string;
      expire: number;
      image_enhance: string;
      image_enhance_frame: string;
      n_pid: number;
    };
    nameplate: {
      nid: number;
      name: string;
      image: string;
      image_small: string;
      level: string;
      condition: string;
    };
    Official: {
      role: number;
      title: string;
      desc: string;
      type: number;
    };
    official_verify: {
      type: number;
      desc: string;
    };
    vip: {
      type: number;
      status: number;
      due_date: number;
      vip_pay_type: number;
      theme_type: number;
      label: {
        path: string;
        text: string;
        label_theme: string;
        text_color: string;
        bg_style: number;
        bg_color: string;
        border_color: string;
        use_img_label: true;
        img_label_uri_hans: string;
        img_label_uri_hant: string;
        img_label_uri_hans_static: string;
        img_label_uri_hant_static: string;
      };
      avatar_subscript: number;
      nickname_color: string;
      role: number;
      avatar_subscript_url: string;
      tv_vip_status: number;
      tv_vip_pay_type: number;
      tv_due_date: number;
      avatar_icon: {
        icon_type: number;
        icon_resource: {};
      };
      vipType: number;
      vipStatus: number;
    };
    is_senior_member: number;
    name_render: null;
  };
  following: boolean;
  archive_count: number;
  article_count: number;
  follower: number;
  like_num: number;
}

export interface LoginInfo {
  isLogin: boolean; // 是否已登录
  email_verified: 0 | 1; // 是否验证邮箱地址	0：未验证 1：已验证
  face: string;
  level_info: {
    current_level: number; // 当前等级
    current_min: number; // 当前等级经验最低值
    current_exp: number; // 当前经验
    next_exp: number | "--"; // 小于6级时：num 6级时：str , 升级下一等级需达到的经验	当用户等级为Lv6时，值为--，代表无穷大
  };
  mid: number;
  mobile_verified: 0 | 1; // 	是否验证手机号	0：未验证 1：已验证
  money: number; // 拥有硬币数
  moral: number; // 当前节操值
  official: {
    role: number; // 认证类型 见 https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/user/official_role.md
    title: string; // 认证信息
    desc: string; // 认证备注
    type: 0 | -1; // 是否认证 -1：无 0：认证
  }; // 认证信息
  officialVerify: {
    type: 0 | -1; // 是否认证 -1：无 0：认证
    desc: string; // 认证信息
  }; // 认证信息 2
  pendant: {
    pid: number; // 挂件id
    name: string; // 挂件名称
    image: string; //	挂件图片url
    expire: number; //（？）
  }; // 头像框信息
  scores: number; // ?
  uname: string; // 用户昵称
  vipDueDate: number; // 会员到期时间 毫秒 时间戳
  vipStatus: 0 | 1; // 会员开通状态 0：无 1：有
  vipType: 0 | 1 | 2; // 	会员类型 0：无 1：月度大会员 2：年度及以上大会员
  vip_pay_type: 0 | 1; // 会员开通状态 0：无 1：有
  vip_theme_type: number; // ?
  vip_label: {
    path: string; //	（？）
    text: string; //	会员名称
    label_theme: "vip" | "annual_vip" | "ten_annual_vip" | "hundred_annual_vip"; //	会员标签	vip：大会员 annual_vip：年度大会员 ten_annual_vip：十年大会员 hundred_annual_vip：百年大会员
  };
  vip_avatar_subscript: 0 | 1; // 是否显示会员图标	0：不显示 1：显示
  vip_nickname_color: string; // 会员昵称颜色	颜色码
  wallet: {
    mid: number; // 登录用户mid
    bcoin_balance: number; //	拥有B币数
    coupon_balance: number; //	每月奖励B币数
    coupon_due_time: number; //	（？）
  }; //	B币钱包信息
  has_shop: boolean; // 是否拥有推广商品
  shop_url: string; // 商品推广页面 url
  allowance_count: number;
  answer_status: number;
  is_senior_member: 0 | 1; // 是否硬核会员
  wbi_img: {
    img_url: string; // Wbi 签名参数 imgKey的伪装 url	详见文档 https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/misc/sign/wbi.md
    sub_url: string; // Wbi 签名参数 subKey的伪装 url	详见文档 https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/misc/sign/wbi.md
  };
  is_jury: boolean; // 是否风纪委员
}

export interface LiveRoomInfo {
  uid: number;
  room_id: number;
  short_id: number;
  attention: number;
  online: number;
  is_portrait: boolean;
  description: string;
  live_status: Bilibili.LiveRoomStatus;
  area_id: number;
  parent_area_id: number;
  parent_area_name: string;
  old_area_id: number;
  background: string;
  title: string;
  user_cover: string;
  keyframe: string;
  is_strict_room: boolean;
  live_time: string;
  tags: string;
  is_anchor: number;
  room_silent_type: string;
  room_silent_level: number;
  room_silent_second: number;
  area_name: string;
  pendants: string;
  area_pendants: string;
  hot_words: string[];
  hot_words_status: number;
  verify: string;
  new_pendants: any;
  up_session: string;
  pk_status: number;
  pk_id: number;
  battle_id: number;
  allow_change_area_time: number;
  allow_upload_cover_time: number;
  studio_info: {
    status: number;
    master_list: any[];
  };
}

export interface VideoInfo {
  bvid: string;
  aid: string;
  videos: number;
  tid: number;
  tname: string;
  copyright: 1 | 2;
  pic: string;
  title: string;
  pubdate: number;
  ctime: number;
  desc: string;
  desc_v2: any[];
  state: number;
  duration: number;
  forward: number;
  mission_id: number;
  redirect_url: string;
  rights: any;
  owner: UserInfo;
  stat: any;
  dynamic: string;
  cid: number;
  dimension: any;
  premiere: null;
  teenage_mode: number;
  is_chargeable_season: boolean;
  is_story: boolean;
  is_upower_exclusive: boolean;
  is_upower_pay: boolean;
  is_upower_show: boolean;
  no_cache: boolean;
  pages: any[];
  subtitle: any;
  staff: any[];
  is_season_display: boolean;
  user_garb: any;
  honor_reply: any;
  like_icon: string;
  need_jump_bv: boolean;
  disable_show_up_info: boolean;
  is_story_play: boolean;
  is_view_self: boolean;
  argue_info: any;
}

export interface LiveRecoderStat {
  startTime?: Date;
  endTime?: Date;
}

export interface FfmpegCommandProgress {
  frames: number;
  currentFps: number;
  currentKbps: number;
  targetSize: number;
  timemark: string;
  percent?: number | undefined;
}

export type LiveRecorderOptions = {
  roomId: string | number;
  saveRecordFolder: string;
};

export type LiveMonitorOptions = {
  roomId: number | string;
  slideshowAsEnd?: boolean;
};

export type BilibiliUploaderOptions = {
  file_path: string;

  video: {
    title: string;
    description: string;
    cover: string;
    tid?: number;
    tag?: string;
  };
};

export type BilibiliAutoUploaderOptions = {
  roomId: number;
  liveRecorder: BilibiliLiveRecorder;
  autoClean?: boolean;
};

export type LiveAutoRecorderOptions = LiveMonitorOptions & LiveRecorderOptions;
export type LiveAutoRecorderManagerOptions = Omit<LiveAutoRecorderOptions, "roomId">;

// EVENTS

export interface LiveRecoderEvents {
  "rec-start": [string]; // hash
  "rec-stoping": [string]; // hash
  "rec-end": [string, string]; // hash, mergedFilePath
  "rec-progress": [FfmpegCommandProgress];
  "segment-change": [string, string[]];
  "rec-error": [unknown]; // fatal error
  "rec-merge-error": [unknown];
}

export interface LiveMonitorEvents {
  "status-change": [LiveRoomInfo];
  "live-start": [LiveRoomInfo];
  "live-end": [LiveRoomInfo];
  "live-slideshow": [LiveRoomInfo];
  "monitor-error": [unknown];
}

export interface LiveAutoControllerEvents {
  "upload-start": [number];
  "upload-success": [{ aid: number; bvid: string }];
  "upload-error": [unknown];
}

export interface LiveAutoControllerManagerEvents {
  "hot-reload-add": [BilibiliLiveAutoController];
  "hot-reload-remove": [BilibiliLiveAutoController];
}

// LiveRecorder.File

// *.meta.json
export interface RecordFileMeta {
  type: "live-recorder";
  version: string;
  record_files: string[]; // 原始录制文件组

  room_id: number;
  live_start_time: number;
  hash: string; // room_id + live_start_time 唯一的决定了一个直播间

  start_time: number;
  end_time: number | null;

  live_room_info: LiveRoomInfo;
}

// AutoUploader.File

// *.upload.meta.json
export interface UploadFileMeta {
  type: "uploader";
  version: string;
  merged_record_file: string;

  room_id: number;
  live_start_time: number;
  hash: string;

  live_recoder_stat: Required<LiveRecoderStat>;
  uploader_options: BilibiliUploaderOptions;
}

export type FileMeta = RecordFileMeta | UploadFileMeta;
