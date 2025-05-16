import BilibiliLiveArManager from "@/lib/bilibili/live-ar-manager";
import express, { Router } from "express";
import crypto from "crypto";

const router = Router();

router.use(express.json());

const tokens = new Set();
const TOKEN_EXPIRE_TIME = 1000 * 60 * 60 * 24;

enum Errors {
  PARAMS_INVALID = "PARAMETERS_INVALID",
  TOKEN_INVALID = "TOKEN_INVALID",
  NOT_LOGIN_IN = "NOT_LOGIN_IN",
  NO_PERMISSION = "NO_PERMISSION",
  LOGIN_USER_NOT_FOUND = "LOGIN_USER_NOT_FOUND",
  LOGIN_USER_PASSWORD_INCORRECT = "LOGIN_USER_PASSWORD_INCORRECT",
  REGISTER_USER_EXISTS = "REGISTER_USER_EXISTS",
}

class AuthController {
  router: Router;
  constructor(private arm: BilibiliLiveArManager) {
    this.router = Router();
  }

  init() {
    this.router.post("/login", this.login.bind(this));
    this.router.post("/logout", this.login.bind(this));
  }

  async login(req: express.Request, res: express.Response) {
    try {
      if (req.body.token !== process.env.ADAPTER_WEB_CONFIG_TOKEN) throw Errors.TOKEN_INVALID;

      const token = crypto.randomBytes(32).toString("hex");
      res.cookie("token", token, { httpOnly: true, maxAge: TOKEN_EXPIRE_TIME });
      tokens.add(token);
      setTimeout(() => tokens.delete(token), TOKEN_EXPIRE_TIME);

      res.json({
        code: 0,
        msg: "ok",
      });
    } catch (err) {
      this.handleError(res, err as Errors);
    }
  }

  async logout(req: express.Request, res: express.Response) {
    try {
      if (!req.cookies.token) throw Errors.NOT_LOGIN_IN;

      tokens.delete(req.cookies.token);
      res.cookie("token", "", { httpOnly: true, maxAge: 0 });
      res.json({
        code: 0,
        msg: "ok",
      });
    } catch (err) {
      this.handleError(res, err as Errors);
    }
  }

  private handleError(res: express.Response, err: Errors) {
    switch (err) {
      case Errors.NOT_LOGIN_IN:
        res.status(403).json({
          code: 0,
          msg: "未登录",
        });
        return;
    }
    res.status(403).json({
      code: 0,
      msg: err,
    });
  }
}

class LiveRoomsController {
  router: Router;
  constructor(private arm: BilibiliLiveArManager) {
    this.router = Router();
  }

  init() {
    this.router.get("/list", this.list.bind(this));
  }

  async list(req: any, res: any) {
    res.json({
      code: 0,
      msg: "ok",
      data: this.arm.getArs().map((arInfo) => {
        return {
          roomId: arInfo.ar.roomId,
          recorder: {
            recStatus: arInfo.ar.liveRecorder.recStatus,
            segIndex: arInfo.ar.liveRecorder.segIndex,
            stat: arInfo.ar.liveRecorder.stat,
          },
          roomInfo: arInfo.ar.liveMonitor.roomInfo!,
          subscribers: arInfo.subscribers!,
        };
      }),
    });
  }
}

const getRouter = (arm: BilibiliLiveArManager) => {
  router.use("/auth", new AuthController(arm).router);
  router.use("/live-rooms", new LiveRoomsController(arm).router);

  return router;
};

export default getRouter;
