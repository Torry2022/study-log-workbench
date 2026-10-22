import { ApiClient, ApiError, ApiStreamCancelledError } from '../../common/network/ApiClient';
import { RagChatMessage, RagCitation, RagDeltaEvent, RagDoneEvent, RagErrorEvent, RagHistoryMessage, RagQueryRequest, RagSession, RagSessionResponse, RagSessionsResponse, RagSessionSummary, RagSessionWriteRequest, RagSourceRef, RagSourcesEvent, RagStatusEvent } from './QaModels';
import { QaStreamParser } from './QaStreamParser';
import { QaTaskClient } from './QaTaskClient';
import { QaTask, QaTaskSubmission, QaAnswerMessage, latestTask, taskActive, taskRetained, taskMessages } from './QaTaskModels';
import { util } from '@kit.ArkTS';

export interface QaAttempt {
  request: RagQueryRequest;
  userId: string;
  answerId: string;
  saveOnly: boolean;
}

export interface QaQuestionEdit {
  messageId: string;
  content: string;
  error: string;
  token: string;
  baseVersion: string;
  submissionId?: string;
}

export interface QaSessionView {
  onSessionsChange: (sessions: RagSessionSummary[]) => void;
  onTasksChange?: (sessions: RagSessionSummary[]) => void;
  onQuestionChange?: (question: string) => void;
  onSessionsError: (message: string) => void;
  onActiveSessionChange: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onQuestionEditsChange?: (dirty: boolean) => void;
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
  taskCanRetry: boolean = false;
  taskBlocked: boolean = false;
  private taskClient?: QaTaskClient;
  private selectedTask?: QaTask;
  private answerViews: Map<string, string> = new Map<string, string>();
  private selectionWrite?: RagSessionWriteRequest;
  private selectionSessionId: string = '';

  private questionEdits: Map<string, QaQuestionEdit> = new Map<string, QaQuestionEdit>();
  private activeQuestionEdits: Map<string, string> = new Map<string, string>();
  private dismissedEdits: Set<string> = new Set<string>();
  questionEditRevision: number = 0;

  questionEdit(id?: string): QaQuestionEdit | undefined {
    return this.questionEdits.get(`${this.sessionId}:${id || this.activeQuestionEdits.get(this.sessionId) || ''}`);
  }

  orphanQuestionEdits(): QaQuestionEdit[] {
    const messages = this.canonical.get(this.sessionId)?.messages || [];
    return Array.from(this.questionEdits.entries()).filter((entry: [string, QaQuestionEdit]) => entry[0].startsWith(`${this.sessionId}:`) &&
      !messages.some((message: RagChatMessage) => message.role === 'user' && message.id === entry[1].messageId)).map((entry: [string, QaQuestionEdit]) => entry[1]);
  }

  private rememberQuestionEdit(sessionId: string, edit: QaQuestionEdit): void {
    this.questionEdits.set(`${sessionId}:${edit.messageId}`, edit);
    this.activeQuestionEdits.set(sessionId, edit.messageId);
  }

  private forgetQuestionEdit(sessionId: string, id: string): void {
    this.questionEdits.delete(`${sessionId}:${id}`);
    if (this.activeQuestionEdits.get(sessionId) === id) this.activeQuestionEdits.delete(sessionId);
  }

  questionEditingSupported(): boolean { return this.taskClient?.questionEditing === true; }

  canEditQuestion(id: string): boolean {
    return !!this.taskClient?.ready && this.questionEditingSupported() && !this.taskBlocked && !this.sending && !this.sessionLoading && !this.taskSaving &&
      !this.canonicalReadFailed && !this.taskSaveError &&
      !!this.canonical.get(this.sessionId)?.messages.some((message: RagChatMessage) => message.role === 'user' && message.id === id);
  }

  beginQuestionEdit(id: string): void {
    if (!this.canEditQuestion(id)) return;
    const previous = this.questionEdit();
    if (previous && previous.messageId === id) return;
    const original = this.canonical.get(this.sessionId)?.messages.find((message: RagChatMessage) => message.id === id);
    if (!original) return;
    this.rememberQuestionEdit(this.sessionId, this.questionEdits.get(`${this.sessionId}:${id}`) ||
      { messageId: id, content: original.content, error: '', token: util.generateRandomUUID(), baseVersion: this.canonical.get(this.sessionId)?.version || '' });
    this.questionEditRevision++;
    this.reportPending();
  }

  changeQuestionEdit(id: string, value: string): void {
    const edit = this.questionEdit(id);
    if (!edit || edit.messageId !== id || this.sending || value.length > 2000) return;
    edit.content = value;
    edit.error = '';
    this.questionEditRevision++;
    this.reportPending();
  }

  cancelQuestionEdit(id: string): void {
    if (!this.questionEdit(id) || this.sending || this.taskSaving) return;
    const submissionId = this.questionEdit(id)?.submissionId;
    if (submissionId) this.dismissedEdits.add(submissionId);
    this.forgetQuestionEdit(this.sessionId, id);
    this.questionEditRevision++;
    this.reportPending();
  }

  async reloadQuestionEdit(id: string): Promise<void> {
    const edit = this.questionEdit(), sessionId = this.sessionId;
    if (!edit || edit.messageId !== id || this.sending || this.taskSaving || this.sessionLoading) return;
    await this.readTaskSession(sessionId, this.sessionRequestRevision);
    if (this.pageDisposed || this.sessionId !== sessionId || this.questionEdit() !== edit) return;
    const saved = this.canonical.get(sessionId);
    if (this.deletedSessions.has(sessionId)) { edit.baseVersion = ''; edit.error = '会话已删除，修改稿仍保留，可复制或取消编辑'; }
    else if (this.canonicalReadFailed || !saved) edit.error = '会话读取失败，修改稿仍保留，请重试';
    else if (!saved.messages.some((message: RagChatMessage) => message.role === 'user' && message.id === id)) {
      edit.baseVersion = ''; edit.error = '原问题已不在当前会话中，修改稿仍保留，可复制或取消编辑';
    } else { edit.baseVersion = saved.version; edit.error = ''; }
    this.questionEditRevision++;
    this.reportPending();
  }

  async submitQuestionEdit(id: string): Promise<void> {
    const edit = this.questionEdit(), client = this.taskClient, saved = this.canonical.get(this.sessionId);
    if (!edit || edit.messageId !== id || !client || !saved || !this.canEditQuestion(id) || this.taskBlocked ||
      client.pending.some((input: QaTaskSubmission) => input.sessionId === this.sessionId)) return;
    const question = edit.content.trim();
    if (!question || question.length > 2000) return;
    if (!edit.baseVersion) { edit.error = '请重新读取会话，核对后再发送'; this.questionEditRevision++; return; }
    const sessionId = this.sessionId;
    const original = this.selectedTask;
    const input: QaTaskSubmission = { submissionId: util.generateRandomUUID(), sessionId, baseVersion: edit.baseVersion,
      question, mode: this.answerMode, editMessageId: id };
    if (original?.submissionId === edit.submissionId && original?.editMessageId === id && original.question === question && ['failed', 'cancelled', 'interrupted'].includes(original.state)) input.retryTaskId = original.id;
    edit.error = ''; edit.submissionId = input.submissionId;
    this.sending = true; this.errorMessage = ''; this.view.beforeSend();
    this.questionEditRevision++;
    try { await client.submit(input); }
    catch (error) {
      edit.error = error instanceof Error ? error.message : '修改尚未发送，请重试';
      edit.submissionId = undefined;
      if (this.sessionId === sessionId) this.sending = false;
    }
    this.taskFingerprint = ''; this.applyTasks(); this.reportPending();
  }

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

  answerMessages(): QaAnswerMessage[] {
    if (!this.taskMode) return this.messages;
    const saved = this.canonical.get(this.sessionId)?.messages || [];
    const tasks = (this.taskClient?.tasks || []).filter((task: QaTask) => task.applicable !== false && task.sessionId === this.sessionId)
      .sort((a: QaTask, b: QaTask) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const editTask = latestTask(tasks, this.sessionId);
    const previewingEdit = !!editTask?.editMessageId && (taskActive(editTask) || editTask.state === 'succeeded' && editTask.saveState !== 'saved');
    const pairs: RagChatMessage[] = previewingEdit ? taskMessages(editTask!, this.canonical.get(this.sessionId)) : [...saved];
    tasks.forEach((task: QaTask) => {
      if (task.editMessageId || previewingEdit) return;
      const questionId = task.questionMessageId || `${task.id}:user`;
      if (!pairs.some((message: RagChatMessage) => message.id === questionId)) {
        // Unassociated legacy results remain separate; matching question text proves nothing.
        if (task.saveState === 'saved') return;
        pairs.push({ id: questionId, role: 'user', content: task.question },
          { id: `${task.id}:assistant`, role: 'assistant', content: task.result?.answer || task.partial });
      }
    });
    if (!pairs.length) return this.messages;
    const result: QaAnswerMessage[] = [];
    for (let index = 0; index < pairs.length; index += 2) {
      const question = pairs[index], answer = pairs[index + 1];
      if (!answer) continue;
      const continuing = this.taskClient?.pending.some((input: QaTaskSubmission) => input.sessionId === this.sessionId && !input.replaceLast);
      const relatedTasks = tasks.filter((task: QaTask) => (task.questionMessageId || `${task.id}:user`) === question.id);
      const related = index < saved.length && (index < pairs.length - 2 || continuing) &&
        relatedTasks.every((task: QaTask) => task.saveState === 'saved') ? [] : relatedTasks;
      const variants: RagChatMessage[] = [];
      related.forEach((task: QaTask) => {
        if (task.previousAnswer && !variants.some((item: RagChatMessage) => item.id === task.previousAnswer?.id)) variants.push(task.previousAnswer);
        const item = taskMessages(task).slice(-1)[0];
        if (!variants.some((existing: RagChatMessage) => existing.id === item.id)) variants.push(item);
      });
      if (!variants.some((item: RagChatMessage) => item.id === answer.id)) variants.unshift(answer);
      const newest = related[related.length - 1];
      const fallback = newest && newest.saveState !== 'saved' ? `${newest.id}:assistant` : answer.id;
      const selectedId = this.answerViews.get(`${this.sessionId}:${question.id}`) || fallback;
      const selected = variants.find((item: RagChatMessage) => item.id === selectedId) || variants.find((item: RagChatMessage) => item.id === fallback) || answer;
      const task = related.find((item: QaTask) => `${item.id}:assistant` === selected.id);
      const rendered: QaAnswerMessage = { id: selected.id, role: selected.role, content: selected.content,
        citations: selected.citations, status: selected.status, error: selected.error, groundingWarning: selected.groundingWarning,
        questionId: question.id, versions: variants.map((item: RagChatMessage) => item.id),
        versionIndex: variants.findIndex((item: RagChatMessage) => item.id === selected.id), taskId: task?.id,
        saveError: task?.state === 'succeeded' && ['error', 'conflict'].includes(task.saveState) ? task.saveError || '回答已保留，尚未写入会话' : '',
        canSave: task?.state === 'succeeded' && task.saveState === 'error',
        canDiscard: task?.state === 'succeeded' && ['error', 'conflict'].includes(task.saveState),
        canRetry: !!task && task.id === latestTask(tasks, this.sessionId)?.id && ['failed', 'cancelled', 'interrupted'].includes(task.state) && !this.taskBlocked,
        canRegenerate: index === saved.length - 2 && answer.id === selected.id && !this.question.trim() && !this.sending && !this.taskSaving && !this.taskBlocked && !this.taskSaveError };
      const origin = tasks.find((task: QaTask) => `${task.id}:user` === question.id && !task.replaceLast);
      const renderedQuestion: QaAnswerMessage = { id: question.id, role: question.role, content: question.content,
        questionCreatedAt: origin?.createdAt };
      result.push(renderedQuestion, rendered);
    }
    return result;
  }

  async selectAnswerVersion(questionId: string, answerId: string): Promise<void> {
    const message = this.answerMessages().find((item: QaAnswerMessage) => item.questionId === questionId);
    if (this.taskSaving || !message?.versions?.includes(answerId)) return;
    this.answerViews.set(`${this.sessionId}:${questionId}`, answerId);
    this.taskBlocked = this.blockTaskSubmission();
    // Selecting a version changes only the preview; sending commits that selection.
    this.messages = [...this.messages];
  }

  viewingPreviousAnswer(): boolean {
    const saved = this.canonical.get(this.sessionId)?.messages || [], rendered = this.answerMessages();
    for (let index = 0; index < saved.length; index += 2) {
      if (!this.answerViews.has(`${this.sessionId}:${saved[index].id}`)) continue;
      const answer = rendered.find((item: QaAnswerMessage) => item.questionId === saved[index].id);
      if (answer && answer.id !== saved[index + 1]?.id) return true;
    }
    return false;
  }

  async regenerateAnswer(answerId: string): Promise<void> {
    const saved = this.canonical.get(this.sessionId)?.messages || [];
    const answer = this.answerMessages().find((item: QaAnswerMessage) => item.id === answerId);
    if (!answer?.canRegenerate || saved[saved.length - 1]?.id !== answerId) return;
    this.answerViews.delete(`${this.sessionId}:${saved[saved.length - 2].id}`);
    this.question = saved[saved.length - 2].content;
    await this.sendTask(true);
  }

  async saveAnswer(taskId: string): Promise<void> {
    if (!this.answerMessages().some((item: QaAnswerMessage) => item.taskId === taskId && item.canSave) || this.taskSaving) return;
    const sessionId = this.sessionId, revision = this.sessionRequestRevision;
    this.taskSaving = true;
    try {
      await this.taskClient?.save(taskId);
      if (!this.pageDisposed && revision === this.sessionRequestRevision && sessionId === this.sessionId) await this.readTaskSession(sessionId, revision);
    }
    catch (error) { if (!this.pageDisposed && revision === this.sessionRequestRevision) this.errorMessage = error instanceof Error ? error.message : '保存重试失败'; }
    finally { this.taskSaving = false; this.taskFingerprint = ''; this.applyTasks(); }
  }

  async retryAnswer(taskId: string): Promise<void> {
    if (!this.answerMessages().some((item: QaAnswerMessage) => item.taskId === taskId && item.canRetry)) return;
    await this.retryTask();
  }

  private reportPending(): void {
    const dirty = Array.from(this.questionEdits.entries()).some((entry: [string, QaQuestionEdit]) =>
      entry[1].content !== this.canonical.get(entry[0].split(':')[0])?.messages.find((message: RagChatMessage) => message.id === entry[1].messageId)?.content);
    this.view.onPendingChange(!!this.failedAttempt || !!this.pendingWrite);
    this.view.onQuestionEditsChange?.(dirty);
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
      this.selectedTask = undefined; this.taskSaveError = '';
      this.taskCanRetry = false; this.sending = false; this.taskFingerprint = ''; this.taskBlocked = !this.taskClient.ready;
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
    const ids = new Set<string>(client.tasks.filter((task: QaTask) => task.applicable !== false).map((task: QaTask) => task.sessionId));
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
    const navigation = JSON.stringify([client.tasks.map((task: QaTask) => [task.id, task.state, task.saveState, task.applicable]), client.pending]);
    if (navigation !== this.navigationFingerprint) { this.navigationFingerprint = navigation; this.publishTaskSessions(); this.loadSessions(); }
    const latest = latestTask(client.tasks, this.sessionId);
    const choice = latest?.id || '';
    if (this.taskSaving) return;
    const task = client.tasks.find((item: QaTask) => item.id === choice);
    const pending = client.pending.find((input: QaTaskSubmission) => input.sessionId === this.sessionId && !client.tasks.some((item: QaTask) => item.submissionId === input.submissionId));
    const fingerprint = JSON.stringify([this.sessionId, choice, task?.revision, latest?.id, latest?.saveState, pending, client.ready, client.questionEditing, client.tasks.filter((item: QaTask) => item.sessionId === this.sessionId).map((item: QaTask) => [item.id, item.revision, item.applicable])]);
    if (fingerprint === this.taskFingerprint) return;
    this.taskFingerprint = fingerprint;
    this.taskCanRetry = !pending && !!task && !task.editMessageId && task.id === latest?.id && ['failed', 'cancelled', 'interrupted'].includes(task.state);
    this.taskSaveError = !pending && task?.state === 'succeeded' && ['error', 'conflict'].includes(task.saveState) ? task.saveError || '回答已保留，尚未写入会话' : '';
    this.selectedTask = pending ? undefined : task;
    this.taskBlocked = this.blockTaskSubmission();
    this.sending = !!pending || !!task && taskActive(task);
    this.receivedDone = !pending && task?.state === 'succeeded'; this.pendingWrite = undefined; this.failedAttempt = undefined;
    this.view.onBusyChange(false); this.reportPending();
    if (pending) {
      const saved = this.canonical.get(this.sessionId)?.messages || [];
      if (pending.editMessageId && !this.questionEdit()) {
        this.rememberQuestionEdit(this.sessionId, { messageId: pending.editMessageId, content: pending.question, error: '',
          token: util.generateRandomUUID(), baseVersion: pending.baseVersion || '', submissionId: pending.submissionId }); this.questionEditRevision++;
      }
      const editIndex = pending.editMessageId ? saved.findIndex((message: RagChatMessage) => message.role === 'user' && message.id === pending.editMessageId) : -1;
      this.messages = [...(editIndex >= 0 ? saved.slice(0, editIndex) : pending.replaceLast ? saved.slice(0, -2) : saved), { id: `${pending.submissionId}:user`, role: 'user', content: pending.question },
        { id: `${pending.submissionId}:assistant`, role: 'assistant', content: '', status: 'streaming' }];
      this.statusText = pending.cancelRequested ? '正在确认停止…' : '正在确认问答任务…';
    } else if (task) {
      this.statusText = task.state === 'queued' ? '正在等待前一项问答完成…' : taskActive(task) ? task.stage : task.saveState === 'pending' ? '正在保存回答…' : '';
      this.answerMode = task.mode; this.errorMessage = task.state === 'failed' || task.state === 'interrupted' ? task.error : '';
      this.messages = taskMessages(task, this.canonical.get(this.sessionId), task.id !== latest?.id);
      if (task.editMessageId && !taskActive(task) && task.state !== 'succeeded') {
        this.messages = this.canonical.get(this.sessionId)?.messages || [];
        if (!this.dismissedEdits.has(task.submissionId)) {
          const edit = this.questionEdit(task.editMessageId);
          if (!edit && !this.questionEdit()) {
            this.rememberQuestionEdit(this.sessionId, { messageId: task.editMessageId, content: task.question,
              error: task.state === 'cancelled' ? '修改后的生成已停止，原对话与编辑草稿已保留' : task.error || '修改后的生成失败，原对话与编辑草稿已保留',
              token: util.generateRandomUUID(), baseVersion: '', submissionId: task.submissionId });
            this.questionEdit()!.error += ' 请重新读取会话，核对后再发送';
          } else if (edit?.submissionId === task.submissionId) {
            edit.error = task.state === 'cancelled' ? '修改后的生成已停止，原对话与编辑草稿已保留' : task.error || '修改后的生成失败，原对话与编辑草稿已保留';
            if (!edit.baseVersion) edit.error += ' 请重新读取会话，核对后再发送';
          }
          this.questionEditRevision++;
        }
        this.errorMessage = '';
      }
      if (task.saveState === 'saved' && task.id === latest?.id && !this.sessionLoading) this.readTaskSession(this.sessionId, this.sessionRequestRevision);
    } else {
      this.statusText = ''; this.messages = this.canonical.get(this.sessionId)?.messages || [];
      if (this.sessionId && !this.sessionLoading) this.readTaskSession(this.sessionId, this.sessionRequestRevision);
    }
    this.reportPending();
  }

  private blockTaskSubmission(): boolean {
    const client = this.taskClient, task = this.selectedTask;
    const selected = this.answerMessages().find((item: QaAnswerMessage) => item.questionId ===
      this.canonical.get(this.sessionId)?.messages.slice(-2)[0]?.id);
    return !client?.ready || this.deletedSessions.has(this.sessionId) || this.canonicalReadFailed ||
      !!selected && (selected.status === 'streaming' || selected.status === 'error' || selected.status === 'stopped' || !selected.content.trim()) ||
      !!task && task.state === 'succeeded' && task.saveState === 'pending' ||
      !!client?.pending.some((input: QaTaskSubmission) => input.sessionId === this.sessionId) ||
      !!client?.tasks.some((item: QaTask) => item.sessionId === this.sessionId && taskActive(item) && item.id !== task?.id);
  }

  private async readTaskSession(id: string, revision: number): Promise<void> {
    const startedTask = latestTask(this.taskClient?.tasks || [], id);
    const startedTaskId = startedTask?.id, startedSaveState = startedTask?.saveState;
    let reconcileCommit: boolean = false;
    this.sessionLoading = true;
    try {
      const response = await this.transport.get<RagSessionResponse>(`/rag/sessions/${encodeURIComponent(id)}`);
      if (this.pageDisposed || revision !== this.sessionRequestRevision || this.sessionId !== id || this.deletedSessions.has(id)) return;
      if (response.session.id !== id || !Array.isArray(response.session.messages) || !/^[a-f0-9]{64}$/.test(response.session.version)) throw new Error('会话响应不完整，请重试');
      const committedEdit = latestTask(this.taskClient?.tasks || [], id);
      if (committedEdit?.editMessageId && committedEdit.saveState === 'saved' &&
        !response.session.messages.some((message: RagChatMessage) => message.id === `${committedEdit.id}:assistant`)) {
        if (startedTaskId !== committedEdit.id || startedSaveState !== 'saved') {
          // This read began before the edit commit. Do not let its captured old
          // branch replace the confirmed result; reconcile once after it settles.
          reconcileCommit = true;
          return;
        }
        throw new Error('回答已保存，但读取到的会话仍为旧版本，请重新读取');
      }
      if (committedEdit?.editMessageId && committedEdit.saveState === 'saved' &&
        response.session.messages.some((message: RagChatMessage) => message.id === `${committedEdit.id}:assistant`)) {
        // Applicability derives from the server's committed branch receipt, not
        // task timestamps. Reconcile it before exposing the new canonical view.
        await this.taskClient?.readSessionTasks(id);
        if (this.pageDisposed || revision !== this.sessionRequestRevision || this.sessionId !== id || this.deletedSessions.has(id)) return;
      }
      this.canonical.set(id, response.session); this.sessionVersion = response.session.version || ''; this.canonicalReadFailed = false; this.failedSessionId = '';
      const latest = latestTask(this.taskClient?.tasks || [], id);
      const edit = this.questionEdit();
      if (latest?.editMessageId && latest.saveState === 'saved' && edit?.submissionId === latest.submissionId &&
        response.session.messages.some((message: RagChatMessage) => message.id === `${latest.id}:assistant`)) {
        this.forgetQuestionEdit(id, edit.messageId); this.questionEditRevision++;
      }
      if (this.selectedTask?.saveState === 'saved' && this.selectedTask.id === latest?.id || !this.selectedTask) {
        this.messages = response.session.messages; this.answerMode = response.session.answerMode; this.errorMessage = '';
      }
      this.reportPending();
    } catch (error) {
      if (this.pageDisposed || revision !== this.sessionRequestRevision || this.sessionId !== id) return;
      if (error instanceof ApiError && error.statusCode === 404) {
        const remaining = this.taskClient?.tasks.some((task: QaTask) => task.applicable !== false && task.sessionId === id) || this.taskClient?.pending.some((input: QaTaskSubmission) => input.sessionId === id);
        if (Array.from(this.questionEdits.keys()).some((key: string) => key.startsWith(`${id}:`))) {
          this.deletedSessions.add(id); this.remoteSessions = this.remoteSessions.filter((session: RagSessionSummary) => session.id !== id);
          this.canonical.delete(id); this.messages = []; this.sending = false; this.pendingSessionKey = '';
          this.failedSessionId = ''; this.errorMessage = ''; this.noticeMessage = '会话已删除，编辑草稿仍保留，可复制或取消';
          this.publishTaskSessions(); this.reportPending(); return;
        }
        if (this.canonical.has(id) || this.remoteSessions.some((session: RagSessionSummary) => session.id === id)) {
          this.deletedSessions.add(id); this.remoteSessions = this.remoteSessions.filter((session: RagSessionSummary) => session.id !== id);
          this.canonical.delete(id); await this.newSession(); this.noticeMessage = '该会话已被删除，已停止恢复'; this.publishTaskSessions();
        } else { this.canonicalReadFailed = false; if (!remaining && !this.sending) this.errorMessage = '该会话尚无已保存回答，可查看对应问题下保留的回答'; }
      } else { this.canonicalReadFailed = true; this.failedSessionId = id; this.pendingSessionKey = ''; this.errorMessage = error instanceof Error ? error.message : '会话读取失败，请重试'; this.view.onSessionReady(); }
    } finally {
      if (!this.pageDisposed && revision === this.sessionRequestRevision) {
        this.sessionLoading = false; this.taskBlocked = this.blockTaskSubmission();
        if (reconcileCommit && this.sessionId === id) { this.taskFingerprint = ''; this.applyTasks(); }
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
    if (!this.pageDisposed && revision === this.sessionRequestRevision) {
      try { await this.taskClient?.readSessionTasks(id); }
      catch (error) { if (revision === this.sessionRequestRevision) this.taskError = error instanceof Error ? error.message : '回答版本读取失败'; }
    }
  }

  private async commitAnswerSelection(): Promise<boolean> {
    if (!this.viewingPreviousAnswer()) return true;
    const sessionId = this.sessionId, saved = this.canonical.get(sessionId);
    const answer = this.answerMessages().find((item: QaAnswerMessage) => item.questionId === saved?.messages.slice(-2)[0]?.id);
    if (!saved || !answer || !answer.content.trim() || ['streaming', 'error', 'stopped'].includes(answer.status || '')) return false;
    const selected: RagChatMessage = { id: answer.id, role: 'assistant', content: answer.content,
      citations: answer.citations, status: 'complete', groundingWarning: answer.groundingWarning };
    const messages = [...saved.messages.slice(0, -1), selected];
    if (this.selectionSessionId !== sessionId || this.selectionWrite?.baseVersion !== saved.version ||
      JSON.stringify(this.selectionWrite?.messages) !== JSON.stringify(messages)) {
      this.selectionSessionId = sessionId;
      this.selectionWrite = { mutationId: util.generateRandomUUID(), baseVersion: saved.version,
        answerMode: saved.answerMode, messages };
    }
    const revision = ++this.sessionRequestRevision;
    this.taskSaving = true;
    try {
      const response = await this.transport.put<RagSessionResponse>(`/rag/sessions/${encodeURIComponent(sessionId)}`, this.selectionWrite);
      if (this.pageDisposed || this.sessionId !== sessionId || revision !== this.sessionRequestRevision) return false;
      this.canonical.set(sessionId, response.session); this.sessionVersion = response.session.version;
      this.messages = response.session.messages;
      this.answerViews.delete(`${sessionId}:${saved.messages[saved.messages.length - 2].id}`);
      this.selectionWrite = undefined;
      return true;
    } catch (error) {
      if (this.sessionId === sessionId && revision === this.sessionRequestRevision) {
        this.errorMessage = error instanceof Error ? error.message : '所选回答保存失败，尚未发送问题，请重试';
      }
      return false;
    } finally { this.taskSaving = false; }
  }

  private async sendTask(replaceLast: boolean = false, retryTaskId: string = ''): Promise<void> {
    const client = this.taskClient, question = this.question.trim();
    if (!client || this.questionEdit() || !question || question.length > 2000 || this.sending || this.sessionLoading || this.taskSaving || this.taskBlocked || this.taskSaveError) return;
    if (!client.ready) { this.errorMessage = '任务协议尚未就绪，请重试检查'; return; }
    const originSessionId = this.sessionId;
    this.sending = true;
    if (!await this.commitAnswerSelection()) {
      if (this.sessionId === originSessionId) this.sending = false;
      else { this.taskFingerprint = ''; this.applyTasks(); }
      return;
    }
    if (!this.sessionId) { this.sessionId = util.generateRandomUUID(); this.view.onActiveSessionChange(this.sessionId); }
    const sessionId = this.sessionId;
    const input: QaTaskSubmission = { submissionId: util.generateRandomUUID(), sessionId, baseVersion: this.canonical.get(sessionId)?.version || this.sessionVersion || null, question, mode: this.answerMode, replaceLast };
    if (retryTaskId) input.retryTaskId = retryTaskId;
    this.question = ''; this.errorMessage = ''; this.sending = true; this.view.beforeSend(); this.view.showComposer();
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
    this.question = original.question; await this.sendTask(original.replaceLast, original.id);
  }
  async discardTask(id: string): Promise<void> {
    const client = this.taskClient;
    const task = client?.tasks.find((item: QaTask) => item.id === id && item.sessionId === this.sessionId);
    if (!client || !task || task.state !== 'succeeded' || !['error', 'conflict'].includes(task.saveState) || this.taskSaving) return;
    const sessionId = this.sessionId, revision = this.sessionRequestRevision; this.taskSaving = true;
    try {
      await client.remove(id);
      if (revision === this.sessionRequestRevision && this.sessionId === sessionId) { this.selectedTask = undefined; await this.readTaskSession(sessionId, revision); }
    } catch (error) { if (revision === this.sessionRequestRevision) this.errorMessage = error instanceof Error ? error.message : '放弃结果未完成'; }
    finally { this.taskSaving = false; this.taskFingerprint = ''; this.applyTasks(); }
  }
  async refreshTasks(): Promise<void> { await this.taskClient?.connect(); this.taskFingerprint = ''; this.applyTasks(); }

  forgetTaskSession(id: string): void {
    this.deletedSessions.add(id); this.canonical.delete(id);
    for (const key of this.questionEdits.keys()) if (key.startsWith(`${id}:`)) this.questionEdits.delete(key);
    this.activeQuestionEdits.delete(id); this.questionEditRevision++;
    this.remoteSessions = this.remoteSessions.filter((session: RagSessionSummary) => session.id !== id);
    this.taskClient?.forgetSession(id).catch((error: Error) => { if (!this.pageDisposed) this.taskError = error.message; });
    if (this.sessionId === id) this.newSession();
    this.publishTaskSessions();
  }
}
