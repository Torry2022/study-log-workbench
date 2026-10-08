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
        <summary>检查说明</summary>
        <div className="feature-availability-details">
          <p>Windows 桌面端本地使用：打开“文件 → 模型设置”。浏览器本地启动入口：打开“模型配置”。连接服务器：请服务器管理员检查配置或服务版本。处理后点击“重新检查”。</p>
          {messages.length > 0 && <ul>{[...new Set(messages.filter(Boolean).map(readable))].map(message => <li key={message}>{message}</li>)}</ul>}
          <button type="button" disabled={busy} onClick={onCheck}><RefreshCw size={13} aria-hidden="true" />{busy ? "检查中…" : "重新检查"}</button>
        </div>
      </details>
    </div>
  </aside>;
}
