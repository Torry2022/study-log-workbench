import { ApiClient } from '../../common/network/ApiClient';
import { RagSessionSummary, RagSessionResponse, RagSessionsResponse } from './QaModels';
import { util } from '@kit.ArkTS';

interface RenameSessionRequest { title: string; baseVersion: string; mutationId: string; }
interface DeleteSessionRequest { baseVersion: string; mutationId: string; }
interface DeleteResponse { ok: boolean; }
export interface QaNavigationView {
  active: () => boolean;
  busy: () => boolean;
  setBusy: (value: boolean) => void;
  activeSession: () => string;
  clearSession: () => void;
}

@Observed
export class QaNavigationController {
  qaSessions: RagSessionSummary[] = [];
  qaNavigationLoading: boolean = false;
  qaNavigationError: string = '';
  qaMenuId: string = '';
  qaRenameId: string = '';
  qaRenameTitle: string = '';
  qaNavigationRevision: number = 0;
  qaMutationRevision: number = 0;
  private pendingRename?: RenameSessionRequest;
  private pendingRenameId: string = '';
  private pendingDelete?: DeleteSessionRequest;
  private pendingDeleteId: string = '';
  private transport: ApiClient;
  private view: QaNavigationView;
  constructor(transport: ApiClient, view: QaNavigationView) { this.transport = transport; this.view = view; }

  async loadQaNavigation(): Promise<void> {
    if (!this.view.active() || this.qaNavigationLoading) return;
    const revision = ++this.qaNavigationRevision;
    this.qaNavigationLoading = true;
    this.qaNavigationError = '';
    try {
      const response = await this.transport.get<RagSessionsResponse>('/rag/sessions');
      if (revision !== this.qaNavigationRevision) return;
      this.qaSessions = response.sessions;
    } catch (_) {
      if (revision !== this.qaNavigationRevision) return;
      this.qaNavigationError = '历史问答读取失败';
    } finally {
      if (revision === this.qaNavigationRevision) this.qaNavigationLoading = false;
    }
  }

  acceptQaNavigation(sessions: RagSessionSummary[]): void {
    if (!this.view.active()) return;
    this.qaNavigationRevision++;
    this.qaNavigationLoading = false;
    this.qaNavigationError = '';
    this.qaSessions = sessions;
  }

  async commitQaRename(): Promise<void> {
    if (!this.view.active()) return;
    const title = this.qaRenameTitle.trim();
    if (!this.qaRenameId || !title || this.view.busy()) return;
    const id = this.qaRenameId;
    const session = this.qaSessions.find((item: RagSessionSummary) => item.id === id);
    if (!session?.version) return;
    const revision = this.qaMutationRevision;
    this.view.setBusy(true);
    this.qaNavigationError = '';
    try {
      if (!this.pendingRename || this.pendingRenameId !== id || this.pendingRename.title !== title ||
        this.pendingRename.baseVersion !== session.version) {
        this.pendingRename = { title, baseVersion: session.version, mutationId: util.generateRandomUUID() };
        this.pendingRenameId = id;
      }
      const request = this.pendingRename;
      const response = await this.transport.patch<RagSessionResponse>(
        `/rag/sessions/${encodeURIComponent(id)}`,
        request
      );
      if (revision !== this.qaMutationRevision) return;
      this.acceptQaNavigation(this.qaSessions.map((session: RagSessionSummary) =>
        session.id === response.session.id ? response.session : session
      ));
      this.pendingRename = undefined;
      this.pendingRenameId = '';
      if (this.qaRenameId === id && this.qaRenameTitle.trim() === title) {
        this.qaRenameId = '';
        this.qaRenameTitle = '';
      }
    } catch (_) {
      if (revision !== this.qaMutationRevision || this.qaRenameId !== id) return;
      this.qaNavigationError = '会话重命名失败';
    } finally {
      if (revision === this.qaMutationRevision) this.view.setBusy(false);
    }
  }

  async deleteQaSession(id: string): Promise<void> {
    if (!this.view.active() || this.view.busy()) return;
    const session = this.qaSessions.find((item: RagSessionSummary) => item.id === id);
    if (!session?.version) return;
    const revision = this.qaMutationRevision;
    this.view.setBusy(true);
    this.qaNavigationError = '';
    try {
      if (!this.pendingDelete || this.pendingDeleteId !== id || this.pendingDelete.baseVersion !== session.version) {
        this.pendingDelete = { baseVersion: session.version, mutationId: util.generateRandomUUID() };
        this.pendingDeleteId = id;
      }
      await this.transport.delete<DeleteResponse>(`/rag/sessions/${encodeURIComponent(id)}`, this.pendingDelete);
      if (revision !== this.qaMutationRevision) return;
      this.acceptQaNavigation(this.qaSessions.filter((session: RagSessionSummary) => session.id !== id));
      this.pendingDelete = undefined;
      this.pendingDeleteId = '';
      if (this.qaMenuId === id) this.qaMenuId = '';
      if (id === this.view.activeSession()) {
        this.view.clearSession();
      }
    } catch (_) {
      if (revision !== this.qaMutationRevision) return;
      this.qaNavigationError = '会话删除失败';
    } finally {
      if (revision === this.qaMutationRevision) this.view.setBusy(false);
    }
  }

}
