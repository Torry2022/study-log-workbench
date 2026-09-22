"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AUTH_EXPIRED_EVENT, cancelWorkspaceRequests } from "@/lib/client-http";
import { withBasePath } from "@/lib/base-path";
import { LoginScreen } from "./LoginScreen";

const SessionContext = createContext({ active: false, logout: async () => {} });
export const useSession = () => useContext(SessionContext);

export function AuthGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [notice, setNotice] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setConnectionError("");
    fetch(withBasePath("/api/auth/me"), { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("连接失败，请重试");
        return response.json();
      })
      .then(value => {
        if (controller.signal.aborted) return;
        setAuthenticated(Boolean(value.authenticated));
        setHasWorkspace(Boolean(value.authenticated));
      })
      .catch(() => { if (!controller.signal.aborted) setConnectionError("连接失败，请检查实例服务后重试"); });
    const expire = () => {
      cancelWorkspaceRequests();
      setAuthenticated(false);
      setNotice("登录已过期，请重新登录以继续；当前工作区保留在此页面中");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expire);
    return () => { controller.abort(); window.removeEventListener(AUTH_EXPIRED_EVENT, expire); };
  }, [attempt]);

  async function logout() {
    const response = await fetch(withBasePath("/api/auth/logout"), { method: "POST" });
    if (!response.ok) throw new Error("退出失败，请重试");
    cancelWorkspaceRequests();
    setAuthenticated(false); setHasWorkspace(false); setNotice("");
  }

  if (authenticated === null) {
    return <main className="workspace-state workspace-state-fullscreen"><div className="workspace-state-body">
      <p className="workspace-state-title">{connectionError || "正在连接学习日志"}</p>
      {connectionError && <button className="button secondary" onClick={() => setAttempt(value => value + 1)}>重试连接</button>}
    </div></main>;
  }
  return <SessionContext.Provider value={{ active: authenticated, logout }}>
    {!authenticated && <LoginScreen notice={notice} onAuthenticated={() => { cancelWorkspaceRequests(); setHasWorkspace(true); setAuthenticated(true); setNotice(""); }} />}
    {hasWorkspace && <div hidden={!authenticated}>{children}</div>}
  </SessionContext.Provider>;
}
