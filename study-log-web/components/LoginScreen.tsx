"use client";
import { useState, type FormEvent } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

function LoginKnowledgeTexture() {
  return (
    <span className="login-knowledge-texture" aria-hidden="true">
      <span className="login-knowledge-belt login-knowledge-belt-falling" />
      <span className="login-knowledge-belt login-knowledge-belt-rising" />
      <span className="login-knowledge-details" />
      <span className="login-knowledge-nodes" />
      <span className="login-knowledge-marker login-knowledge-marker-falling" />
      <span className="login-knowledge-marker login-knowledge-marker-rising" />
    </span>
  );
}

function ThemeLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`${className} theme-logo`.trim()} aria-hidden="true">
      <img className="theme-logo-light" src={withBasePath("/app-logo-light.svg")} alt="" />
      <img className="theme-logo-dark" src={withBasePath("/app-logo-dark.svg")} alt="" />
    </span>
  );
}


export function LoginScreen({ onAuthenticated, notice = "" }: { onAuthenticated: () => void; notice?: string }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true); setStatus("");
    try {
      const response = await fetch(withBasePath("/api/auth/login"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "登录失败，请重试");
      setPassword(""); onAuthenticated();
    } catch (error) { setStatus(error instanceof Error ? error.message : "登录失败，请重试"); }
    finally { setBusy(false); }
  }
  return (<main className="login-screen" aria-labelledby="login-title">
        <section className="login-identity">
          <LoginKnowledgeTexture />
          <div className="login-brand-row">
            <ThemeLogo className="brand-mark login-brand-mark" />
            <span>学习日志</span>
          </div>

          <div className="login-statement">
            <h1 id="login-title">
              学习日志
              <br />
              工作台
            </h1>
            <div className="login-statement-copy">
              <p>
                记录每天的技术学习
                <br />
                让日志易于检索、关联与回顾
              </p>
            </div>
          </div>
        </section>

        <section className="login-access" aria-labelledby="login-form-title">
          <div className="login-access-inner">
            <header className="login-access-heading">
              <h2 id="login-form-title">登录</h2>
              <p>{notice || "请输入访问密码"}</p>
            </header>

            <form onSubmit={handleLogin}>
              <div className="login-field">
                <label htmlFor="password">访问密码</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (status) setStatus("");
                  }}
                  autoComplete="current-password"
                  aria-invalid={Boolean(status)}
                  aria-describedby={status ? "login-error" : undefined}
                  autoFocus
                />
              </div>

              <div className="login-message-slot" aria-live="polite">
                {status && (
                  <p id="login-error" className="login-error" role="alert">
                    <CircleAlert size={15} aria-hidden="true" />
                    <span>{status}</span>
                  </p>
                )}
              </div>

              <button className="button primary login-submit" type="submit" disabled={busy || !password}>
                {busy && <RefreshCw className="login-spinner" size={15} aria-hidden="true" />}
                <span>{busy ? "正在登录" : "登录"}</span>
              </button>
            </form>
          </div>
          <footer className="login-footer">学习日志工作台 · 自部署实例</footer>
        </section>
      </main>);
}
