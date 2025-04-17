import BilibiliLiveAutoRecorder from "@/lib/bilibili/live-auto-recoder";
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
  liveRoomInfo?: LiveRoomInfo;
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
  cover_base64: string;

  video: {
    title: string;
    description: string;
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
  "rec-start": [];
  "rec-stoping": [];
  "rec-end": [string];
  "rec-progress": [FfmpegCommandProgress];
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

export interface LiveAutoRecorderManagerEvents {
  "hot-reload-add": [BilibiliLiveAutoRecorder];
  "hot-reload-remove": [BilibiliLiveAutoRecorder];
}

export interface AutoUploaderEvents {
  "upload-start": [number];
  "upload-success": [{ aid: number; bvid: string }];
  "upload-error": [unknown];
}
