import AdapterStore from "@/store/adapter";
import XzQbotPlugin from "@/lib/xz-qbot/xz-qbot-plugin";
import XzQbotNotificationAdapter from "@/lib/adapter/xz-qbot";
import WebAdapter from "@/lib/adapter/web";
import { ISubAdapter } from "@/lib/adapter";

const subAdapters: ISubAdapter[] = [];
const adaptersReady: Promise<void>[] = [];

if (process.env.ADAPTER_XZQBOT_ENABLE === "true") {
  if (!process.env.ADAPTER_XZQBOT_CONFIG_WS) throw new Error("请设置 ADAPTER_XZQBOT_CONFIG_WS");
  const xzQbotPlugin = new XzQbotPlugin(process.env.ADAPTER_XZQBOT_CONFIG_WS, {
    id: "test",
    name: "test",
    version: "1.0",
    cert: "test",
    sign: "test",
  });
  subAdapters.push(new XzQbotNotificationAdapter(xzQbotPlugin.botInstance));
  adaptersReady.push(xzQbotPlugin.ready);
}

if (process.env.ADAPTER_WEB_ENABLE === "true") {
  if (!process.env.ADAPTER_WEB_CONFIG_PORT) throw new Error("请设置 ADAPTER_WEB_CONFIG_PORT");
  subAdapters.push(new WebAdapter(parseInt(process.env.ADAPTER_WEB_CONFIG_PORT)));
}

AdapterStore.adapterInstance.register(subAdapters);

export default adaptersReady;
