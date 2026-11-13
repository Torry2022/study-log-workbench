import { ConnectionInput, ConnectionCandidate } from '../common/network/ConnectionProbe';
import { ReadCancellation } from '../common/network/ReadCancellation';

export interface ConnectionActions {
  binding: () => string;
  check: (input: ConnectionInput, cancellation: ReadCancellation) => Promise<ConnectionCandidate>;
  confirm: (candidate: ConnectionCandidate) => Promise<boolean>;
  commit: (candidate: ConnectionCandidate, current: () => boolean) => Promise<void>;
  connected: () => Promise<void>;
}

@Observed
export class ConnectionController {
  busy: boolean = false;
  committing: boolean = false;
  error: string = '';
  private revision: number = 0;
  private cancellation?: ReadCancellation;
  private actions: ConnectionActions;

  constructor(actions: ConnectionActions) { this.actions = actions; }

  cancel(): boolean {
    if (this.committing) return false;
    this.revision++;
    this.cancellation?.cancel();
    this.busy = false;
    return true;
  }

  dispose(): void {
    this.revision++;
    this.cancellation?.cancel();
    this.busy = false;
  }

  async connect(input: ConnectionInput): Promise<void> {
    if (this.busy) return;
    const revision = ++this.revision, binding = this.actions.binding();
    const current = (): boolean => revision === this.revision && binding === this.actions.binding();
    const cancellation = new ReadCancellation();
    this.cancellation = cancellation;
    this.busy = true;
    this.error = '';
    try {
      const candidate = await this.actions.check(input, cancellation);
      if (!current()) return;
      if (!await this.actions.confirm(candidate) || !current()) return;
      this.committing = true;
      await this.actions.commit(candidate, current);
      if (revision === this.revision) await this.actions.connected();
    } catch (error) {
      if (current()) this.error = error instanceof Error ? error.message : '连接未完成，请重试';
    } finally {
      if (revision === this.revision) { this.busy = false; this.committing = false; }
      cancellation.release();
    }
  }
}
