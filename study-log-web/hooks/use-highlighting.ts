"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/client-http";
import type { HighlightedLog } from "@/lib/ai-highlighting";
import { todayInShanghai } from "@/lib/study-date";

interface Options {
  active: boolean; visible: boolean; date: string; content: string;
  onApply: (date: string, original: string, highlighted: string) => Promise<boolean>;
}
interface Capabilities {
  features: { aiHighlighting?: { supported: boolean; configured: boolean } };
  aiConfiguration?: { provider: { issues: Array<{ message: string }> }; templates: { highlighting?: { issue?: { message: string } } } };
}
export interface HighlightReview { date: string; original: string; highlighted: string; model: string; boldCount: number; warnings: string[] }
export type HighlightingController = ReturnType<typeof useHighlighting>;

export function useHighlighting(options: Options) {
  const live = useRef(options); live.current = options;
  const [review, setReview] = useState<HighlightReview | null>(null);
  const reviewRef = useRef(review); reviewRef.current = review;
  const [busy, setBusy] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const applying = useRef(false);
  const epoch = useRef(0);
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"error" | "warning" | "success">("success");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const [configurationError, setConfigurationError] = useState("");
  const configurationRef = useRef<AbortController | null>(null);
  const configured = Boolean(capabilities?.features.aiHighlighting?.supported && capabilities.features.aiHighlighting.configured);
  const configurationMessages = !capabilities ? [] : !capabilities.features.aiHighlighting?.supported ? ["此服务器尚未开放重点标注。"] : [
    ...capabilities.aiConfiguration?.provider.issues.map(issue => issue.message) || [],
    ...capabilities.aiConfiguration?.templates.highlighting?.issue ? [capabilities.aiConfiguration.templates.highlighting.issue.message] : []
  ];
  if (capabilities?.features.aiHighlighting?.supported && !configured && !configurationMessages.length) configurationMessages.push("重点标注尚未配置完成，请联系实例维护者。");
  const inputProblem = !options.date ? "请先选择左侧日块" : options.date > todayInShanghai() ? "不能标注未来日期的日志" : !options.content.trim() ? "当前日块暂无可标注内容" : options.content.length > 60_000 ? "当前日块超过 60,000 字符，暂不支持重点标注" : "";
  const stale = Boolean(review && (review.date !== options.date || review.original !== options.content));
  function feedback(message: string, kind: typeof statusKind = "success") { setStatus(message); setStatusKind(kind); }
  const refreshConfiguration = useCallback(async () => {
    if (!live.current.active) return;
    configurationRef.current?.abort(); const controller = new AbortController(); configurationRef.current = controller;
    setConfigurationLoading(true); setConfigurationError("");
    try {
      const payload = await requestJson<Capabilities>("/api/capabilities", { signal: controller.signal });
      if (!controller.signal.aborted && live.current.active) setCapabilities(payload);
    } catch (error) { if (!controller.signal.aborted && live.current.active) { setCapabilities(null); setConfigurationError(error instanceof Error ? error.message : "读取标注配置失败"); } }
    finally { if (configurationRef.current === controller) { configurationRef.current = null; setConfigurationLoading(false); } }
  }, []);
  function cancel() {
    const pending = Boolean(requestRef.current);
    requestRef.current?.abort(); requestRef.current = null; applying.current = false; epoch.current++; setBusy(false);
    if (pending) feedback("已取消标注，当前编辑草稿保持不变。", "warning");
  }
  function closeReview() { cancel(); reviewRef.current = null; setReview(null); }
  useEffect(() => {
    if (options.active) void refreshConfiguration();
    return () => configurationRef.current?.abort();
  }, [options.active, refreshConfiguration]);
  useEffect(() => () => {
    requestRef.current?.abort(); requestRef.current = null; applying.current = false; epoch.current++; setBusy(false);
    reviewRef.current = null; setReview(null); setStatus("");
  }, [options.active, options.visible, options.date]);
  async function request() {
    if (!live.current.active || !live.current.visible || requestRef.current || applying.current) return;
    if (inputProblem) { feedback(inputProblem, "warning"); return; }
    if (!configured) { feedback("请先完成重点标注配置。", "warning"); return; }
    const original = live.current.content, date = live.current.date, token = epoch.current;
    const controller = new AbortController(); requestRef.current = controller; setBusy(true); setStatus("");
    try {
      const { result } = await requestJson<{ result: HighlightedLog }>("/api/ai/bold-highlights", { method: "POST", body: JSON.stringify({ date, content: original }), signal: controller.signal });
      if (controller.signal.aborted || token !== epoch.current || !live.current.active || !live.current.visible || live.current.date !== date) return;
      const next = { date, original, highlighted: result.content, model: result.model, boldCount: result.boldCount, warnings: result.warnings };
      reviewRef.current = next; setReview(next);
      if (live.current.content !== original) feedback("当前编辑草稿已变化，请重新标注后再应用。", "warning");
    } catch (error) {
      if (!controller.signal.aborted && token === epoch.current && live.current.active) feedback(error instanceof Error ? error.message : "标注失败，请重试", "error");
    } finally { if (requestRef.current === controller) { requestRef.current = null; setBusy(false); } }
  }
  async function apply() {
    const selected = reviewRef.current;
    if (!selected || !live.current.active || !live.current.visible || requestRef.current || applying.current) return false;
    if (selected.date !== live.current.date || selected.original !== live.current.content) { feedback("当前日块或编辑草稿已变化，请重新标注后再应用。", "warning"); return false; }
    applying.current = true; setBusy(true); const token = epoch.current;
    try {
      const accepted = await live.current.onApply(selected.date, selected.original, selected.highlighted);
      if (token !== epoch.current || !live.current.active || !live.current.visible) return false;
      if (!accepted) { feedback("当前日块或编辑草稿已变化，未应用标注；请重新标注。", "warning"); return false; }
      reviewRef.current = null; setReview(null); feedback("已应用重点标注，尚未保存。"); return true;
    } catch (error) { if (token === epoch.current) feedback(error instanceof Error ? error.message : "应用标注失败，当前草稿未修改", "error"); return false; }
    finally { if (token === epoch.current) { applying.current = false; setBusy(false); } }
  }
  return { active: options.active, visible: options.visible, date: options.date, review, busy, stale, status, statusKind,
    configured, inputProblem, configurationLoading, configurationError, configurationMessages,
    refreshConfiguration, request, cancel, closeReview, apply };
}
