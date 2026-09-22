"use client";

import { useState } from "react";
import { useSession } from "./AuthGate";
import { WorkspaceChrome } from "./WorkspaceChrome";
import { LogReader } from "./LogReader";
import { useLogWorkspace } from "@/hooks/use-log-workspace";
import { useTheme } from "@/hooks/use-theme";

export function Workspace() {
  const { active, logout } = useSession();
  const logs = useLogWorkspace(active);
  const { theme, preference, chooseTheme } = useTheme();
  const [reading, setReading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  return <WorkspaceChrome active={active} months={logs.months} days={logs.days}
    selectedMonth={logs.selection.month} selectedDate={logs.selection.date}
    loading={logs.navigationLoading} error={logs.navigationError || sessionError} readingMode={reading}
    theme={theme} themePreference={preference} onTheme={chooseTheme}
    onMonth={logs.selectMonth} onDate={logs.selectDate} onRetry={logs.retry}
    onLogout={() => { setSessionError(""); void logout().catch(() => setSessionError("退出失败，请重试")); }}>
    <LogReader active={active} day={logs.day} date={logs.selection.date} heading={logs.selection.heading}
      scrollTarget={logs.scrollTarget} navigationRevision={logs.navigationRevision} loading={logs.loading} error={logs.error} theme={theme}
      reading={reading} onReading={setReading} onRetry={logs.retry} onNavigate={logs.selectDate} />
  </WorkspaceChrome>;
}
