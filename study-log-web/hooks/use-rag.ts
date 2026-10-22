"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmationOptions } from "@/components/ConfirmDialog";
import { ApiRequestError, requestJson } from "@/lib/client-http";
import { clientUuid, requestRagStream } from "@/lib/rag-client";
import type { RagAnswerMode, RagChatMessage, RagSession, RagSessionSummary } from "@/lib/rag-types";
import { RagTaskClient, ragTaskMessages, ragTaskRetained, newestRagTask, type PendingRagTask } from "@/lib/rag-task-client";
import { ragAnswerVersions } from "@/lib/rag-answer-versions";
import { ragTaskActive, type RagTask } from "@/lib/rag-task-types";

interface Options {
  active: boolean; visible: boolean; routeSessionId: string; routeToken: number;
  onConfirm: (options: ConfirmationOptions) => Promise<boolean>;
  onRoute: (id: string) => void;
}
interface Snapshot { id: string; mutationId: string; baseVersion: string | null; answerMode: RagAnswerMode; messages: RagChatMessage[] }
interface SessionState {
  id: string; session: RagSession | null; messages: RagChatMessage[]; question: string; answerMode: RagAnswerMode;
  unsaved: boolean; generating: boolean; saving: boolean; stage: string; error: string; saveError: string;
  pendingSave: Snapshot | null; selectionSave: Snapshot | null; request: AbortController | null; unread: boolean; createdAt: string;
  task: RagTask | null; pendingTask: PendingRagTask | null; awaitingSession: boolean; viewRevision: number;
}
function sessionState(id: string, session: RagSession | null = null): SessionState {
  return { id, session, messages: session?.messages || [], question: "", answerMode: session?.answerMode || "logs_only",
    unsaved: false, generating: false, saving: false, stage: "", error: "", saveError: "", pendingSave: null, selectionSave: null,
    request: null, unread: false, createdAt: session?.createdAt || new Date().toISOString(), task: null, pendingTask: null, awaitingSession: false, viewRevision: 0 };
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
  const [taskCapability, setTaskCapability] = useState<{ instanceId: string; supported: boolean; ready: boolean } | null>(null);
  const taskClient = useRef<RagTaskClient | null>(null);
  const taskScope = useRef("");
  const taskSnapshots = useRef(new Map<string, RagTask>());
  const answerViews = useRef(new Map<string, Map<string, string>>());
  const deletedSessions = useRef(new Set<string>());
  const submittedTasks = useRef(new Set<string>());
  const [taskConnectionError, setTaskConnectionError] = useState("");
  const [focusToken, setFocusToken] = useState(0);
  const [navigationToken, setNavigationToken] = useState(0);
  const [answerStartToken, setAnswerStartToken] = useState(0);
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
    const epoch = activationEpoch.current;
    try {
      const result = await requestJson<{ instanceId: string; features: { ragTasks?: { supported: boolean; configured: boolean; protocolVersion: number }; rag?: { supported: boolean; configured: boolean; issues?: Array<{ message: string }> } } }>("/api/capabilities");
      if (!live.current.active || epoch !== activationEpoch.current) return;
      const tasks = result.features?.ragTasks;
      // Only an absent capability is the legacy path. An advertised but unavailable runtime must not silently lose durability.
      setTaskCapability({ instanceId: result.instanceId, supported: Boolean(tasks?.supported), ready: Boolean(tasks?.configured && tasks.protocolVersion === 1) });
      const enabled = Boolean(result.features?.rag?.supported && result.features.rag.configured);
      const issues = result.features?.rag?.issues?.map(issue => issue.message).filter(Boolean).join("；");
      const taskReady = !tasks?.supported || tasks.configured && tasks.protocolVersion === 1;
      setConfigured(enabled && taskReady); setConfigurationError(!taskReady ? "问答任务执行器尚未就绪，请稍后重试检查。" : enabled ? "" : issues || "问答尚未配置，请配置模型和日志检索服务；已有历史仍可查看。");
    } catch (failure) { if (live.current.active && epoch === activationEpoch.current) { setConfigured(false); setConfigurationError(failure instanceof Error ? failure.message : "读取配置失败"); } }
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
    if (previous?.id && previous !== value && !previous.generating && !previous.saving && !previous.unsaved && !previous.pendingSave && !previous.question.trim() && !previous.unread) states.current.delete(previous.id);
    states.current.set(value.id, value); selectedId.current = value.id; value.unread = false;
    if (value.id && taskClient.current) void taskClient.current.readSession(value.id).catch(failure => { if (states.current.get(value.id) === value) { value.error = failure.message; notify(); } });
    notify(); setNavigationToken(token => token + 1);
  }, [notify]);
  useEffect(() => {
    if (!options.active || !taskCapability) return;
    if (taskScope.current && taskScope.current !== taskCapability.instanceId) {
      for (const item of states.current.values()) item.request?.abort();
      states.current = new Map([["", sessionState("")]]); selectedId.current = ""; loadedRoute.current = null;
      titleJobs.current.clear(); submittedTasks.current.clear(); taskSnapshots.current.clear(); answerViews.current.clear(); deletedSessions.current.clear(); setSessions([]); setNavigationToken(token => token + 1); live.current.onRoute(""); notify();
    }
    taskScope.current = taskCapability.instanceId;
    if (!taskCapability.supported) { setTaskConnectionError(""); return; }
    if (!taskCapability.ready) return;
    const titleKey = `study-log:rag-title:v1:${taskCapability.instanceId}`;
    try {
      const saved: unknown = JSON.parse(window.sessionStorage.getItem(titleKey) || "[]");
      if (Array.isArray(saved)) submittedTasks.current = new Set(saved.filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)));
    } catch { /* Optional titles must not block task recovery. */ }
    const rememberTitleOwners = () => {
      try { window.sessionStorage.setItem(titleKey, JSON.stringify([...submittedTasks.current])); } catch { /* Only title recovery is unavailable. */ }
    };
    let client: RagTaskClient;
    const current = () => taskClient.current === client && live.current.active;
    const ownerFor = (id: string) => {
      let owner = states.current.get(id);
      if (!owner) { owner = sessionState(id); states.current.set(id, owner); }
      return owner;
    };
    try {
      client = new RagTaskClient(taskCapability.instanceId, window.localStorage, {
        pending(input) {
          if (!current() || deletedSessions.current.has(input.sessionId)) return;
          submittedTasks.current.add(input.submissionId); rememberTitleOwners();
          const owner = ownerFor(input.sessionId);
          if (owner.task?.submissionId === input.submissionId) return;
          answerViews.current.delete(owner.id); owner.viewRevision++;
          owner.pendingTask = input; owner.generating = true; owner.createdAt = input.createdAt;
          owner.stage = input.cancelRequested ? "正在确认停止…" : "正在确认问答任务…";
          const previous = owner.session?.messages || [];
          owner.messages = [...(input.replaceLast ? previous.slice(0, -2) : previous), { id: `${input.submissionId}:user`, role: "user", content: input.question, status: "complete" },
            { id: `${input.submissionId}:assistant`, role: "assistant", content: "", status: "streaming" }];
          notify();
        },
        async task(task) {
          if (!current() || deletedSessions.current.has(task.sessionId)) return;
          taskSnapshots.current.set(task.id, task);
          const owner = ownerFor(task.sessionId), previous = owner.task;
          const latest = newestRagTask(taskSnapshots.current.values(), owner.id);
          if (latest?.id !== task.id) { notify(); return; }
          owner.task = task; owner.pendingTask = null; owner.generating = ragTaskActive(task); owner.unsaved = false;
          if (!ragTaskActive(task) && task.state !== "succeeded" && submittedTasks.current.delete(task.submissionId)) rememberTitleOwners();
          owner.answerMode = task.mode; owner.createdAt = task.createdAt; owner.error = "";
          owner.stage = task.state === "queued" ? "正在等待前一项问答完成…" : task.stage;
          owner.saving = task.state === "succeeded" && (task.saveState === "pending" || task.saveState === "saved" && previous?.saveState !== "saved");
          owner.saveError = task.state === "succeeded" && ["conflict", "error"].includes(task.saveState) ? task.saveError || "回答已保留，尚未写入会话" : "";
          // Show the complete result while fetching the authoritative session, never append a snapshot delta.
          if (task.saveState !== "saved" || !previous || previous.saveState !== "saved" || previous.id !== task.id) owner.messages = ragTaskMessages({ ...task, saveState: task.saveState === "saved" ? "pending" : task.saveState }, owner.session, task.id !== latest?.id);
          if (live.current.routeSessionId === task.sessionId && selectedId.current !== task.sessionId) {
            loadRequest.current?.abort(); loadedRoute.current = task.sessionId; install(owner); setInitializing(false); setNavigationError("");
          }
          if (!ragTaskActive(task)) owner.unread = selectedId.current !== owner.id || !live.current.visible;
          notify();
          if (!owner.session || task.saveState === "saved" && previous?.saveState !== "saved") {
            if (task.saveState === "saved") owner.awaitingSession = true;
            try {
              const result = await requestJson<{ session: RagSession }>(`/api/rag/sessions/${task.sessionId}`);
              if (!validSession(result.session) || result.session.id !== task.sessionId) throw new Error("会话响应不完整，请重新读取");
              if (!current() || owner.task !== task || states.current.get(owner.id) !== owner) return;
              owner.session = result.session; owner.messages = ragTaskMessages(task, result.session, task.id !== newestRagTask(taskSnapshots.current.values(), owner.id)?.id); owner.awaitingSession = false;
              setSessions(list => [result.session, ...list.filter(item => item.id !== owner.id)]);
              if (task.saveState === "saved" && submittedTasks.current.delete(task.submissionId)) { rememberTitleOwners(); generateTitle(owner, result.session); }
            } catch (failure) {
              if (!current() || owner.task !== task) return;
              if (task.saveState === "saved") owner.error = "回答已在服务端保存，但读取会话失败，请重新读取。";
            }
          }
          if (current() && owner.task === task) { owner.saving = task.state === "succeeded" && task.saveState === "pending"; if (task.saveState === "saved") void refreshList().catch(() => {}); notify(); }
        },
        rejected(input, failure) {
          if (!current() || deletedSessions.current.has(input.sessionId)) return;
          const owner = ownerFor(input.sessionId);
          if (owner.pendingTask?.submissionId !== input.submissionId) return;
          owner.pendingTask = null; owner.generating = false; owner.stage = ""; owner.messages = owner.session?.messages || [];
          submittedTasks.current.delete(input.submissionId); rememberTitleOwners();
          owner.question ||= input.question; owner.error = failure.message; notify();
        },
        missing(task) {
          if (!current()) return;
          taskSnapshots.current.delete(task.id);
          const owner = states.current.get(task.sessionId);
          if (!owner || owner.task?.id !== task.id && [...taskSnapshots.current.values()].some(item => item.sessionId === owner.id)) return;
          void showSavedSession(owner);
          notify();
        },
        error(message) { if (current()) setTaskConnectionError(message); }
      });
      for (const task of taskSnapshots.current.values()) client.track(task);
      taskClient.current = client; client.start();
      client.viewSession(live.current.visible ? selectedId.current : "");
      if (selectedId.current) void client.readSession(selectedId.current).catch(failure => { if (current()) setTaskConnectionError(failure.message); });
    } catch (failure) { setTaskConnectionError(failure instanceof Error ? failure.message : "任务恢复不可用"); }
    return () => { client?.stop(); if (taskClient.current === client) taskClient.current = null; };
  }, [options.active, taskCapability?.instanceId, taskCapability?.supported, taskCapability?.ready, install, notify, refreshList]);
  useEffect(() => { taskClient.current?.viewSession(options.active && options.visible ? state.id : ""); }, [options.active, options.visible, state.id]);
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
      if ((item.task || item.pendingTask) && !item.selectionSave) continue; // Disconnecting a view never cancels a server-owned task.
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
  const dirty = [...states.current.values()].some(item => item.question.trim() || item.unsaved || item.pendingSave || !item.task && !item.pendingTask && (item.generating || item.saving));
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
    if (!(await live.current.onConfirm({ title: "退出工作台？", message: taskCapability?.supported ? "将放弃尚未发送的草稿。已提交的问答继续由服务器处理，重新登录后可以查看。" : "将停止正在生成的问答，并放弃各会话未保存的回答和草稿。已保存的历史会话不受影响。", confirmLabel: "放弃并退出", tone: "danger" }))) return false;
    for (const item of states.current.values()) item.request?.abort();
    activationEpoch.current++; states.current = new Map([["", sessionState("")]]); selectedId.current = "";
    loadedRoute.current = null; titleJobs.current.clear(); notify();
    return true;
  }
  async function showSavedSession(owner: SessionState, resetView = false) {
    const revision = ++owner.viewRevision, epoch = activationEpoch.current;
    const draft = owner.question;
    owner.task = null; owner.generating = false; owner.stage = ""; owner.saveError = ""; owner.saving = true; owner.awaitingSession = true;
    owner.messages = owner.session?.messages || []; notify();
    const current = () => owned(owner) && epoch === activationEpoch.current && owner.viewRevision === revision;
    try {
      const result = await requestJson<{ session: RagSession }>(`/api/rag/sessions/${owner.id}`);
      if (!validSession(result.session) || result.session.id !== owner.id) throw new Error("会话响应不完整，请重新读取");
      if (!current()) return;
      owner.session = result.session; owner.messages = result.session.messages; owner.awaitingSession = false; owner.error = "";
      if (resetView) { answerViews.current.delete(owner.id); if (owner.question === draft) owner.question = ""; }
      setSessions(list => [result.session, ...list.filter(item => item.id !== owner.id)]);
    } catch (failure) {
      if (!current()) return;
      if (failure instanceof ApiRequestError && failure.status === 404) {
        const remaining = [...taskSnapshots.current.values()].some(task => task.sessionId === owner.id);
        if (owner.session || !remaining) {
          deletedSessions.current.add(owner.id);
          for (const task of taskSnapshots.current.values()) if (task.sessionId === owner.id) taskSnapshots.current.delete(task.id);
          answerViews.current.delete(owner.id); states.current.delete(owner.id); setSessions(list => list.filter(item => item.id !== owner.id));
          if (selectedId.current === owner.id) { install(sessionState("")); loadedRoute.current = ""; live.current.onRoute(""); setNavigationError("该会话已被删除，已停止恢复。"); }
        } else { owner.messages = []; owner.awaitingSession = false; owner.error = "该会话尚无已保存回答，可查看对应问题下保留的回答。"; }
      } else owner.error = failure instanceof Error ? failure.message : "读取会话失败，请重试";
    } finally { if (current()) { owner.saving = false; notify(); } }
  }
  function answerProjection(owner: SessionState) {
    const tasks = [...taskSnapshots.current.values()].filter(task => task.sessionId === owner.id);
    return ragAnswerVersions(owner.session?.messages || (tasks.length ? [] : owner.messages), tasks,
      answerViews.current.get(owner.id) || new Map(), owner.awaitingSession ? owner.task?.id : undefined);
  }
  function selectAnswerVersion(questionId: string, answerId: string) {
    const owner = states.current.get(selectedId.current)!;
    if (owner.saving && owner.selectionSave) return;
    const answer = answerProjection(owner).messages.find(message => message.questionId === questionId);
    if (!answer?.versions?.includes(answerId)) return;
    const choices = answerViews.current.get(owner.id) || new Map<string, string>();
    choices.set(questionId, answerId); answerViews.current.set(owner.id, choices); notify();
  }
  async function commitAnswerSelection(owner: SessionState) {
    const saved = owner.session, questionId = saved?.messages.at(-2)?.id;
    const answer = answerProjection(owner).messages.find(message => message.questionId === questionId);
    if (!saved || !answer || answer.id === saved.messages.at(-1)?.id) return true;
    if (!answer.content.trim() || ["streaming", "error", "stopped"].includes(answer.status || "")) {
      owner.error = "所选回答尚未完整，请选择完整回答后再继续提问。"; notify(); return false;
    }
    const selected: RagChatMessage = { id: answer.id, role: "assistant", content: answer.content,
      citations: answer.citations || [], status: "complete",
      ...(answer.groundingWarning === undefined ? {} : { groundingWarning: answer.groundingWarning }) };
    const messages = [...saved.messages.slice(0, -1), selected];
    if (owner.selectionSave?.baseVersion !== saved.version || JSON.stringify(owner.selectionSave.messages) !== JSON.stringify(messages)) {
      owner.selectionSave = { id: owner.id, mutationId: clientUuid(), baseVersion: saved.version, answerMode: saved.answerMode, messages };
    }
    await save(owner, owner.selectionSave);
    return owned(owner) && !owner.pendingSave && !owner.saveError && owner.session?.messages.at(-1)?.id === answer.id;
  }
  async function saveAnswer(taskId: string) {
    const owner = states.current.get(selectedId.current)!;
    if (!live.current.active || owner.saving || !taskClient.current || !answerProjection(owner).messages.some(message => message.taskId === taskId && message.canSave)) return;
    owner.saving = true; notify();
    try {
      await taskClient.current.save(taskId);
      if (owned(owner) && owner.task?.id !== taskId) {
        const result = await requestJson<{ session: RagSession }>(`/api/rag/sessions/${owner.id}`);
        if (!validSession(result.session) || result.session.id !== owner.id) throw new Error("会话响应不完整，请重新读取");
        if (owned(owner)) owner.session = result.session;
      }
    }
    catch (failure) { if (owned(owner)) owner.error = failure instanceof Error ? failure.message : "保存重试失败"; }
    finally { if (owned(owner)) { owner.saving = false; notify(); } }
  }
  async function discardAnswer(taskId: string) {
    const owner = states.current.get(selectedId.current)!;
    if (!live.current.active || owner.saving || !taskClient.current || !answerProjection(owner).messages.some(message => message.taskId === taskId && message.canDiscard)) return;
    if (!await live.current.onConfirm({ title: "放弃此回答？", message: "只放弃这份尚未保存的回答，已保存会话和输入草稿会保留。", confirmLabel: "放弃", tone: "danger" }) || !owned(owner)) return;
    owner.saving = true; notify();
    try { await taskClient.current.remove(taskId); taskSnapshots.current.delete(taskId); if (owner.task?.id === taskId) { owner.task = null; owner.messages = owner.session?.messages || []; owner.saveError = ""; } }
    catch (failure) { if (owned(owner)) owner.error = failure instanceof Error ? failure.message : "放弃回答失败"; }
    finally { if (owned(owner)) { owner.saving = false; notify(); } }
  }
  function generateTitle(owner: SessionState, saved: RagSession) {
    if (saved.titleSource !== "fallback") return;
    const job = (async () => {
      try {
        const titled = await requestJson<{ session: RagSession }>(`/api/rag/sessions/${saved.id}/title`, { method: "POST", body: JSON.stringify({ baseVersion: saved.version }) });
        if (!validSession(titled.session) || titled.session.id !== saved.id || JSON.stringify(titled.session.messages) !== JSON.stringify(saved.messages)) return null;
        if (live.current.active) {
          if (owned(owner) && owner.session?.version === saved.version) { owner.session = titled.session; notify(); }
          setSessions(list => list.map(item => item.id === saved.id && item.version === saved.version ? titled.session : item));
        }
        return { before: saved.version, after: titled.session };
      } catch { return null; } // Optional titles never interrupt a saved conversation.
    })();
    titleJobs.current.set(saved.id, job);
  }
  async function save(owner: SessionState, snapshot: Snapshot) {
    if (!owned(owner) || owner.saving) return;
    const epoch = activationEpoch.current;
    const committingSelection = owner.selectionSave?.mutationId === snapshot.mutationId;
    owner.pendingSave = snapshot; owner.saving = true; owner.saveError = ""; notify();
    // A title may finish while the next answer is being generated. Rebase only this
    // known title-only update, never a concurrent message edit or manual rename.
    const titleJob = titleJobs.current.get(snapshot.id);
    // Selection may use a completed title update, but an optional title must not delay sending.
    const titleUpdate = committingSelection ? await Promise.race([titleJob, Promise.resolve(null)]) : await titleJob;
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
      if (committingSelection) {
        owner.messages = result.session.messages; owner.selectionSave = null;
        const questionId = snapshot.messages.at(-2)?.id, choices = answerViews.current.get(owner.id);
        if (questionId && choices && choices.get(questionId) === snapshot.messages.at(-1)?.id) choices.delete(questionId);
      }
      owner.unread = selectedId.current !== owner.id || !live.current.visible;
      if (selectedId.current === owner.id && live.current.routeSessionId === owner.id) { loadedRoute.current = owner.id; if (live.current.visible) live.current.onRoute(owner.id); }
      setSessions(list => [result.session, ...list.filter(item => item.id !== result.session.id)]);
      if (!committingSelection) generateTitle(owner, result.session);
    } catch (failure) { if (owned(owner) && epoch === activationEpoch.current) owner.saveError = failure instanceof Error ? failure.message : "保存历史失败，请重试"; }
    finally { if (owned(owner) && epoch === activationEpoch.current) { owner.saving = false; notify(); } }
  }
  async function submit(regenerate = false) {
    const state = states.current.get(selectedId.current)!;
    if (!live.current.active || !live.current.visible || !configured || state.generating || initializing || state.saving || state.pendingSave || state.awaitingSession) return;
    if (state.task && state.task.id !== newestRagTask(taskSnapshots.current.values(), state.id)?.id || [...taskSnapshots.current.values()].some(task => task.sessionId === state.id && ragTaskActive(task) && task.id !== state.task?.id)) return;
    if (regenerate && (answerProjection(state).historical || state.question.trim())) return;
    const text = regenerate ? state.messages.at(-2)?.content || "" : state.question.trim();
    if (!text || text.length > 2000) return;
    if (!regenerate && !(await commitAnswerSelection(state))) return;
    if (!owned(state) || selectedId.current !== state.id || !live.current.active || !live.current.visible) return;
    if (!regenerate && state.question.trim() !== text) return;
    const history = regenerate ? state.messages.slice(0, -2) : state.messages;
    if (history.length >= 198) { setError("当前会话已达到消息上限，请新建会话。"); return; }
    if (!state.id) {
      states.current.delete(""); state.id = clientUuid(); states.current.set(state.id, state);
      states.current.set("", sessionState("")); selectedId.current = state.id; loadedRoute.current = state.id;
      live.current.onRoute(state.id);
    }
    if (taskCapability?.supported) {
      if (!taskClient.current || state.pendingTask) return;
      const retryingTask = regenerate && state.task && state.task.state !== "succeeded";
      const input: PendingRagTask = { submissionId: clientUuid(), sessionId: state.id, baseVersion: state.session?.version || null,
        question: text, mode: state.answerMode, createdAt: new Date().toISOString(),
        ...(retryingTask ? { retryTaskId: state.task!.id } : {}),
        ...(regenerate && (!retryingTask || state.task?.replaceLast) ? { replaceLast: true } : {}) };
      state.question = ""; state.error = "";
      try { setAnswerStartToken(value => value + 1); await taskClient.current.submit(input); }
      catch (failure) { if (owned(state)) { state.question = text; state.error = failure instanceof Error ? failure.message : "无法保存提交身份，尚未发起问答"; notify(); } }
      return;
    }
    const controller = new AbortController();
    setAnswerStartToken(value => value + 1);
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
    if (!live.current.active || target && (target.generating || target.saving || target.unsaved || target.saveError || target.question.trim())) throw new Error("请先处理该会话未保存的问答");
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
      deletedSessions.current.add(id); answerViews.current.delete(id);
      for (const task of taskSnapshots.current.values()) if (task.sessionId === id) taskSnapshots.current.delete(task.id);
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
    if (!retryingNavigation && !owner.pendingSave && owner.task && taskClient.current && !owner.generating && !owner.saving) {
      const selected = owner.task, revision = owner.viewRevision;
      const discard = selected.state === "succeeded" && selected.saveState !== "saved";
      if ((discard || owner.question.trim()) && !await live.current.onConfirm({ title: "重新读取当前会话？", message: "将放弃当前选中的未保存回答和草稿，其他问答结果不受影响。", confirmLabel: "重新读取", tone: "danger" })) return;
      if (!owned(owner) || owner.task?.id !== selected.id || owner.viewRevision !== revision) return;
      try {
        if (discard) {
          owner.saving = true; notify(); await taskClient.current.remove(selected.id); taskSnapshots.current.delete(selected.id);
        }
        await showSavedSession(owner, true);
      } catch (failure) { if (owned(owner) && owner.task?.id === selected.id) { owner.saving = false; owner.saveError = failure instanceof Error ? failure.message : "放弃结果未完成，请重试"; notify(); } }
      return;
    }
    const id = retryingNavigation ? target : owner.pendingSave?.id || owner.session?.id || owner.id || target;
    if (!id || (!retryingNavigation && (owner.generating || owner.saving)) || !(await beforeLeave())) return;
    if (!retryingNavigation && (owner.unsaved || owner.question.trim()) && !await live.current.onConfirm({ title: "重新读取当前会话？", message: "将放弃该会话未保存的回答和草稿，重新读取已保存内容。", confirmLabel: "重新读取", tone: "danger" })) return;
    loadRequest.current?.abort(); const controller = new AbortController(); loadRequest.current = controller;
    setInitializing(true); setNavigationError("");
    try {
      const result = await requestJson<{ session: RagSession }>(`/api/rag/sessions/${id}`, { signal: controller.signal });
      if (!validSession(result.session) || result.session.id !== id) throw new Error("会话响应不完整，请重试");
      if (!controller.signal.aborted && live.current.active && selectedId.current === owner.id) { answerViews.current.delete(id); install(sessionState(id, result.session)); loadedRoute.current = id; live.current.onRoute(id); pendingMutations.current.delete(id); await refreshList(); }
    } catch (failure) { if (!controller.signal.aborted && selectedId.current === owner.id) {
      setNavigationError(failure instanceof Error ? failure.message : "读取历史失败");
    } }
    finally { if (!controller.signal.aborted) setInitializing(false); }
  }
  const sessionActivity: Record<string, "generating" | "saving" | "unsaved" | "unread"> = {};
  const localSessions: RagSessionSummary[] = [];
  for (const item of states.current.values()) {
    if (!item.id) continue;
    if (item.generating || [...taskSnapshots.current.values()].some(task => task.sessionId === item.id && ragTaskActive(task))) sessionActivity[item.id] = "generating";
    else if (item.saving) sessionActivity[item.id] = "saving";
    else if (item.unsaved || item.pendingSave || item.saveError || item.question.trim() || item.task && item.task.state !== "succeeded" || [...taskSnapshots.current.values()].some(task => task.sessionId === item.id && ragTaskRetained(task))) sessionActivity[item.id] = "unsaved";
    else if (item.unread) sessionActivity[item.id] = "unread";
    if (item.session && sessionActivity[item.id] && !sessions.some(saved => saved.id === item.id)) localSessions.push(item.session);
    if (!item.session && (item.messages.length || item.question.trim())) localSessions.push({ id: item.id, title: (item.messages[0]?.content || item.question).slice(0, 60),
      createdAt: item.createdAt, updatedAt: item.createdAt, messageCount: item.messages.length, lastQuestion: item.messages.filter(message => message.role === "user").at(-1)?.content || "", version: "", titleSource: "fallback" });
  }
  const displayedSessions = [...localSessions, ...sessions.filter(item => !localSessions.some(local => local.id === item.id))];
  const latestTask = newestRagTask(taskSnapshots.current.values(), state.id);
  const projection = answerProjection(state);
  const parentQuestionId = state.session?.messages.at(-2)?.id;
  const selectedParent = parentQuestionId ? projection.messages.find(message => message.questionId === parentQuestionId) : undefined;
  const displayMessages = taskCapability?.supported && !state.pendingTask ? projection.messages : messages;
  const otherActive = [...taskSnapshots.current.values()].some(task => task.sessionId === state.id && ragTaskActive(task) && task.id !== state.task?.id);
  const historicalTask = Boolean(state.task && state.task.id !== latestTask?.id);
  return { sessions: displayedSessions, activeSessionId: selectedId.current, sessionActivity, session, messages: displayMessages, question, setQuestion,
    answerMode, setAnswerMode, query, setQuery, loading, historyError: historyError || taskConnectionError, retryHistory: () => { setHistoryRevision(value => value + 1); void taskClient.current?.refresh(); }, initializing, generating, saving, stage, error: navigationError || error, saveError, serverTask: Boolean(state.task), savingSelection: Boolean(state.selectionSave), submissionBlocked: state.awaitingSession || historicalTask || otherActive, canRetrySave: Boolean(state.pendingSave) || state.task?.saveState !== "conflict", configured, configurationError, focusToken, navigationToken, answerStartToken, dirty,
    viewingPreviousAnswer: Boolean(selectedParent && selectedParent.id !== state.session?.messages.at(-1)?.id), selectAnswerVersion, saveAnswer, discardAnswer,
    beforeLeave, confirmExit, refreshConfiguration, refreshList, reloadSession, submit: () => submit(), regenerate: (answerId?: string) => { if (answerId) { const answer = answerProjection(states.current.get(selectedId.current)!).messages.find(message => message.id === answerId); if (!answer?.canRegenerate && !answer?.canRetry) return; } return submit(true); }, stop: () => {
      const owner = states.current.get(selectedId.current)!;
      if (owner.task || owner.pendingTask) void (owner.pendingTask ? taskClient.current?.stopSession(owner.id) : owner.task && taskClient.current?.cancel(owner.task.id))?.catch(failure => { owner.error = failure.message; notify(); });
      else owner.request?.abort();
    },
    retrySave: () => { const owner = states.current.get(selectedId.current)!;
      if (owner.pendingSave && live.current.active && !owner.saving) void save(owner, owner.pendingSave);
      else if (owner.task && taskClient.current && live.current.active && !owner.saving) {
        const taskId = owner.task.id;
        owner.saving = true; notify();
        void taskClient.current.save(taskId).catch(failure => { if (owner.task?.id === taskId) owner.saveError = failure.message; }).finally(() => { if (owner.task?.id === taskId) { owner.saving = false; notify(); } });
      }
    },
    newSession: async () => { if (await beforeLeave()) { install(sessionState("")); loadedRoute.current = ""; live.current.onRoute(""); setFocusToken(value => value + 1); return true; } return false; },
    rename: (id: string, title: string) => mutateSession(id, "PATCH", title), delete: (id: string) => mutateSession(id, "DELETE"),
    clearError: () => { setNavigationError(""); setError(""); } };
}
