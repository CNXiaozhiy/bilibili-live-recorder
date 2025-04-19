import AdapterStore from "@/store/adapter";
import XzQbotPlugin from "@/lib/xz-qbot/xz-qbot-plugin";
import XzQbotNotificationAdapter from "@/lib/adapter/xz-qbot";
import { ISubAdapter } from "@/lib/adapter";

const subAdapters: ISubAdapter[] = [];
const adaptersReady: Promise<void>[] = [];

if (process.env.ADAPTER_XZQBOT_CONFIG_ENABLE === "true") {
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

AdapterStore.adapterInstance.register(subAdapters);

export default adaptersReady;
