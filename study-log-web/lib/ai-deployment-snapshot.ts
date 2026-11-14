import crypto from "node:crypto";
import { aiSettingsFields } from "./ai-settings-schema.mjs";
import { getSessionSecret } from "./config.ts";

// Captured once when the server process starts; a disk .env edit takes effect after restart.
const deployment = Object.fromEntries(aiSettingsFields.map((field: string) => [field, process.env[field] || ""]));
export function deploymentSnapshot(instanceId: string) {
  const values = { ...deployment };
  const previewId = crypto.createHmac("sha256", getSessionSecret()).update(instanceId).update("\0").update(JSON.stringify(values)).digest("hex");
  let endpointDisplay = ""; try { endpointDisplay = new URL(values.CHAT_API_URL).origin; } catch { /* Invalid values remain private. */ }
  return { values, previewId, summary: { provider: values.CHAT_API_URL === "https://api.deepseek.com/chat/completions" ? "deepseek" : "custom",
    endpointDisplay, hasEndpoint: Boolean(values.CHAT_API_URL), model: values.CHAT_MODEL, hasKey: Boolean(values.CHAT_API_KEY), lightModel: values.CHAT_LIGHT_MODEL } };
}
