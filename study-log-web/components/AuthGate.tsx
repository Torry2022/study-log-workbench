"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AUTH_EXPIRED_EVENT, cancelWorkspaceRequests } from "@/lib/client-http";
import { withBasePath } from "@/lib/base-path";
import { WorkspaceState } from "./WorkspaceState";
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
      .catch(() => { if (!controller.signal.aborted) setConnectionError("连接失败，请检查服务状态后重试"); });
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
    return <main><WorkspaceState kind={connectionError ? "error" : "loading"} title={connectionError ? "连接失败" : "正在连接学习日志"} description={connectionError || undefined} layout="fullscreen" actions={connectionError ? <button className="button secondary" type="button" onClick={() => setAttempt(value => value + 1)}>重试连接</button> : undefined} /></main>;
  }
  return <SessionContext.Provider value={{ active: authenticated, logout }}>
    {!authenticated && <LoginScreen notice={notice} onAuthenticated={() => { cancelWorkspaceRequests(); setHasWorkspace(true); setAuthenticated(true); setNotice(""); }} />}
    {hasWorkspace && <div hidden={!authenticated}>{children}</div>}
  </SessionContext.Provider>;
}
