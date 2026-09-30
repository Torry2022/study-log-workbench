import { WorkspaceModuleState } from '../WorkspaceModuleState';
import { QaNavigationController } from '../../features/qa/QaNavigationController';
import { FavoritesController } from '../../features/favorites/FavoritesController';
import { RagSessionSummary } from '../../features/qa/QaModels';
import { QaNavigation } from '../../features/qa/components/QaNavigation';
import { NotesNavigation } from '../../features/notes/components/NotesNavigation';
import { FavoritesNavigation } from '../../features/favorites/components/FavoritesNavigation';
import { StatsNavigation } from '../../features/stats/components/StatsNavigation';

// Workspace-owned module navigation; log date navigation remains in its existing slot.
@Component
export struct WorkspaceModuleNavigation {
  @ObjectLink modules: WorkspaceModuleState;
  @ObjectLink qaNavigation: QaNavigationController;
  @ObjectLink favoritesData: FavoritesController;
  @Prop selectedModule: number = 0;
  @Prop wide: boolean = true;
  @Prop popover: boolean = false;
  @Prop moduleFrameHeight: number = 0;
  @Link railPopover: string;
  @BuilderParam logContent: () => void;
  onSession: (id: string) => void = () => {};
  onDelete: (session: RagSessionSummary) => void = () => {};
  onTaxonomy: () => void = () => {};
  onCloseNavigation: () => void = () => {};

  @Builder
  private desktopContent() {
    if ((this.selectedModule === 3)) {
      QaNavigation({ qaRailPopover: this.popover ? this.railPopover : '', moduleFrameHeight: this.moduleFrameHeight,
                    qaSessions: this.qaNavigation.qaSessions, qaSessionQuery: this.modules.qaQuery,
                    qaSearchRevision: this.modules.qaSearchRevision,
                    qaActiveSessionId: this.modules.qaSessionId, qaBusy: this.modules.qaBusy,
                    qaNavigationLoading: this.qaNavigation.qaNavigationLoading,
                    qaNavigationError: this.qaNavigation.qaNavigationError,
                    qaRenameId: this.qaNavigation.qaRenameId,
                    qaRenameTitle: this.qaNavigation.qaRenameTitle,
                    qaMenuId: this.qaNavigation.qaMenuId,
                    onQuery: (query: string) => this.modules.qaQuery = query,
                    onSession: (id: string) => this.onSession(id),
                    onMenu: (id: string) => this.qaNavigation.qaMenuId = id,
                    onStartRename: (session: RagSessionSummary) => {
                      this.qaNavigation.qaRenameId = session.id;
                      this.qaNavigation.qaRenameTitle = session.title;
                    },
                    onRenameTitle: (title: string) => this.qaNavigation.qaRenameTitle = title,
                    onCommitRename: () => this.qaNavigation.commitQaRename(),
                    onCancelRename: () => this.qaNavigation.qaRenameId = '',
                    onDelete: (session: RagSessionSummary) => this.onDelete(session),
                    onRetry: () => this.qaNavigation.loadQaNavigation() })
    } else if ((this.selectedModule === 1)) {
      NotesNavigation({ filtersOnly: this.popover, noteYearFilter: this.modules.noteYearFilter, noteTagFilter: this.modules.noteTagFilter,
                    noteCount: this.modules.noteCount, noteYears: this.modules.noteYears, noteTags: this.modules.noteTags,
                    noteEditorBusy: this.modules.notesBusy,
                    onNew: () => { this.modules.noteNewRevision++; this.railPopover = ''; },
                    onYear: (year: string) => { this.modules.noteYearFilter = year; this.railPopover = ''; },
                    onTag: (tag: string) => { this.modules.noteTagFilter = tag; this.railPopover = ''; } })
    } else if ((this.selectedModule === 2)) {
      FavoritesNavigation({ data: this.favoritesData, wide: true,
                    onRetry: () => this.favoritesData.load() })
    } else if ((this.selectedModule === 4)) {
      StatsNavigation({ monthsOnly: false, onTaxonomy: () => this.onTaxonomy(), statsMonths: this.modules.statsMonths,
                    statsMonth: this.modules.statsMonth, statsMonthsLoading: this.modules.statsMonthsLoading,
                    statsMonthsError: this.modules.statsMonthsError,
                    onMonth: (month: string) => {
                      this.modules.statsMonth = month;
                      this.modules.statsMonthRevision++; this.railPopover = '';
                    },
                    onRetry: () => this.modules.statsRefreshRevision++ })
    } else { this.logContent() }
  }

  @Builder
  private compactContent() {
    if ((this.selectedModule === 1)) {
      NotesNavigation({ noteYearFilter: this.modules.noteYearFilter, noteTagFilter: this.modules.noteTagFilter,
        noteCount: this.modules.noteCount, noteYears: this.modules.noteYears, noteTags: this.modules.noteTags,
        noteEditorBusy: this.modules.notesBusy,
        onNew: () => { this.modules.noteNewRevision++; this.onCloseNavigation(); },
        onYear: (year: string) => { this.modules.noteYearFilter = year; this.onCloseNavigation(); },
        onTag: (tag: string) => { this.modules.noteTagFilter = tag; this.onCloseNavigation(); } })
    } else if ((this.selectedModule === 2)) {
      FavoritesNavigation({ data: this.favoritesData, wide: false,
        onRetry: () => this.favoritesData.load() })
    } else if ((this.selectedModule === 3)) {
      QaNavigation({ qaSessions: this.qaNavigation.qaSessions, qaSessionQuery: this.modules.qaQuery,
        qaSearchRevision: this.modules.qaSearchRevision,
        qaActiveSessionId: this.modules.qaSessionId, qaBusy: this.modules.qaBusy,
        qaNavigationLoading: this.qaNavigation.qaNavigationLoading,
        qaNavigationError: this.qaNavigation.qaNavigationError,
        qaRenameId: this.qaNavigation.qaRenameId, qaRenameTitle: this.qaNavigation.qaRenameTitle,
        qaMenuId: this.qaNavigation.qaMenuId,
        onQuery: (query: string) => this.modules.qaQuery = query,
        onSession: (id: string) => this.onSession(id),
        onMenu: (id: string) => this.qaNavigation.qaMenuId = id,
        onStartRename: (session: RagSessionSummary) => {
          this.qaNavigation.qaRenameId = session.id;
          this.qaNavigation.qaRenameTitle = session.title;
        },
        onRenameTitle: (title: string) => this.qaNavigation.qaRenameTitle = title,
        onCommitRename: () => this.qaNavigation.commitQaRename(),
        onCancelRename: () => this.qaNavigation.qaRenameId = '',
        onDelete: (session: RagSessionSummary) => this.onDelete(session),
        onRetry: () => this.qaNavigation.loadQaNavigation() })
    } else if ((this.selectedModule === 4)) {
      StatsNavigation({ monthsOnly: false, onTaxonomy: () => this.onTaxonomy(), statsMonths: this.modules.statsMonths, statsMonth: this.modules.statsMonth,
        statsMonthsLoading: this.modules.statsMonthsLoading, statsMonthsError: this.modules.statsMonthsError,
        onMonth: (month: string) => {
          this.modules.statsMonth = month; this.modules.statsMonthRevision++; this.onCloseNavigation();
        }, onRetry: () => this.modules.statsRefreshRevision++ })
    } else this.logContent()
  }

  build() {
    if (this.wide) this.desktopContent()
    else this.compactContent()
  }
}
