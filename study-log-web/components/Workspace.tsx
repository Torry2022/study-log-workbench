"use client";

import { useState } from "react";
import { useSession } from "./AuthGate";

export function Workspace() {
  const { logout } = useSession();
  const [error, setError] = useState("");
  return <main className="workspace-state workspace-state-fullscreen"><div className="workspace-state-body">
    <h1 className="workspace-state-title">学习日志工作台</h1>
    <p className="workspace-state-description">已连接实例，日志阅读模块正在接入。</p>
    <button className="button secondary" onClick={() => void logout().catch(() => setError("退出失败，请重试"))}>退出登录</button>
    {error && <p role="alert">{error}</p>}
  </div></main>;
}
