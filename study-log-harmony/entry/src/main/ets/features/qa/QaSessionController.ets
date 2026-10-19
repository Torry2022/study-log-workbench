import { ApiClient, ApiError, ApiStreamCancelledError } from '../../common/network/ApiClient';
import { RagChatMessage, RagCitation, RagDeltaEvent, RagDoneEvent, RagErrorEvent, RagHistoryMessage, RagQueryRequest, RagSession, RagSessionResponse, RagSessionsResponse, RagSessionSummary, RagSessionWriteRequest, RagSourceRef, RagSourcesEvent, RagStatusEvent } from './QaModels';
import { QaStreamParser } from './QaStreamParser';
import { QaTaskClient } from './QaTaskClient';
import { QaTask, QaTaskChoice, QaTaskSubmission, latestTask, taskActive, taskRetained, taskMessages } from './QaTaskModels';
import { util } from '@kit.ArkTS';

export interface QaAttempt {
  request: RagQueryRequest;
  userId: string;
  answerId: string;
  saveOnly: boolean;
}

export interface QaSessionView {
  onSessionsChange: (sessions: RagSessionSummary[]) => void;
  onTasksChange?: (sessions: RagSessionSummary[]) => void;
  onQuestionChange?: (question: string) => void;
  onSessionsError: (message: string) => void;
  onActiveSessionChange: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onSessionReady: () => void;
  onBeforeSessionChange: () => Promise<void>;
  resetComposerScroll: () => void;
  beforeSend: () => void;
  showComposer: () => void;
  afterFrame: (action: () => void) => void;
}

@Observed
export class QaSessionController {
  sessions: RagSessionSummary[] = [];
  sessionId: string = '';
  messages: RagChatMessage[] = [];
  question: string = '';
  answerMode: string = 'logs_only';
  sending: boolean = false;
  statusText: string = '';
  errorMessage: string = '';
  failedSessionId: string = '';
  sessionLoading: boolean = false;
  noticeMessage: string = '';
  failedAttempt: QaAttempt | undefined = undefined;
  editingFailedId: string = '';
  receivedAnswer: boolean = false;
  receivedDone: boolean = false;
  sessionVersion: string = '';
  pendingWrite?: RagSessionWriteRequest;
  sourceCitations: RagCitation[] = [];
  sendRevision: number = 0;
  sessionRequestRevision: number = 0;
  historyLoadRevision: number = 0;
  pageDisposed: boolean = false;
  sessionDocumentKey: string = '';
  pendingSessionKey: string = '';
  taskMode: boolean = false;
  taskReady: boolean = false;
  taskSaving: boolean = false;
  taskError: string = '';
  taskSaveError: string = '';
  taskChoices: QaTaskChoice[] = [];
  selectedTaskId: string = '';
  taskCanSave: boolean = false;
  taskCanRetry: boolean = false;
  taskBlocked: boolean = false;
  private taskClient?: QaTaskClient;
  private selectedTask?: QaTask;
  private taskViews: Map<string, string> = new Map<string, string>();
  private canonical: Map<string, RagSession> = new Map<string, RagSession>();
  private remoteSessions: RagSessionSummary[] = [];
  private deletedSessions: Set<string> = new Set<string>();
  private taskFingerprint: string = '';
  private navigationFingerprint: string = '';
  private canonicalReadFailed: boolean = false;
  private transport: ApiClient;
  private view: QaSessionView;
  private parser: QaStreamParser = new QaStreamParser();

  constructor(transport: ApiClient, view: QaSessionView, tasks?: QaTaskClient) {
    this.transport = transport; this.view = view; this.taskClient = tasks; this.taskMode = !!tasks;
    this.taskBlocked = !!tasks && !tasks.ready;
  }

  private reportPending(): void {
    this.view.onPendingChange(!!this.failedAttempt || !!this.pendingWrite);
  }

  activate(): void {
    this.pageDisposed = false;
    // Bind after ArkUI owns the observed controller, so background writes notify the page.
    if (this.taskClient) this.taskClient.onChange = () => this.applyTasks();
    this.loadSessions();
    this.taskClient?.start();
  }

  dispose(): void {
    this.pageDisposed = true;
    this.historyLoadRevision += 1;
    this.sessionRequestRevision += 1;
    this.sendRevision += 1;
    this.pendingSessionKey = '';
    this.sessionLoading = false;
    if (this.taskClient) { this.taskClient.stop(); this.sending = false; this.view.onBusyChange(false); return; }
    if (this.sending) {
      this.transport.cancelStream();
      this.sending = false;
      this.view.onBusyChange(false);
      this.statusText = '';
    }
  }

  consumeChunk(chunk: string): void {
    this.parser.push(chunk).forEach((block: string) => this.consumeEvent(block));
  }

  async loadSessions(): Promise<void> {
    if (this.pageDisposed) return;
    const revision = ++this.historyLoadRevision;
    try {
      const response = await this.transport.get<RagSessionsResponse>('/rag/sessions');
      if (revision !== this.historyLoadRevision) return;
      this.remoteSessions = response.sessions;
      this.sessions = response.sessions;
      this.view.onSessionsChange(response.sessions);
      if (this.taskClient) this.publishTaskSessions();
      this.view.onSessionsError('');
    } catch (error) {
      if (revision !== this.historyLoadRevision) return;
      this.view.onSessionsError(error instanceof ApiError ? error.message : '历史会话读取失败');
    }
  }

  async newSession(): Promise<void> {
    if (this.sending && !this.taskClient) return;
    this.failedSessionId = '';
    this.sessionLoading = false;
    const revision = ++this.sessionRequestRevision;
    this.view.onActiveSessionChange('');
    if (this.messages.length > 0) await this.view.onBeforeSessionChange();
    if (revision !== this.sessionRequestRevision) return;
    this.sendRevision += 1;
    this.pendingSessionKey = '';
    this.sessionDocumentKey = '';
    this.sessionId = '';
    this.sessionVersion = '';
    this.pendingWrite = undefined;
    this.messages = [];
    this.failedAttempt = undefined;
    this.reportPending();
    this.question = '';
    this.statusText = '';
    this.errorMessage = '';
    this.sourceCitations = [];
    if (this.taskClient) {
      this.selectedTask = undefined; this.selectedTaskId = ''; this.taskChoices = []; this.taskSaveError = '';
      this.taskCanSave = false; this.taskCanRetry = false; this.sending = false; this.taskFingerprint = ''; this.taskBlocked = !this.taskClient.ready;
      this.canonicalReadFailed = false;
      this.view.onBusyChange(false);
    }
    this.view.resetComposerScroll();
    this.view.onActiveSessionChange('');
    this.view.afterFrame(() => {
      if (revision === this.sessionRequestRevision) this.view.onSessionReady();
    });
  }

  async openSession(id: string): Promise<void> {
    if (this.taskClient) { await this.openTaskSession(id); return; }
    if (this.sending) return;
    this.failedSessionId = '';
    this.errorMessage = '';
    this.sessionLoading = true;
    const revision = ++this.sessionRequestRevision;
    this.view.onActiveSessionChange(id);
    try {
      const response = await this.transport.get<RagSessionResponse>(`/rag/sessions/${encodeURIComponent(id)}`);
      if (revision !== this.sessionRequestRevision) return;
      await this.view.onBeforeSessionChange();
      if (revision !== this.sessionRequestRevision) return;
      this.sendRevision += 1;
      this.sessionDocumentKey = `session:${response.session.id}:${revision}`;
      this.pendingSessionKey = this.sessionDocumentKey;
      this.sessionId = response.session.id;
      this.sessionVersion = response.session.version;
      this.pendingWrite = undefined;
      this.messages = response.session.messages;
      this.failedAttempt = undefined;
      this.reportPending();
      this.answerMode = response.session.answerMode;
      this.errorMessage = '';
      this.view.resetComposerScroll();
      this.view.onActiveSessionChange(this.sessionId);
      if (this.messages.length === 0) {
        this.pendingSessionKey = '';
        this.view.afterFrame(() => {
          if (revision === this.sessionRequestRevision) this.view.onSessionReady();
        });
      }
    } catch (error) {
      if (revision !== this.sessionRequestRevision) return;
      this.errorMessage = error instanceof ApiError ? error.message : '会话读取失败';
      this.failedSessionId = id;
      this.view.onActiveSessionChange(this.sessionId);
      this.view.onSessionReady();
    } finally {
      if (revision === this.sessionRequestRevision) this.sessionLoading = false;
    }
  }

  history(): RagHistoryMessage[] {
    const history: RagHistoryMessage[] = [];
    for (let index = 0; index + 1 < this.messages.length; index += 2) {
      const question = this.messages[index];
      const answer = this.messages[index + 1];
      if (question.role !== 'user' || answer.role !== 'assistant' ||
        answer.status === 'stopped' || answer.status === 'error' || !answer.content.trim()) continue;
      const historyAnswer: RagHistoryMessage = { role: 'assistant', content: answer.content };
      if (answer.citations && answer.citations.length > 0) {
        historyAnswer.sourceRefs = answer.citations.map((citation: RagCitation): RagSourceRef => ({
          date: citation.date, fileName: citation.fileName, heading: citation.heading, contentHash: citation.contentHash
        }));
      }
      history.push({ role: 'user', content: question.content }, historyAnswer);
    }
    return history;
  }

  async send(): Promise<void> {
    if (this.taskClient) { await this.sendTask(); return; }
    const clean = this.question.trim();
    if (!clean || this.sending || this.sessionLoading) return;
    if (this.pendingWrite) { this.errorMessage = '上一次回答尚未保存，请先重试保存'; return; }
    let attempt = this.failedAttempt?.answerId === this.editingFailedId ? this.failedAttempt : undefined;
    if (attempt) {
      attempt = { request: { question: clean, history: attempt.request.history, mode: this.answerMode },
        userId: attempt.userId, answerId: attempt.answerId, saveOnly: false };
      this.messages = this.messages.map((message: RagChatMessage): RagChatMessage =>
        message.id === attempt?.userId ? { id: message.id, role: 'user', content: clean } : message);
    } else {
      const userId = `user-${Date.now()}`;
      const answerId = `assistant-${Date.now()}`;
      attempt = { request: { question: clean, history: this.history(), mode: this.answerMode },
        userId, answerId, saveOnly: false };
      this.messages = [...this.messages, { id: userId, role: 'user', content: clean },
        { id: answerId, role: 'assistant', content: '' }];
    }
    this.question = '';
    this.editingFailedId = '';
    await this.runAttempt(attempt);
  }

  async runAttempt(attempt: QaAttempt): Promise<void> {
    if (this.sending || this.sessionLoading || this.pageDisposed) return;
    this.sessionRequestRevision += 1;
    this.view.beforeSend();
    this.sending = true;
    this.failedAttempt = undefined;
    this.receivedAnswer = false;
    this.receivedDone = false;
    this.view.onBusyChange(true);
    this.statusText = attempt.saveOnly ? '正在保存回答' : '正在理解问题';
    this.errorMessage = '';
    this.noticeMessage = '';
    this.parser.reset();
    this.sourceCitations = [];
    if (!attempt.saveOnly) {
      const answer = this.messages.find((message: RagChatMessage) => message.id === attempt.answerId);
      if (answer) { answer.status = undefined; answer.error = undefined; answer.content = ''; answer.citations = []; answer.groundingWarning = undefined; }
      this.messages = [...this.messages];
    }
    this.view.showComposer();
    const revision = ++this.sendRevision;
    try {
      if (!attempt.saveOnly) {
        await this.transport.postStream('/rag/query', attempt.request, (chunk: string) => {
          if (revision === this.sendRevision) this.consumeChunk(chunk);
        });
        if (revision !== this.sendRevision) return;
        if (this.errorMessage) throw new Error(this.errorMessage);
        if (!this.receivedDone || !this.messages[this.messages.length - 1].content) throw new Error('问答未完整结束');
        attempt.saveOnly = true;
        this.statusText = '正在保存回答';
      }
      if (revision !== this.sendRevision) return;
      await this.persistSession(attempt.request.mode || 'logs_only', revision);
    } catch (error) {
      if (revision !== this.sendRevision || error instanceof ApiStreamCancelledError) return;
      this.errorMessage = error instanceof ApiError ? error.message : (error instanceof Error ? error.message : '问答请求失败');
      if (!attempt.saveOnly) {
        const answer = this.messages.find((message: RagChatMessage) => message.id === attempt.answerId);
        if (answer) { answer.status = 'error'; answer.error = this.errorMessage; this.messages = [...this.messages]; }
      }
      this.failedAttempt = attempt;
    } finally {
      if (revision !== this.sendRevision) return;
      this.sending = false;
      this.view.onBusyChange(false);
      this.reportPending();
      this.statusText = '';
    }
  }

  stop(): void {
    if (this.taskClient) {
      const id = this.selectedTask?.id, sessionId = this.sessionId, revision = this.sessionRequestRevision;
      const pending = this.taskClient.pending.some((input: QaTaskSubmission) => input.sessionId === sessionId);
      const stopping = pending || !id ? this.taskClient.stopPending(sessionId) : this.taskClient.cancel(id);
      stopping.catch((error: Error) => { if (!this.pageDisposed && revision === this.sessionRequestRevision) this.errorMessage = error.message; });
      return;
    }
    if (!this.sending) return;
    if (this.receivedDone || this.pendingWrite) return;
    this.sendRevision += 1;
    this.transport.cancelStream();
    const revision = this.sendRevision;
    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'assistant') {
      last.status = 'stopped';
      this.messages = [...this.messages];
      this.pendingWrite = undefined;
      this.persistSession(this.answerMode, revision).catch((error: Error) => {
        if (revision !== this.sendRevision) return;
        const question = this.messages[this.messages.length - 2];
        this.failedAttempt = { request: { question: question?.content || '', history: [], mode: this.answerMode },
          userId: question?.id || '', answerId: last.id, saveOnly: true };
        this.errorMessage = error instanceof ApiError ? error.message : '当前内容尚未保存，请重试';
        this.noticeMessage = '';
        this.reportPending();
      });
    }
    this.sending = false;
    this.view.onBusyChange(false);
    this.statusText = '';
    this.errorMessage = '';
    this.noticeMessage = '生成已停止';
  }

  consumeEvent(block: string): void {
    let name = '';
    let data = '';
    block.split('\n').forEach((line: string) => {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      if (line.startsWith('data:')) data += line.slice(5).trim();
    });
    if (!name || !data) return;
    try {
      if (name === 'status') {
        this.statusText = (JSON.parse(data) as RagStatusEvent).message;
      } else if (name === 'sources') {
        this.sourceCitations = (JSON.parse(data) as RagSourcesEvent).citations || [];
      } else if (name === 'delta') {
        const delta = (JSON.parse(data) as RagDeltaEvent).text;
        const last = this.messages[this.messages.length - 1];
        if (!delta) return;
        if (!this.receivedAnswer) { last.content = ''; last.citations = []; }
        this.receivedAnswer = true;
        last.content += delta;
        this.messages = [...this.messages];
      } else if (name === 'done') {
        const done = JSON.parse(data) as RagDoneEvent;
        const answer = this.messages[this.messages.length - 1];
        if (!done.answer?.trim()) {
          this.errorMessage = '问答返回了空回答';
          return;
        }
        this.receivedAnswer = true;
        this.receivedDone = true;
        answer.content = done.answer;
        answer.citations = done.citations || this.sourceCitations;
        answer.groundingWarning = done.groundingWarning;
        this.messages = [...this.messages];
      } else if (name === 'error') {
        this.errorMessage = (JSON.parse(data) as RagErrorEvent).message;
      }
    } catch (_) {
      this.errorMessage = '问答数据解析失败';
    }
  }

  async persistSession(mode: string, revision: number): Promise<void> {
    if (this.taskClient) throw new Error('任务结果由服务器保存，客户端不能重复写入');
    if (!this.pendingWrite) this.pendingWrite = { messages: this.messages,
      answerMode: mode, mutationId: util.generateRandomUUID(), baseVersion: this.sessionId ? this.sessionVersion : null,
      id: this.sessionId ? undefined : util.generateRandomUUID() };
    this.reportPending();
    const request = this.pendingWrite;
    const response = this.sessionId ?
      await this.transport.put<RagSessionResponse>(`/rag/sessions/${encodeURIComponent(this.sessionId)}`, request) :
      await this.transport.post<RagSessionResponse>('/rag/sessions', request);
    if (revision !== this.sendRevision) return;
    this.sessionId = response.session.id;
    this.sessionVersion = response.session.version;
    this.pendingWrite = undefined;
    this.reportPending();
    this.view.onActiveSessionChange(this.sessionId);
    if (revision === this.sendRevision) await this.loadSessions();
  }

  private publishTaskSessions(): void {
    const client = this.taskClient;
    if (!client || this.pageDisposed) return;
    const sessions = new Map<string, RagSessionSummary>();
    this.remoteSessions.filter((session: RagSessionSummary) => !this.deletedSessions.has(session.id)).forEach((session: RagSessionSummary) => sessions.set(session.id, session));
    const ids = new Set<string>(client.tasks.map((task: QaTask) => task.sessionId));
    client.pending.forEach((input: QaTaskSubmission) => ids.add(input.sessionId));
    ids.forEach((id: string) => {
      if (this.deletedSessions.has(id)) return;
      const latest = latestTask(client.tasks, id), pending = client.pending.find((input: QaTaskSubmission) => input.sessionId === id);
      const saved = sessions.get(id);
      const active = client.tasks.some((task: QaTask) => task.sessionId === id && taskActive(task));
      const retained = client.tasks.some((task: QaTask) => task.sessionId === id && taskRetained(task));
      if (!saved && !latest && !pending) return;
      const question = latest?.question || pending?.question || '';
      sessions.set(id, { id, title: saved?.title || question.slice(0, 60), createdAt: saved?.createdAt || latest?.createdAt || new Date().toISOString(),
        updatedAt: saved?.updatedAt || latest?.updatedAt || new Date().toISOString(), messageCount: saved?.messageCount || 0,
        lastQuestion: saved?.lastQuestion || question, version: saved?.version || '',
        taskState: active || pending ? 'running' : retained ? 'unsaved' : '' });
    });
    this.sessions = Array.from(sessions.values());
    if (this.view.onTasksChange) this.view.onTasksChange(this.sessions.filter((session: RagSessionSummary) => session.taskState !== undefined));
    else this.view.onSessionsChange(this.sessions);
  }

  private applyTasks(): void {
    const client = this.taskClient;
    if (!client || this.pageDisposed) return;
    this.taskReady = client.ready; this.taskError = client.error;
    const navigation = JSON.stringify([client.tasks.map((task: QaTask) => [task.id, task.state, task.saveState]), client.pending]);
    if (navigation !== this.navigationFingerprint) { this.navigationFingerprint = navigation; this.publishTaskSessions(); this.loadSessions(); }
    const latest = latestTask(client.tasks, this.sessionId);
    const choice = this.taskViews.has(this.sessionId) ? this.taskViews.get(this.sessionId) || '' : latest?.id || '';
    this.taskChoices = client.tasks.filter((task: QaTask) => task.sessionId === this.sessionId && (taskRetained(task) || task.id === choice))
      .sort((a: QaTask, b: QaTask) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map((task: QaTask): QaTaskChoice => ({ id: task.id, label: `${this.taskTime(task.createdAt)} · ${task.state === 'queued' ? '等待中' : taskActive(task) ? '生成中' : task.state === 'failed' ? '生成失败' : task.state === 'interrupted' ? '已中断' : task.state === 'cancelled' ? '已停止' : task.saveState === 'conflict' ? '保存冲突' : task.saveState === 'error' ? '保存失败' : task.saveState === 'saved' ? '已保存' : '待保存'} · ${task.question.slice(0, 45)}` }));
    if (this.taskSaving) return;
    const task = client.tasks.find((item: QaTask) => item.id === choice);
    const pending = client.pending.find((input: QaTaskSubmission) => input.sessionId === this.sessionId && !client.tasks.some((item: QaTask) => item.submissionId === input.submissionId));
    const fingerprint = JSON.stringify([this.sessionId, choice, task?.revision, latest?.id, latest?.saveState, pending, client.ready]);
    if (fingerprint === this.taskFingerprint) return;
    this.taskFingerprint = fingerprint;
    this.taskCanSave = !pending && !!task && task.state === 'succeeded' && task.saveState === 'error';
    this.taskCanRetry = !pending && !!task && task.id === latest?.id && ['failed', 'cancelled', 'interrupted'].includes(task.state);
    this.taskSaveError = !pending && task?.state === 'succeeded' && ['error', 'conflict'].includes(task.saveState) ? task.saveError || '回答已保留，尚未写入会话' : '';
    this.selectedTaskId = pending ? '' : task?.id || ''; this.selectedTask = pending ? undefined : task;
    this.taskBlocked = this.blockTaskSubmission();
    this.sending = !!pending || !!task && taskActive(task);
    this.receivedDone = !pending && task?.state === 'succeeded'; this.pendingWrite = undefined; this.failedAttempt = undefined;
    this.view.onBusyChange(false); this.view.onPendingChange(false);
    if (pending) {
      const saved = this.canonical.get(this.sessionId)?.messages || [];
      this.messages = [...(pending.replaceLast ? saved.slice(0, -2) : saved), { id: `${pending.submissionId}:user`, role: 'user', content: pending.question },
        { id: `${pending.submissionId}:assistant`, role: 'assistant', content: '', status: 'streaming' }];
      this.statusText = pending.cancelRequested ? '正在确认停止…' : '正在确认问答任务…';
    } else if (task) {
      this.statusText = task.state === 'queued' ? '正在等待前一项问答完成…' : taskActive(task) ? task.stage : task.saveState === 'pending' ? '正在保存回答…' : '';
      this.answerMode = task.mode; this.errorMessage = task.state === 'failed' || task.state === 'interrupted' ? task.error : '';
      this.messages = taskMessages(task, this.canonical.get(this.sessionId), task.id !== latest?.id);
      if (task.saveState === 'saved' && task.id === latest?.id && !this.sessionLoading) this.readTaskSession(this.sessionId, this.sessionRequestRevision);
    } else {
      this.statusText = ''; this.messages = this.canonical.get(this.sessionId)?.messages || [];
      if (this.sessionId && !this.sessionLoading) this.readTaskSession(this.sessionId, this.sessionRequestRevision);
    }
  }

  private blockTaskSubmission(): boolean {
    const client = this.taskClient, task = this.selectedTask;
    return !client?.ready || this.canonicalReadFailed || !!task && task.id !== latestTask(client.tasks, this.sessionId)?.id ||
      !!task && task.state === 'succeeded' && task.saveState === 'pending' ||
      !!client?.pending.some((input: QaTaskSubmission) => input.sessionId === this.sessionId) ||
      !!client?.tasks.some((item: QaTask) => item.sessionId === this.sessionId && taskActive(item) && item.id !== task?.id);
  }

  private taskTime(createdAt: string): string {
    const value = new Date(new Date(createdAt).getTime() + 8 * 60 * 60 * 1000);
    const pad = (part: number): string => part.toString().padStart(2, '0');
    return `${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
  }

  private async readTaskSession(id: string, revision: number): Promise<void> {
    this.sessionLoading = true;
    try {
      const response = await this.transport.get<RagSessionResponse>(`/rag/sessions/${encodeURIComponent(id)}`);
      if (this.pageDisposed || revision !== this.sessionRequestRevision || this.sessionId !== id || this.deletedSessions.has(id)) return;
      if (response.session.id !== id || !Array.isArray(response.session.messages) || !/^[a-f0-9]{64}$/.test(response.session.version)) throw new Error('会话响应不完整，请重试');
      this.canonical.set(id, response.session); this.sessionVersion = response.session.version; this.canonicalReadFailed = false; this.failedSessionId = '';
      const latest = latestTask(this.taskClient?.tasks || [], id), choice = this.taskViews.get(id);
      if (choice === '' || this.selectedTask?.saveState === 'saved' && this.selectedTask.id === latest?.id || !this.selectedTask) {
        this.messages = response.session.messages; this.answerMode = response.session.answerMode; this.errorMessage = '';
      }
    } catch (error) {
      if (this.pageDisposed || revision !== this.sessionRequestRevision || this.sessionId !== id) return;
      if (error instanceof ApiError && error.statusCode === 404) {
        const remaining = this.taskClient?.tasks.some((task: QaTask) => task.sessionId === id) || this.taskClient?.pending.some((input: QaTaskSubmission) => input.sessionId === id);
        if (this.canonical.has(id) || this.remoteSessions.some((session: RagSessionSummary) => session.id === id)) {
          this.deletedSessions.add(id); this.remoteSessions = this.remoteSessions.filter((session: RagSessionSummary) => session.id !== id);
          this.taskViews.delete(id); this.canonical.delete(id); await this.newSession(); this.noticeMessage = '该会话已被删除，已停止恢复'; this.publishTaskSessions();
        } else { this.canonicalReadFailed = false; if (!remaining && !this.sending) this.errorMessage = '该会话尚无已保存回答，可选择上方保留的结果'; }
      } else { this.canonicalReadFailed = true; this.failedSessionId = id; this.pendingSessionKey = ''; this.errorMessage = error instanceof Error ? error.message : '会话读取失败，请重试'; this.view.onSessionReady(); }
    } finally {
      if (!this.pageDisposed && revision === this.sessionRequestRevision) {
        this.sessionLoading = false; this.taskBlocked = this.blockTaskSubmission();
        if (!this.messages.length) { this.pendingSessionKey = ''; this.view.afterFrame(() => { if (revision === this.sessionRequestRevision) this.view.onSessionReady(); }); }
      }
    }
  }

  private async openTaskSession(id: string): Promise<void> {
    const revision = ++this.sessionRequestRevision;
    await this.view.onBeforeSessionChange();
    if (this.pageDisposed || revision !== this.sessionRequestRevision) return;
    this.sessionId = id; this.sessionVersion = this.canonical.get(id)?.version || ''; this.sessionLoading = true;
    this.errorMessage = ''; this.failedSessionId = ''; this.taskFingerprint = ''; this.sessionDocumentKey = `task-session:${id}:${revision}`; this.pendingSessionKey = this.sessionDocumentKey;
    this.view.onActiveSessionChange(id); this.view.resetComposerScroll(); this.applyTasks();
    await this.readTaskSession(id, revision);
  }

  async selectTask(id: string): Promise<void> {
    if (!this.taskClient || this.taskSaving || this.pageDisposed) return;
    const sessionId = this.sessionId, revision = ++this.sessionRequestRevision;
    this.sessionDocumentKey = `task-session:${sessionId}:${revision}`; this.pendingSessionKey = this.sessionDocumentKey;
    this.taskViews.set(sessionId, id); this.taskFingerprint = ''; this.errorMessage = ''; this.sessionLoading = true;
    this.applyTasks();
    try { if (id) await this.taskClient.read(id); else await this.readTaskSession(sessionId, revision); }
    catch (error) { if (revision === this.sessionRequestRevision) this.errorMessage = error instanceof Error ? error.message : '结果读取失败，请重试'; }
    finally { if (revision === this.sessionRequestRevision && !this.pageDisposed) { this.sessionLoading = false; if (id) { this.taskFingerprint = ''; this.applyTasks(); } if (!this.messages.length) { this.pendingSessionKey = ''; this.view.onSessionReady(); } } }
  }

  private async sendTask(replaceLast: boolean = false): Promise<void> {
    const client = this.taskClient, question = this.question.trim();
    if (!client || !question || question.length > 2000 || this.sending || this.sessionLoading || this.taskSaving || this.taskBlocked || this.taskSaveError) return;
    if (!client.ready) { this.errorMessage = '任务协议尚未就绪，请重试检查'; return; }
    if (!this.sessionId) { this.sessionId = util.generateRandomUUID(); this.view.onActiveSessionChange(this.sessionId); }
    const sessionId = this.sessionId;
    const input: QaTaskSubmission = { submissionId: util.generateRandomUUID(), sessionId, baseVersion: this.canonical.get(sessionId)?.version || this.sessionVersion || null, question, mode: this.answerMode, replaceLast };
    this.taskViews.delete(sessionId); this.question = ''; this.errorMessage = ''; this.sending = true; this.view.beforeSend(); this.view.showComposer();
    this.view.onBusyChange(false); this.view.onPendingChange(false);
    try { await client.submit(input); }
    catch (error) {
      if (this.pageDisposed || this.sessionId !== sessionId) return;
      this.errorMessage = error instanceof Error ? error.message : '问答提交失败'; this.question ||= question; this.sending = false; this.view.onQuestionChange?.(this.question);
    }
    this.taskFingerprint = ''; this.applyTasks();
  }

  async retryTask(): Promise<void> {
    if (!this.selectedTask || !this.taskCanRetry || this.taskBlocked) return;
    const original = this.selectedTask;
    this.question = original.question; await this.sendTask(original.replaceLast);
  }
  async retryTaskSave(): Promise<void> {
    const client = this.taskClient, id = this.selectedTask?.id;
    if (!client || !id || !this.taskCanSave || this.taskSaving) return;
    const revision = this.sessionRequestRevision; this.taskSaving = true;
    try { await client.save(id); }
    catch (error) { if (revision === this.sessionRequestRevision) this.errorMessage = error instanceof Error ? error.message : '保存重试失败'; }
    finally { this.taskSaving = false; this.taskFingerprint = ''; this.applyTasks(); }
  }
  async discardTask(id: string): Promise<void> {
    const client = this.taskClient;
    if (!client || this.selectedTask?.id !== id || this.selectedTask.state !== 'succeeded' || this.selectedTask.saveState === 'saved' || this.taskSaving) return;
    const sessionId = this.sessionId, revision = this.sessionRequestRevision; this.taskSaving = true;
    try {
      await client.remove(id);
      if (revision === this.sessionRequestRevision && this.sessionId === sessionId) { this.taskViews.set(sessionId, ''); this.selectedTask = undefined; await this.readTaskSession(sessionId, revision); }
    } catch (error) { if (revision === this.sessionRequestRevision) this.errorMessage = error instanceof Error ? error.message : '放弃结果未完成'; }
    finally { this.taskSaving = false; this.taskFingerprint = ''; this.applyTasks(); }
  }
  async refreshTasks(): Promise<void> { await this.taskClient?.connect(); this.taskFingerprint = ''; this.applyTasks(); }

  forgetTaskSession(id: string): void {
    this.deletedSessions.add(id); this.taskViews.delete(id); this.canonical.delete(id);
    this.remoteSessions = this.remoteSessions.filter((session: RagSessionSummary) => session.id !== id);
    this.taskClient?.forgetSession(id).catch((error: Error) => { if (!this.pageDisposed) this.taskError = error.message; });
    if (this.sessionId === id) this.newSession();
    this.publishTaskSessions();
  }
}
