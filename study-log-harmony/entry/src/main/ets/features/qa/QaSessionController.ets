import { ApiClient, ApiError, ApiStreamCancelledError } from '../../common/network/ApiClient';
import { RagChatMessage, RagCitation, RagDeltaEvent, RagDoneEvent, RagErrorEvent, RagHistoryMessage, RagQueryRequest, RagSessionResponse, RagSessionsResponse, RagSessionSummary, RagSessionWriteRequest, RagSourcesEvent, RagStatusEvent } from './QaModels';
import { QaStreamParser } from './QaStreamParser';
import { util } from '@kit.ArkTS';

export interface QaAttempt {
  request: RagQueryRequest;
  userId: string;
  answerId: string;
  saveOnly: boolean;
}

export interface QaSessionView {
  onSessionsChange: (sessions: RagSessionSummary[]) => void;
  onSessionsError: (message: string) => void;
  onActiveSessionChange: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
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
  private transport: ApiClient;
  private view: QaSessionView;
  private parser: QaStreamParser = new QaStreamParser();

  constructor(transport: ApiClient, view: QaSessionView) { this.transport = transport; this.view = view; }

  activate(): void {
    this.pageDisposed = false;
    this.loadSessions();
  }

  dispose(): void {
    this.pageDisposed = true;
    this.historyLoadRevision += 1;
    this.sessionRequestRevision += 1;
    this.sendRevision += 1;
    this.pendingSessionKey = '';
    this.sessionLoading = false;
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
      this.sessions = response.sessions;
      this.view.onSessionsChange(response.sessions);
      this.view.onSessionsError('');
    } catch (error) {
      if (revision !== this.historyLoadRevision) return;
      this.view.onSessionsError(error instanceof ApiError ? error.message : '历史会话读取失败');
    }
  }

  async newSession(): Promise<void> {
    if (this.sending) return;
    this.failedSessionId = '';
    this.sessionLoading = false;
    const revision = ++this.sessionRequestRevision;
    this.view.onActiveSessionChange('');
    if (this.messages.length > 0) await this.view.onBeforeSessionChange();
    if (revision !== this.sessionRequestRevision) return;
    this.pendingSessionKey = '';
    this.sessionDocumentKey = '';
    this.sessionId = '';
    this.sessionVersion = '';
    this.pendingWrite = undefined;
    this.messages = [];
    this.failedAttempt = undefined;
    this.question = '';
    this.statusText = '';
    this.errorMessage = '';
    this.sourceCitations = [];
    this.view.resetComposerScroll();
    this.view.onActiveSessionChange('');
    this.view.afterFrame(() => {
      if (revision === this.sessionRequestRevision) this.view.onSessionReady();
    });
  }

  async openSession(id: string): Promise<void> {
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
      this.sessionDocumentKey = `session:${response.session.id}:${revision}`;
      this.pendingSessionKey = this.sessionDocumentKey;
      this.sessionId = response.session.id;
      this.sessionVersion = response.session.version;
      this.pendingWrite = undefined;
      this.messages = response.session.messages;
      this.failedAttempt = undefined;
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
      history.push({ role: 'user', content: question.content },
        { role: 'assistant', content: answer.content });
    }
    return history;
  }

  async send(): Promise<void> {
    const clean = this.question.trim();
    if (!clean || this.sending) return;
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
    if (this.sending || this.pageDisposed) return;
    this.sessionRequestRevision += 1;
    this.view.beforeSend();
    this.sending = true;
    this.failedAttempt = undefined;
    this.receivedAnswer = false;
    this.receivedDone = false;
    this.view.onBusyChange(true);
    this.statusText = '正在理解问题';
    this.errorMessage = '';
    this.noticeMessage = '';
    this.parser.reset();
    this.sourceCitations = [];
    if (!attempt.saveOnly) {
      const answer = this.messages.find((message: RagChatMessage) => message.id === attempt.answerId);
      if (answer) { answer.status = undefined; answer.error = undefined; answer.content = ''; answer.citations = []; }
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
      this.statusText = '';
    }
  }

  stop(): void {
    if (!this.sending) return;
    this.sendRevision += 1;
    this.transport.cancelStream();
    const revision = this.sendRevision;
    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'assistant') {
      last.status = 'stopped';
      this.messages = [...this.messages];
      this.pendingWrite = undefined;
      this.persistSession(this.answerMode, revision).catch(() => {
        if (revision === this.sendRevision) this.noticeMessage = '已停止生成，当前内容尚未保存';
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
        this.messages = [...this.messages];
      } else if (name === 'error') {
        this.errorMessage = (JSON.parse(data) as RagErrorEvent).message;
      }
    } catch (_) {
      this.errorMessage = '问答数据解析失败';
    }
  }

  async persistSession(mode: string, revision: number): Promise<void> {
    if (!this.pendingWrite) this.pendingWrite = { messages: this.messages,
      answerMode: mode, mutationId: util.generateRandomUUID(), baseVersion: this.sessionId ? this.sessionVersion : null,
      id: this.sessionId ? undefined : util.generateRandomUUID() };
    const request = this.pendingWrite;
    const response = this.sessionId ?
      await this.transport.put<RagSessionResponse>(`/rag/sessions/${encodeURIComponent(this.sessionId)}`, request) :
      await this.transport.post<RagSessionResponse>('/rag/sessions', request);
    if (revision !== this.sendRevision) return;
    this.sessionId = response.session.id;
    this.sessionVersion = response.session.version;
    this.pendingWrite = undefined;
    this.view.onActiveSessionChange(this.sessionId);
    if (revision === this.sendRevision) await this.loadSessions();
  }
}
