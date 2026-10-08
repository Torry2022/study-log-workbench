"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmationOptions } from "@/components/ConfirmDialog";
import { requestJson } from "@/lib/client-http";
import { clientUuid, requestRagStream } from "@/lib/rag-client";
import type { RagAnswerMode, RagChatMessage, RagSession, RagSessionSummary } from "@/lib/rag-types";

interface Options {
  active: boolean; visible: boolean; routeSessionId: string; routeToken: number;
  onConfirm: (options: ConfirmationOptions) => Promise<boolean>;
  onRoute: (id: string) => void;
}
interface Snapshot { id: string; mutationId: string; baseVersion: string | null; answerMode: RagAnswerMode; messages: RagChatMessage[] }
function validSession(value: unknown): value is RagSession {
  const item = value as RagSession | undefined;
  return Boolean(item && typeof item.id === "string" && /^[a-f0-9]{64}$/.test(item.version) &&
    typeof item.title === "string" && Array.isArray(item.messages) &&
    ["logs_only", "logs_and_general"].includes(item.answerMode) && item.messages.every(message =>
      message && typeof message.id === "string" && typeof message.content === "string" && ["user", "assistant"].includes(message.role)));
}
export function useRag(options: Options) {
  const live = useRef(options); live.current = options;
  const [sessions, setSessions] = useState<RagSessionSummary[]>([]);
  const [session, setSession] = useState<RagSession | null>(null);
  const [messages, setMessages] = useState<RagChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [answerMode, setAnswerMode] = useState<RagAnswerMode>("logs_only");
  const [query, setQuery] = useState("");
  const currentQuery = useRef(query); currentQuery.current = query;
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [initializing, setInitializing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [unsaved, setUnsaved] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [configurationError, setConfigurationError] = useState("");
  const [focusToken, setFocusToken] = useState(0);
  const [navigationToken, setNavigationToken] = useState(0);
  const pendingSave = useRef<Snapshot | null>(null);
  const pendingMutations = useRef(new Map<string, { method: string; body: { mutationId: string; baseVersion: string; title?: string } }>());
  const request = useRef<AbortController | null>(null);
  const loadRequest = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const current = useRef({ session, messages, question, answerMode, unsaved });
  current.current = { session, messages, question, answerMode, unsaved };
  const loadedRoute = useRef<string | null>(null);
  const sequence = useRef(0);
  const refreshList = useCallback(async (signal?: AbortSignal) => {
    if (!live.current.active) return;
    const result = await requestJson<{ sessions: RagSessionSummary[] }>(`/api/rag/sessions?q=${encodeURIComponent(currentQuery.current)}`, { signal });
    if (!Array.isArray(result.sessions)) throw new Error("历史列表响应不完整，请重试");
    if (!signal?.aborted && live.current.active) setSessions(result.sessions);
  }, []);
  const refreshConfiguration = useCallback(async () => {
    if (!live.current.active) return;
    try {
      const result = await requestJson<{ features: { rag?: { supported: boolean; configured: boolean } } }>("/api/capabilities");
      if (!live.current.active) return;
      const enabled = Boolean(result.features?.rag?.supported && result.features.rag.configured);
      setConfigured(enabled); setConfigurationError(enabled ? "" : "问答尚未配置，请配置模型和日志检索服务；已有历史仍可查看。");
    } catch (failure) { if (live.current.active) setConfigurationError(failure instanceof Error ? failure.message : "读取配置失败"); }
  }, []);
  useEffect(() => {
    if (!options.active || !options.visible) return;
    const controller = new AbortController(); setLoading(true); setHistoryError("");
    const timer = setTimeout(() => { void refreshList(controller.signal).catch(failure => { if (!controller.signal.aborted) setHistoryError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, query ? 150 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [options.active, options.visible, query, refreshList, historyRevision]);
  useEffect(() => { if (options.active && options.visible) void refreshConfiguration(); }, [options.active, options.visible, refreshConfiguration]);
  const install = useCallback((value: RagSession | null) => {
    setSession(value); setMessages(value?.messages || []); setQuestion(""); setAnswerMode(value?.answerMode || "logs_only");
    setUnsaved(false); pendingSave.current = null; setSaveError(""); setError(""); setNavigationToken(token => token + 1);
  }, []);
  useEffect(() => {
    if (!options.active || !options.visible || options.routeSessionId === loadedRoute.current) return;
    loadRequest.current?.abort(); const controller = new AbortController(); loadRequest.current = controller;
    const target = options.routeSessionId;
    if (!target) { loadedRoute.current = ""; install(null); setInitializing(false); return; }
    setInitializing(true); setError("");
    void requestJson<{ session: RagSession }>(`/api/rag/sessions/${encodeURIComponent(target)}`, { signal: controller.signal }).then(result => {
      if (!validSession(result.session) || result.session.id !== target) throw new Error("会话响应不完整，请重试");
      if (!controller.signal.aborted) { loadedRoute.current = target; install(result.session); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setInitializing(false); });
    return () => controller.abort();
  }, [options.active, options.visible, options.routeSessionId, options.routeToken, install]);
  useEffect(() => () => { request.current?.abort(); loadRequest.current?.abort(); }, [options.active]);
  const dirty = Boolean(question.trim() || unsaved || generating || saving);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function beforeLeave() {
    if (!live.current.active || saving || initializing) return false;
    if (!dirty) return true;
    if (!(await live.current.onConfirm({ title: "离开当前问答？", message: "将停止生成并放弃未提交的问题和未保存的回答。已保存的历史会话不受影响。", confirmLabel: "放弃并离开", tone: "danger" }))) return false;
    sequence.current++; request.current?.abort(); busy.current = false; setGenerating(false); setStage("");
    install(current.current.session); return true;
  }
  async function save(snapshot: Snapshot) {
    const attempt = sequence.current;
    pendingSave.current = snapshot; setSaving(true); setSaveError("");
    try {
      const { id, ...body } = snapshot;
      const result = await requestJson<{ session: RagSession }>(snapshot.baseVersion ? `/api/rag/sessions/${id}` : "/api/rag/sessions", {
        method: snapshot.baseVersion ? "PUT" : "POST", body: JSON.stringify(snapshot.baseVersion ? body : snapshot)
      });
      if (attempt !== sequence.current || !live.current.active) return;
      if (!validSession(result.session) || result.session.id !== snapshot.id ||
        JSON.stringify(result.session.messages.map(message => [message.id, message.content, message.status || "complete"])) !==
        JSON.stringify(snapshot.messages.map(message => [message.id, message.content, message.status || "complete"]))) throw new Error("保存响应不完整，请保留回答并重试保存");
      pendingSave.current = null; setSession(result.session); setUnsaved(false);
      loadedRoute.current = result.session.id; live.current.onRoute(result.session.id);
      setSessions(list => [result.session, ...list.filter(item => item.id !== result.session.id)]);
      if (result.session.titleSource === "fallback") {
        try {
          const titled = await requestJson<{ session: RagSession }>(`/api/rag/sessions/${id}/title`, { method: "POST", body: JSON.stringify({ baseVersion: result.session.version }) });
          if (attempt !== sequence.current || !live.current.active) return;
          if (!validSession(titled.session) || titled.session.id !== id) throw new Error();
          if (JSON.stringify(titled.session.messages) !== JSON.stringify(result.session.messages)) throw new Error("会话在标题生成期间已改变");
          setSession(titled.session); setSessions(list => [titled.session, ...list.filter(item => item.id !== id)]);
        } catch { if (live.current.active) setError("回答已保存，自动标题未完成；可直接重命名会话。"); }
      }
    } catch (failure) { setSaveError(failure instanceof Error ? failure.message : "保存历史失败，请重试"); }
    finally { setSaving(false); }
  }
  async function submit(regenerate = false) {
    if (!live.current.active || !live.current.visible || !configured || busy.current || initializing || saving || pendingSave.current) return;
    const state = current.current;
    const text = regenerate ? state.messages.at(-2)?.content || "" : state.question.trim();
    if (!text || text.length > 2000) return;
    const history = regenerate ? state.messages.slice(0, -2) : state.messages;
    if (history.length >= 198) { setError("当前会话已达到消息上限，请新建会话。"); return; }
    const controller = new AbortController(), attempt = ++sequence.current;
    request.current = controller; busy.current = true; setGenerating(true); setError(""); setStage("正在准备问答…"); setQuestion(""); setUnsaved(true);
    let next: RagChatMessage[] = [...history, { id: clientUuid(), role: "user", content: text, status: "complete" }, { id: clientUuid(), role: "assistant", content: "", status: "streaming", citations: [] }];
    setMessages(next);
    const update = (patch: Partial<RagChatMessage>) => { next = [...next.slice(0, -1), { ...next.at(-1)!, ...patch }]; setMessages(next); };
    let completed = false;
    try {
      await requestRagStream({ question: text, mode: state.answerMode, history: history.map(({ role, content }) => ({ role, content })) }, controller.signal, event => {
        if (attempt !== sequence.current) return;
        if (event.kind === "status") setStage(event.message);
        if (event.kind === "sources") update({ citations: event.citations });
        if (event.kind === "delta") update({ content: next.at(-1)!.content + event.text });
        if (event.kind === "done") { update({ content: event.answer, citations: event.citations, groundingWarning: event.groundingWarning, status: "complete" }); completed = true; }
      });
      if (completed && attempt === sequence.current && live.current.active) await save({ id: state.session?.id || clientUuid(), mutationId: clientUuid(), baseVersion: state.session?.version || null, answerMode: state.answerMode, messages: next });
    } catch (failure) {
      if (attempt === sequence.current) {
        const stopped = controller.signal.aborted || (failure instanceof Error && failure.name === "AbortError");
        update(stopped ? { status: "stopped" } : { status: "error", error: failure instanceof Error ? failure.message : "问答失败，请重试" });
      }
    } finally { if (attempt === sequence.current) { busy.current = false; request.current = null; setGenerating(false); setStage(""); } }
  }
  async function mutateSession(id: string, method: "PATCH" | "DELETE", title?: string) {
    try {
    if (!live.current.active || busy.current || saving || (id === session?.id && dirty)) throw new Error("请先处理当前未保存的问答");
    const selected = sessions.find(item => item.id === id);
    if (!selected) throw new Error("会话不存在，请刷新历史");
    const previous = pendingMutations.current.get(id);
    if (previous && (previous.method !== method || previous.body.title !== title)) throw new Error("上一次操作结果尚未确认，请先重试原操作或刷新历史核对");
    const body = previous?.body || { mutationId: clientUuid(), baseVersion: selected.version, ...(title === undefined ? {} : { title }) };
    pendingMutations.current.set(id, { method, body });
    const result = await requestJson<{ session?: RagSession; ok?: boolean }>(`/api/rag/sessions/${id}`, {
      method, body: JSON.stringify(body)
    });
    if (!live.current.active) return;
    if (method === "PATCH") {
      if (!validSession(result.session) || result.session.id !== id) throw new Error("重命名响应不完整，请刷新历史核对");
      pendingMutations.current.delete(id);
      setSessions(list => list.map(item => item.id === id ? result.session! : item));
      if (session?.id === id) setSession(result.session);
    } else {
      if (result.ok !== true) throw new Error("删除响应不完整，请刷新历史核对");
      pendingMutations.current.delete(id);
      setSessions(list => list.filter(item => item.id !== id));
      if (session?.id === id) { install(null); loadedRoute.current = ""; live.current.onRoute(""); }
    }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "更新历史失败，请重试"); throw failure; }
  }
  async function reloadSession() {
    const id = pendingSave.current?.id || pendingMutations.current.keys().next().value || current.current.session?.id || live.current.routeSessionId;
    if (!id || !(await beforeLeave())) return;
    setInitializing(true);
    try {
      const result = await requestJson<{ session: RagSession }>(`/api/rag/sessions/${id}`);
      if (!validSession(result.session) || result.session.id !== id) throw new Error("会话响应不完整，请重试");
      if (live.current.active) { install(result.session); loadedRoute.current = id; live.current.onRoute(id); pendingMutations.current.delete(id); await refreshList(); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "读取历史失败"); }
    finally { setInitializing(false); }
  }
  return { sessions, session, messages, question, setQuestion,
    answerMode, setAnswerMode, query, setQuery, loading, historyError, retryHistory: () => setHistoryRevision(value => value + 1), initializing, generating, saving, stage, error, saveError, configured, configurationError, focusToken, navigationToken, dirty,
    beforeLeave, refreshConfiguration, refreshList, reloadSession, submit: () => submit(), regenerate: () => submit(true), stop: () => request.current?.abort(),
    retrySave: () => { if (pendingSave.current && live.current.active && !saving) void save(pendingSave.current); },
    newSession: async () => { if (await beforeLeave()) { install(null); loadedRoute.current = ""; live.current.onRoute(""); setFocusToken(value => value + 1); return true; } return false; },
    rename: (id: string, title: string) => mutateSession(id, "PATCH", title), delete: (id: string) => mutateSession(id, "DELETE"),
    clearError: () => setError("") };
}
