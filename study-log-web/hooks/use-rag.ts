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
interface SessionState {
  id: string; session: RagSession | null; messages: RagChatMessage[]; question: string; answerMode: RagAnswerMode;
  unsaved: boolean; generating: boolean; saving: boolean; stage: string; error: string; saveError: string;
  pendingSave: Snapshot | null; request: AbortController | null; unread: boolean; createdAt: string;
}
function sessionState(id: string, session: RagSession | null = null): SessionState {
  return { id, session, messages: session?.messages || [], question: "", answerMode: session?.answerMode || "logs_only",
    unsaved: false, generating: false, saving: false, stage: "", error: "", saveError: "", pendingSave: null,
    request: null, unread: false, createdAt: session?.createdAt || new Date().toISOString() };
}
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
  const states = useRef(new Map<string, SessionState>([["", sessionState("")]]));
  const selectedId = useRef("");
  const mounted = useRef(true);
  const activationEpoch = useRef(0);
  const [, render] = useState(0);
  const notify = useCallback(() => { if (mounted.current && live.current.active) render(value => value + 1); }, []);
  const owned = (state: SessionState) => mounted.current && live.current.active && states.current.get(state.id) === state;
  const state = states.current.get(selectedId.current)!;
  const { session, messages, question, answerMode, unsaved, generating, saving, stage, error, saveError } = state;
  const setQuestion = (value: string) => { states.current.get(selectedId.current)!.question = value; notify(); };
  const setAnswerMode = (value: RagAnswerMode) => { states.current.get(selectedId.current)!.answerMode = value; notify(); };
  const setError = (value: string) => { states.current.get(selectedId.current)!.error = value; notify(); };
  const [query, setQuery] = useState("");
  const currentQuery = useRef(query); currentQuery.current = query;
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [initializing, setInitializing] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [configured, setConfigured] = useState(false);
  const [configurationError, setConfigurationError] = useState("");
  const [focusToken, setFocusToken] = useState(0);
  const [navigationToken, setNavigationToken] = useState(0);
  const pendingMutations = useRef(new Map<string, { method: string; body: { mutationId: string; baseVersion: string; title?: string } }>());
  const loadRequest = useRef<AbortController | null>(null);
  const titleJobs = useRef(new Map<string, Promise<{ before: string; after: RagSession } | null>>());
  const loadedRoute = useRef<string | null>(null);
  const refreshList = useCallback(async (signal?: AbortSignal) => {
    if (!live.current.active) return;
    const search = currentQuery.current;
    const result = await requestJson<{ sessions: RagSessionSummary[] }>(`/api/rag/sessions?q=${encodeURIComponent(search)}`, { signal });
    if (!Array.isArray(result.sessions)) throw new Error("历史列表响应不完整，请重试");
    if (!signal?.aborted && live.current.active && search === currentQuery.current) setSessions(result.sessions);
  }, []);
  const refreshConfiguration = useCallback(async () => {
    if (!live.current.active) return;
    try {
      const result = await requestJson<{ features: { rag?: { supported: boolean; configured: boolean; issues?: Array<{ message: string }> } } }>("/api/capabilities");
      if (!live.current.active) return;
      const enabled = Boolean(result.features?.rag?.supported && result.features.rag.configured);
      const issues = result.features?.rag?.issues?.map(issue => issue.message).filter(Boolean).join("；");
      setConfigured(enabled); setConfigurationError(enabled ? "" : issues || "问答尚未配置，请配置模型和日志检索服务；已有历史仍可查看。");
    } catch (failure) { if (live.current.active) setConfigurationError(failure instanceof Error ? failure.message : "读取配置失败"); }
  }, []);
  useEffect(() => {
    if (!options.active || !options.visible) return;
    const controller = new AbortController(); setLoading(true); setHistoryError("");
    const timer = setTimeout(() => { void refreshList(controller.signal).catch(failure => { if (!controller.signal.aborted) setHistoryError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, query ? 150 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [options.active, options.visible, query, refreshList, historyRevision]);
  useEffect(() => { if (options.active && options.visible) void refreshConfiguration(); }, [options.active, options.visible, refreshConfiguration]);
  const install = useCallback((value: SessionState) => {
    const previous = states.current.get(selectedId.current);
    if (previous?.id && previous !== value && !previous.generating && !previous.saving && !previous.unsaved && !previous.question.trim() && !previous.unread) states.current.delete(previous.id);
    states.current.set(value.id, value); selectedId.current = value.id; value.unread = false;
    notify(); setNavigationToken(token => token + 1);
  }, [notify]);
  useEffect(() => {
    if (!options.active || !options.visible) return;
    setNavigationError("");
    if (options.routeSessionId === loadedRoute.current) { setInitializing(false); return; }
    loadRequest.current?.abort(); const controller = new AbortController(); loadRequest.current = controller;
    const target = options.routeSessionId;
    const cached = states.current.get(target);
    if (cached) { loadedRoute.current = target; install(cached); setInitializing(false); return; }
    setInitializing(true);
    void requestJson<{ session: RagSession }>(`/api/rag/sessions/${encodeURIComponent(target)}`, { signal: controller.signal }).then(result => {
      if (!validSession(result.session) || result.session.id !== target) throw new Error("会话响应不完整，请重试");
      if (!controller.signal.aborted) { loadedRoute.current = target; install(sessionState(target, result.session)); }
    }).catch(failure => { if (!controller.signal.aborted) setNavigationError(failure.message); }).finally(() => { if (!controller.signal.aborted) setInitializing(false); });
    return () => controller.abort();
  }, [options.active, options.visible, options.routeSessionId, options.routeToken, install]);
  useEffect(() => {
    mounted.current = true;
    return () => {
    mounted.current = false; activationEpoch.current++;
    for (const item of states.current.values()) {
      if (item.pendingSave) item.saveError = "保存结果尚未确认，请重试保存或重新读取该会话。";
      item.request?.abort(); item.request = null; item.generating = false; item.saving = false; item.stage = "";
      if (item.messages.at(-1)?.status === "streaming") item.messages = [...item.messages.slice(0, -1), { ...item.messages.at(-1)!, status: "stopped" }];
    }
    loadRequest.current?.abort();
    };
  }, [options.active]);
  useEffect(() => {
    if (options.visible && state.unread) { state.unread = false; notify(); }
  }, [options.visible, state, notify]);
  const dirty = [...states.current.values()].some(item => item.question.trim() || item.unsaved || item.generating || item.saving);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function beforeLeave() {
    // Navigation changes only the selected view; every request and draft keeps its owner.
    const owner = states.current.get(selectedId.current)!;
    if (!owner.id && owner.question.trim()) {
      states.current.delete(""); owner.id = clientUuid(); states.current.set(owner.id, owner);
      states.current.set("", sessionState("")); selectedId.current = owner.id; notify();
    }
    return live.current.active;
  }
  async function confirmExit() {
    if (!live.current.active) return false;
    if (!dirty) return true;
    if (!(await live.current.onConfirm({ title: "退出工作台？", message: "将停止正在生成的问答，并放弃各会话未保存的回答和草稿。已保存的历史会话不受影响。", confirmLabel: "放弃并退出", tone: "danger" }))) return false;
    for (const item of states.current.values()) item.request?.abort();
    activationEpoch.current++; states.current = new Map([["", sessionState("")]]); selectedId.current = "";
    loadedRoute.current = null; titleJobs.current.clear(); notify();
    return true;
  }
  async function save(owner: SessionState, snapshot: Snapshot) {
    if (!owned(owner) || owner.saving) return;
    const epoch = activationEpoch.current;
    owner.pendingSave = snapshot; owner.saving = true; owner.saveError = ""; notify();
    // A title may finish while the next answer is being generated. Rebase only this
    // known title-only update, never a concurrent message edit or manual rename.
    const titleUpdate = await titleJobs.current.get(snapshot.id);
    if (titleUpdate && titleUpdate.before === snapshot.baseVersion) snapshot = { ...snapshot, baseVersion: titleUpdate.after.version };
    try {
      if (!owned(owner) || epoch !== activationEpoch.current) return;
      owner.pendingSave = snapshot;
      const { id, ...body } = snapshot;
      const result = await requestJson<{ session: RagSession }>(snapshot.baseVersion ? `/api/rag/sessions/${id}` : "/api/rag/sessions", {
        method: snapshot.baseVersion ? "PUT" : "POST", body: JSON.stringify(snapshot.baseVersion ? body : snapshot)
      });
      if (!owned(owner) || epoch !== activationEpoch.current) return;
      if (!validSession(result.session) || result.session.id !== snapshot.id ||
        JSON.stringify(result.session.messages.map(message => [message.id, message.content, message.status || "complete"])) !==
        JSON.stringify(snapshot.messages.map(message => [message.id, message.content, message.status || "complete"]))) throw new Error("保存响应不完整，请保留回答并重试保存");
      owner.pendingSave = null; owner.session = result.session; owner.unsaved = false;
      owner.unread = selectedId.current !== owner.id || !live.current.visible;
      if (selectedId.current === owner.id && live.current.routeSessionId === owner.id) { loadedRoute.current = owner.id; if (live.current.visible) live.current.onRoute(owner.id); }
      setSessions(list => [result.session, ...list.filter(item => item.id !== result.session.id)]);
      if (result.session.titleSource === "fallback") {
        const job = (async () => {
          try {
            const titled = await requestJson<{ session: RagSession }>(`/api/rag/sessions/${id}/title`, { method: "POST", body: JSON.stringify({ baseVersion: result.session.version }) });
            if (!validSession(titled.session) || titled.session.id !== id || JSON.stringify(titled.session.messages) !== JSON.stringify(result.session.messages)) return null;
            if (live.current.active) {
              if (owned(owner) && owner.session?.version === result.session.version) { owner.session = titled.session; notify(); }
              setSessions(list => list.map(item => item.id === id && item.version === result.session.version ? titled.session : item));
            }
            return { before: result.session.version, after: titled.session };
          } catch { return null; } // An optional title must not interrupt the saved conversation.
        })();
        titleJobs.current.set(id, job);
      }
    } catch (failure) { if (owned(owner) && epoch === activationEpoch.current) owner.saveError = failure instanceof Error ? failure.message : "保存历史失败，请重试"; }
    finally { if (owned(owner) && epoch === activationEpoch.current) { owner.saving = false; notify(); } }
  }
  async function submit(regenerate = false) {
    const state = states.current.get(selectedId.current)!;
    if (!live.current.active || !live.current.visible || !configured || state.generating || initializing || state.saving || state.pendingSave) return;
    const text = regenerate ? state.messages.at(-2)?.content || "" : state.question.trim();
    if (!text || text.length > 2000) return;
    const history = regenerate ? state.messages.slice(0, -2) : state.messages;
    if (history.length >= 198) { setError("当前会话已达到消息上限，请新建会话。"); return; }
    if (!state.id) {
      states.current.delete(""); state.id = clientUuid(); states.current.set(state.id, state);
      states.current.set("", sessionState("")); selectedId.current = state.id; loadedRoute.current = state.id;
      live.current.onRoute(state.id);
    }
    const controller = new AbortController();
    state.request = controller; state.generating = true; state.error = ""; state.stage = "正在准备问答…"; state.question = ""; state.unsaved = true;
    let next: RagChatMessage[] = [...history, { id: clientUuid(), role: "user", content: text, status: "complete" }, { id: clientUuid(), role: "assistant", content: "", status: "streaming", citations: [] }];
    state.messages = next; notify();
    const update = (patch: Partial<RagChatMessage>) => { next = [...next.slice(0, -1), { ...next.at(-1)!, ...patch }]; state.messages = next; notify(); };
    let completed = false;
    try {
      await requestRagStream({ question: text, mode: state.answerMode, history: history.map(({ role, content, citations }) => ({ role, content, ...(citations?.length ? { sourceRefs: citations.map(({ date, fileName, heading, contentHash }) => ({ date, fileName, heading, contentHash })) } : {}) })) }, controller.signal, event => {
        if (!owned(state) || state.request !== controller) return;
        if (event.kind === "status") { state.stage = event.message; notify(); }
        if (event.kind === "sources") update({ citations: event.citations });
        if (event.kind === "delta") update({ content: next.at(-1)!.content + event.text });
        if (event.kind === "done") { update({ content: event.answer, citations: event.citations, groundingWarning: event.groundingWarning, status: "complete" }); state.generating = false; state.stage = ""; completed = true; }
      });
      if (completed && owned(state) && state.request === controller) await save(state, { id: state.id, mutationId: clientUuid(), baseVersion: state.session?.version || null, answerMode: state.answerMode, messages: next });
    } catch (failure) {
      if (owned(state) && state.request === controller) {
        const stopped = controller.signal.aborted || (failure instanceof Error && failure.name === "AbortError");
        update(stopped ? { status: "stopped" } : { status: "error", error: failure instanceof Error ? failure.message : "问答失败，请重试" });
      }
    } finally { if (owned(state) && state.request === controller) { state.request = null; state.generating = false; state.stage = ""; notify(); } }
  }
  async function mutateSession(id: string, method: "PATCH" | "DELETE", title?: string) {
    try {
    const target = states.current.get(id);
    if (!live.current.active || target && (target.generating || target.saving || target.unsaved || target.question.trim())) throw new Error("请先处理该会话未保存的问答");
    const selected = target?.session || sessions.find(item => item.id === id);
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
      if (target) { target.session = result.session; notify(); }
    } else {
      if (result.ok !== true) throw new Error("删除响应不完整，请刷新历史核对");
      pendingMutations.current.delete(id);
      setSessions(list => list.filter(item => item.id !== id));
      states.current.delete(id);
      if (selectedId.current === id) { install(sessionState("")); loadedRoute.current = ""; live.current.onRoute(""); }
    }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "更新历史失败，请重试"); throw failure; }
  }
  async function reloadSession() {
    const owner = states.current.get(selectedId.current)!;
    // A failed navigation retains the previous session for reading. Retry the
    // requested route, rather than reloading and discarding that retained draft.
    const target = live.current.routeSessionId;
    const retryingNavigation = Boolean(target && target !== loadedRoute.current);
    const id = retryingNavigation ? target : owner.pendingSave?.id || owner.session?.id || owner.id || target;
    if (!id || (!retryingNavigation && (owner.generating || owner.saving)) || !(await beforeLeave())) return;
    if (!retryingNavigation && (owner.unsaved || owner.question.trim()) && !await live.current.onConfirm({ title: "重新读取当前会话？", message: "将放弃该会话未保存的回答和草稿，重新读取已保存内容。", confirmLabel: "重新读取", tone: "danger" })) return;
    loadRequest.current?.abort(); const controller = new AbortController(); loadRequest.current = controller;
    setInitializing(true); setNavigationError("");
    try {
      const result = await requestJson<{ session: RagSession }>(`/api/rag/sessions/${id}`, { signal: controller.signal });
      if (!validSession(result.session) || result.session.id !== id) throw new Error("会话响应不完整，请重试");
      if (!controller.signal.aborted && live.current.active && selectedId.current === owner.id) { install(sessionState(id, result.session)); loadedRoute.current = id; live.current.onRoute(id); pendingMutations.current.delete(id); await refreshList(); }
    } catch (failure) { if (!controller.signal.aborted && selectedId.current === owner.id) setNavigationError(failure instanceof Error ? failure.message : "读取历史失败"); }
    finally { if (!controller.signal.aborted) setInitializing(false); }
  }
  const sessionActivity: Record<string, "generating" | "saving" | "unsaved" | "unread"> = {};
  const localSessions: RagSessionSummary[] = [];
  for (const item of states.current.values()) {
    if (!item.id) continue;
    if (item.saving) sessionActivity[item.id] = "saving";
    else if (item.generating) sessionActivity[item.id] = "generating";
    else if (item.unsaved || item.question.trim()) sessionActivity[item.id] = "unsaved";
    else if (item.unread) sessionActivity[item.id] = "unread";
    if (item.session && sessionActivity[item.id] && !sessions.some(saved => saved.id === item.id)) localSessions.push(item.session);
    if (!item.session && (item.messages.length || item.question.trim())) localSessions.push({ id: item.id, title: (item.messages[0]?.content || item.question).slice(0, 60),
      createdAt: item.createdAt, updatedAt: item.createdAt, messageCount: item.messages.length, lastQuestion: item.messages.filter(message => message.role === "user").at(-1)?.content || "", version: "", titleSource: "fallback" });
  }
  const displayedSessions = [...localSessions, ...sessions.filter(item => !localSessions.some(local => local.id === item.id))];
  return { sessions: displayedSessions, activeSessionId: selectedId.current, sessionActivity, session, messages, question, setQuestion,
    answerMode, setAnswerMode, query, setQuery, loading, historyError, retryHistory: () => setHistoryRevision(value => value + 1), initializing, generating, saving, stage, error: navigationError || error, saveError, configured, configurationError, focusToken, navigationToken, dirty,
    beforeLeave, confirmExit, refreshConfiguration, refreshList, reloadSession, submit: () => submit(), regenerate: () => submit(true), stop: () => states.current.get(selectedId.current)?.request?.abort(),
    retrySave: () => { const owner = states.current.get(selectedId.current)!; if (owner.pendingSave && live.current.active && !owner.saving) void save(owner, owner.pendingSave); },
    newSession: async () => { if (await beforeLeave()) { install(sessionState("")); loadedRoute.current = ""; live.current.onRoute(""); setFocusToken(value => value + 1); return true; } return false; },
    rename: (id: string, title: string) => mutateSession(id, "PATCH", title), delete: (id: string) => mutateSession(id, "DELETE"),
    clearError: () => { setNavigationError(""); setError(""); } };
}
