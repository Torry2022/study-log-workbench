import { ApiClient, ApiError } from '../../common/network/ApiClient';
import { InstanceCapabilities } from '../../common/network/InstanceConfig';
import { QaTask, QaTaskListResponse, QaTaskResponse, QaTaskStorage, QaTaskSubmission, QaTaskSummary, taskActive, taskRetained, validTask, validTaskSummary } from './QaTaskModels';

interface RemoveResponse { removed: boolean; }
class TaskAction {}

// One instance's protocol connection. Disconnecting discovery never cancels execution.
export class QaTaskClient {
  tasks: QaTask[] = [];
  pending: QaTaskSubmission[] = [];
  ready: boolean = false;
  error: string = '';
  onChange: () => void = () => {};
  private transport: ApiClient;
  private storage: QaTaskStorage;
  private instanceId: string;
  private binding: string;
  private removed: Set<string> = new Set<string>();
  private deletedSessions: Set<string> = new Set<string>();
  private sending: Map<string, Promise<void>> = new Map<string, Promise<void>>();
  private writes: Promise<void> = Promise.resolve();
  private refreshing?: Promise<void>;
  private stopped: boolean = false;
  private revision: number = 0;
  private timer: number = -1;

  constructor(transport: ApiClient, storage: QaTaskStorage, instanceId: string) {
    this.transport = transport; this.storage = storage; this.instanceId = instanceId;
    this.binding = transport.getConnectionBinding();
  }
  private checkConnection(): void {
    if (this.stopped || this.binding !== this.transport.getConnectionBinding()) throw new Error('连接已切换或已停止查看，请重新连接');
  }
  private notify(): void { if (!this.stopped) this.onChange(); }
  private async updatePending(input: QaTaskSubmission, remove: boolean = false): Promise<void> {
    const work = this.writes.catch(() => {}).then(async () => {
      const next = this.pending.filter((item: QaTaskSubmission) => item.submissionId !== input.submissionId);
      if (!remove) next.push(input);
      await this.storage.write(JSON.stringify(next));
      this.pending = next; this.notify();
    });
    this.writes = work; await work;
  }
  async connect(): Promise<void> {
    this.stopped = false;
    const revision = ++this.revision;
    this.ready = false;
    try {
      this.checkConnection();
      const values = JSON.parse(await this.storage.read() || '[]') as QaTaskSubmission[];
      const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
      if (!Array.isArray(values) || values.some((item: QaTaskSubmission) => !item || !uuid.test(item.submissionId) || !uuid.test(item.sessionId) ||
        item.baseVersion !== null && !/^[a-f0-9]{64}$/.test(item.baseVersion) || typeof item.question !== 'string' || !item.question.trim() || item.question.length > 2000 ||
        !['logs_only', 'logs_and_general'].includes(item.mode) || item.replaceLast !== undefined && typeof item.replaceLast !== 'boolean' ||
        item.retryTaskId !== undefined && !uuid.test(item.retryTaskId) ||
        item.cancelRequested !== undefined && typeof item.cancelRequested !== 'boolean')) throw new Error('待确认问答记录无法读取，请保留本地数据后重试');
      const capability = await this.transport.getForInstance<InstanceCapabilities>('/capabilities', this.instanceId);
      if (this.stopped || revision !== this.revision) return;
      if (capability.instanceId !== this.instanceId) throw new Error('服务器实例已变化，请重新连接');
      // Preferences can retain an unflushed value after a failed write. Confirm it
      // is durable before replaying any previously stored submission.
      if (values.length) await this.storage.write(JSON.stringify(values));
      if (this.stopped || revision !== this.revision) return;
      const task = capability.features.ragTasks;
      this.ready = !!task?.supported && task.configured && task.protocolVersion === 1;
      this.pending = values;
      this.error = this.ready ? '' : '问答任务执行器未就绪或协议不兼容，请重试检查';
      this.notify();
      if (this.ready) await this.refresh();
    } catch (error) {
      if (this.stopped || revision !== this.revision) return;
      this.error = error instanceof Error ? error.message : '任务恢复失败，请重试'; this.notify();
    }
  }
  start(): void {
    const tick = async (): Promise<void> => {
      if (this.ready) await this.refresh(); else await this.connect();
      if (!this.stopped) this.timer = setTimeout(() => tick(), 1000);
    };
    this.connect().then(() => { if (!this.stopped) this.timer = setTimeout(() => tick(), 1000); });
  }
  stop(): void { this.stopped = true; this.revision++; clearTimeout(this.timer); }
  private accept(task: QaTask): void {
    if (!validTask(task)) throw new Error('任务快照响应不完整');
    if (this.stopped || this.binding !== this.transport.getConnectionBinding() || this.removed.has(task.id) || this.deletedSessions.has(task.sessionId)) return;
    const old = this.tasks.find((item: QaTask) => item.id === task.id);
    if (old && old.revision >= task.revision) return;
    this.tasks = [...this.tasks.filter((item: QaTask) => item.id !== task.id), task]; this.notify();
  }
  async read(id: string): Promise<void> {
    try {
      this.checkConnection();
      const response = await this.transport.getForInstance<QaTaskResponse>(`/rag/tasks/${id}`, this.instanceId);
      if (response.task.id !== id) throw new Error('任务身份不匹配');
      this.accept(response.task);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404 && !this.stopped) {
        this.removed.add(id); this.tasks = this.tasks.filter((item: QaTask) => item.id !== id); this.notify();
      }
      throw error instanceof Error ? error : new Error('任务读取失败');
    }
  }
  async refresh(): Promise<void> {
    if (this.stopped || !this.ready) return;
    if (this.refreshing) return this.refreshing;
    const revision = this.revision;
    const work = async (): Promise<void> => {
      try {
        this.checkConnection();
        const response = await this.transport.getForInstance<QaTaskListResponse>('/rag/tasks', this.instanceId);
        if (this.stopped || revision !== this.revision) return;
        if (!Array.isArray(response.tasks) || response.tasks.some((task: QaTaskSummary) => !validTaskSummary(task))) throw new Error('任务列表响应不完整');
        const latest = new Map<string, QaTaskSummary>();
        response.tasks.forEach((task: QaTaskSummary) => {
          const old = latest.get(task.sessionId);
          if (!old || `${task.createdAt}:${task.id}` > `${old.createdAt}:${old.id}`) latest.set(task.sessionId, task);
        });
        const retained = response.tasks.filter(taskRetained).map((task: QaTaskSummary) => task.sessionId);
        const wanted = response.tasks.filter((task: QaTaskSummary) => {
          const old = this.tasks.find((item: QaTask) => item.id === task.id);
          return old ? old.revision < task.revision : taskRetained(task) || latest.get(task.sessionId)?.id === task.id &&
            (task.saveState !== 'saved' && task.saveState !== 'deleted' || retained.includes(task.sessionId));
        });
        await Promise.all(wanted.map(async (task: QaTaskSummary): Promise<void> => {
          if (this.stopped || revision !== this.revision) return;
          await this.read(task.id).catch((error: Error) => { if (!(error instanceof ApiError && error.statusCode === 404)) throw error; });
        }));
        for (const task of this.tasks) if (task.saveState !== 'saved' && !response.tasks.some((item: QaTaskSummary) => item.id === task.id)) {
          await this.read(task.id).catch((error: Error) => { if (!(error instanceof ApiError && error.statusCode === 404)) throw error; });
        }
        for (const input of this.pending) {
          if (this.stopped || revision !== this.revision) return;
          const found = response.tasks.find((task: QaTaskSummary) => task.submissionId === input.submissionId);
          if (found) { await this.read(found.id); if (input.cancelRequested) await this.cancel(found.id); await this.updatePending(input, true); }
          else await this.send(input);
        }
        if (!this.pending.length) this.error = ''; this.notify();
      } catch (error) {
        if (this.stopped || revision !== this.revision) return;
        this.error = error instanceof Error ? error.message : '任务读取失败，请重试'; this.notify();
      }
    };
    this.refreshing = work().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  async readSessionTasks(sessionId: string): Promise<void> {
    this.checkConnection();
    const response = await this.transport.getForInstance<QaTaskListResponse>(`/rag/tasks?sessionId=${encodeURIComponent(sessionId)}`, this.instanceId);
    if (!Array.isArray(response.tasks) || response.tasks.some((task: QaTaskSummary) => !validTaskSummary(task))) throw new Error('回答版本列表响应不完整');
    // Fetch only this conversation, not the result bodies of every conversation in discovery.
    for (const task of response.tasks.filter((item: QaTaskSummary) => item.sessionId === sessionId)) {
      if (!this.tasks.some((old: QaTask) => old.id === task.id && old.revision >= task.revision)) await this.read(task.id);
    }
  }
  async submit(input: QaTaskSubmission): Promise<void> {
    this.checkConnection();
    if (!this.ready || this.stopped) throw new Error('任务协议尚未就绪，请重试检查');
    await this.updatePending(input); if (!this.stopped) await this.send(input);
  }
  private async send(input: QaTaskSubmission): Promise<void> {
    const running = this.sending.get(input.submissionId); if (running) return running;
    const work = async (): Promise<void> => {
      try {
        this.checkConnection();
        const body: QaTaskSubmission = { submissionId: input.submissionId, sessionId: input.sessionId, baseVersion: input.baseVersion,
          question: input.question, mode: input.mode, replaceLast: input.replaceLast };
        if (input.retryTaskId) body.retryTaskId = input.retryTaskId;
        const response = await this.transport.postForInstance<QaTaskResponse>('/rag/tasks', body, this.instanceId);
        if (this.stopped) return;
        if (response.task.submissionId !== input.submissionId || response.task.sessionId !== input.sessionId) throw new Error('提交任务身份不匹配');
        this.accept(response.task);
        if (this.pending.find((item: QaTaskSubmission) => item.submissionId === input.submissionId)?.cancelRequested) await this.cancel(response.task.id);
        await this.updatePending(input, true); this.error = ''; this.notify();
      } catch (error) {
        if (this.stopped) return;
        if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500 && ![401, 408, 429].includes(error.statusCode)) {
          await this.updatePending(input, true); throw error;
        }
        this.error = '提交结果尚未确认，将用原提交身份重连，不会另建问答'; this.notify();
      }
    };
    const promise = work().finally(() => { this.sending.delete(input.submissionId); });
    this.sending.set(input.submissionId, promise); return promise;
  }
  async cancel(id: string): Promise<void> {
    this.checkConnection();
    const response = await this.transport.postForInstance<QaTaskResponse>(`/rag/tasks/${id}/cancel`, new TaskAction(), this.instanceId);
    if (response.task.id !== id) throw new Error('任务身份不匹配'); this.accept(response.task);
  }
  async stopPending(sessionId: string): Promise<void> {
    for (const input of this.pending.filter((item: QaTaskSubmission) => item.sessionId === sessionId)) {
      const cancelled: QaTaskSubmission = { submissionId: input.submissionId, sessionId: input.sessionId, baseVersion: input.baseVersion,
        question: input.question, mode: input.mode, replaceLast: input.replaceLast, cancelRequested: true };
      if (input.retryTaskId) cancelled.retryTaskId = input.retryTaskId;
      await this.updatePending(cancelled);
    }
    for (const task of this.tasks.filter((item: QaTask) => item.sessionId === sessionId && taskActive(item))) await this.cancel(task.id);
  }
  async save(id: string): Promise<void> {
    this.checkConnection();
    const response = await this.transport.postForInstance<QaTaskResponse>(`/rag/tasks/${id}/save`, new TaskAction(), this.instanceId);
    if (response.task.id !== id) throw new Error('任务身份不匹配'); this.accept(response.task);
  }
  async remove(id: string): Promise<void> {
    this.checkConnection();
    const response = await this.transport.deleteForInstance<RemoveResponse>(`/rag/tasks/${id}`, this.instanceId);
    if (response.removed !== true) throw new Error('放弃结果尚未确认，请保留回答后重试');
    this.removed.add(id); this.tasks = this.tasks.filter((task: QaTask) => task.id !== id); this.notify();
  }
  async forgetSession(id: string): Promise<void> {
    this.deletedSessions.add(id);
    this.tasks.filter((task: QaTask) => task.sessionId === id).forEach((task: QaTask) => this.removed.add(task.id));
    this.tasks = this.tasks.filter((task: QaTask) => task.sessionId !== id); this.notify();
    for (const input of this.pending.filter((item: QaTaskSubmission) => item.sessionId === id)) await this.updatePending(input, true);
  }
}
