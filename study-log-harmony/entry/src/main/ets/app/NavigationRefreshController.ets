import { ApiClient } from '../common/network/ApiClient';
import { MonthsResponse, DaysResponse } from '../features/logs/LogModels';
import { StudyNotesPayload } from '../features/notes/NoteModels';
import { FavoritePayload } from '../features/favorites/FavoriteModels';
import { RagSessionsResponse } from '../features/qa/QaModels';

export interface NavigationSnapshot {
  months?: MonthsResponse;
  days?: DaysResponse;
  notes?: StudyNotesPayload;
  favorites?: FavoritePayload;
  qa?: RagSessionsResponse;
}

// Navigation refresh never opens a document or resets a selection/editor.
export class NavigationRefreshController {
  private revision: number = 0;
  private transport: ApiClient;
  constructor(transport: ApiClient) { this.transport = transport; }

  invalidate(): void { this.revision += 1; }

  async refresh(tab: number, month: string, current: () => boolean,
    publish: (snapshot: NavigationSnapshot) => void): Promise<void> {
    const revision = ++this.revision;
    const snapshot: NavigationSnapshot = {};
    try {
      if (tab === 0) {
        if (month) {
          const responses = await Promise.all([
            this.transport.get<MonthsResponse>('/logs/months'),
            this.transport.get<DaysResponse>(`/logs?month=${encodeURIComponent(month)}`)
          ]);
          snapshot.months = responses[0];
          snapshot.days = responses[1];
        } else {
          snapshot.months = await this.transport.get<MonthsResponse>('/logs/months');
        }
      } else if (tab === 1) {
        snapshot.notes = await this.transport.get<StudyNotesPayload>('/notes');
      } else if (tab === 2) {
        snapshot.favorites = await this.transport.get<FavoritePayload>('/favorites');
      } else if (tab === 3) {
        snapshot.qa = await this.transport.get<RagSessionsResponse>('/rag/sessions');
      } else if (tab === 4) {
        snapshot.months = await this.transport.get<MonthsResponse>('/logs/months');
      }
      if (revision === this.revision && current()) publish(snapshot);
    } catch (error) {
      if (revision === this.revision && current()) throw new Error('导航刷新失败');
    }
  }
}
