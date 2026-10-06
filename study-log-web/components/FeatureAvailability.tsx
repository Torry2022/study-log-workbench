"use client";

import { Info, RefreshCw } from "lucide-react";
import "@/app/feature-availability.css";

interface Props {
  title: string;
  description: string;
  messages?: string[];
  dark?: boolean;
  busy?: boolean;
  onCheck: () => void;
}

const readable = (message: string) => message
  .replaceAll("CHAT_API_KEY", "模型访问密钥")
  .replaceAll("CHAT_API_URL", "模型服务地址")
  .replaceAll("CHAT_MODEL", "模型名称");

export function FeatureAvailability({ title, description, messages = [], dark = false, busy = false, onCheck }: Props) {
  return <aside className={`feature-availability${dark ? " on-dark" : ""}`} aria-label={title}>
    <Info size={16} aria-hidden="true" />
    <div className="feature-availability-body">
      <strong>{title}</strong>
      <p>{description}</p>
      <details>
        <summary>配置说明</summary>
        <div className="feature-availability-details">
          <p>使用 Windows 本地包时，可在启动页的“模型配置”中设置；连接服务器时，请由维护者配置。完成后重新检查。</p>
          {messages.length > 0 && <ul>{[...new Set(messages.filter(Boolean).map(readable))].map(message => <li key={message}>{message}</li>)}</ul>}
          <button type="button" disabled={busy} onClick={onCheck}><RefreshCw size={13} aria-hidden="true" />{busy ? "检查中…" : "重新检查"}</button>
        </div>
      </details>
    </div>
  </aside>;
}
