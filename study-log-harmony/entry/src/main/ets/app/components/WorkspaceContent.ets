import { WorkspaceModuleState } from '../WorkspaceModuleState';
import { activeInstance } from '../../common/network/InstanceConfig';
import { QaPage } from '../../features/qa/QaPage';
import { QaNavigationController } from '../../features/qa/QaNavigationController';
import { RagSessionSummary } from '../../features/qa/QaModels';
import { NotesPage } from '../../features/notes/NotesPage';
import { StudyNoteFacet } from '../../features/notes/NoteModels';
import { FavoritesPage } from '../../features/favorites/FavoritesPage';
import { FavoritesController } from '../../features/favorites/FavoritesController';
import { FavoriteHeading } from '../../features/favorites/FavoriteModels';
import { StatsPage } from '../../features/stats/StatsPage';
import { StatsEntry } from '../../features/stats/StatsModels';
import { TaxonomyManagerPage } from '../../features/stats/TaxonomyManagerPage';
import { MonthSummary } from '../../features/logs/LogModels';
import { LoadingHintPlacement } from '../../common/ui/LoadingHintAnchor';
import { secondaryPageTransition } from '../../common/ui/WorkspaceMotion';
import { workspacePreferences } from '../../common/storage/WorkspacePreferences';
import { appFeedback } from '../../common/ui/AppFeedback';

// Five module slots remain mounted, following the original Index.workspaceContent.
@Component
export struct WorkspaceContent {
  @ObjectLink modules: WorkspaceModuleState;
  @ObjectLink qaNavigation: QaNavigationController;
  @ObjectLink favoritesData: FavoritesController;
  @Prop selectedModule: number = 0;
  @Prop outgoingTab: number = -1;
  @Prop moduleReveal: number = 1;
  @Prop wide: boolean = false;
  @Prop themePreference: string = 'system';
  @StorageProp('pref_favoritesView') private favoritesViewMode: string = 'list';
  @BuilderParam logContent: () => void;
  onSelect: (index: number) => void = () => {};
  onCitation: (date: string, heading: string, index: number) => void = () => {};
  onNoteLink: (date: string, heading: string) => void = () => {};
  onFavorite: (favorite: FavoriteHeading) => void = () => {};
  onStatsEntry: (entry: StatsEntry) => void = () => {};
  onOpenTaxonomy: () => void = () => {};
  onCloseTaxonomy: () => void = () => {};

  build() {
    Stack() {
      Row() {
          QaPage({ workspaceActive: (this.selectedModule === 3), navigationSessionId: this.modules.qaSessionId,
            themePreference: this.themePreference,
            navigationRequestRevision: this.modules.qaRequestRevision, discardRevision: this.modules.qaDiscardRevision,
            questionFocusRevision: this.modules.qaQuestionFocusRevision, topRevision: this.modules.topRequests[3],
            configured: !!activeInstance.capabilities?.features.rag.configured,
            onSessionsChange: (sessions: RagSessionSummary[]) => this.qaNavigation.acceptQaNavigation(sessions),
            onSessionsError: (message: string) => this.qaNavigation.qaNavigationError = message,
            onActiveSessionChange: (id: string) => this.modules.qaSessionId = id,
            onBusyChange: (busy: boolean) => this.modules.qaBusy = busy,
            onDraftChange: (dirty: boolean) => this.modules.qaDirty = dirty,
            onPendingChange: (pending: boolean) => this.modules.qaPending = pending,
            onScrollStateChange: (scrolled: boolean) => this.modules.qaScrolled = scrolled,
            onLoadingHintChange: (placement: LoadingHintPlacement) => this.modules.qaLoadingHint = placement,
            onOpenLog: () => this.onSelect(0),
            onCitation: (date: string, heading: string, headingIndex: number) =>
              this.onCitation(date, heading, headingIndex) }).layoutWeight(1)
      }.width('100%').height('100%')
        .visibility((this.selectedModule === 3) || this.outgoingTab === 3 ? Visibility.Visible : Visibility.None)
        .opacity((this.selectedModule === 3) ? this.moduleReveal : 1)
        .hitTestBehavior((this.selectedModule === 3) ? HitTestMode.Default : HitTestMode.None)
        .zIndex((this.selectedModule === 3) ? 1 : 0)
      Row() {
          NotesPage({ workspaceActive: (this.selectedModule === 1),
            navigationYear: this.modules.noteYearFilter, navigationTag: this.modules.noteTagFilter,
            navigationNewRevision: this.modules.noteNewRevision, discardRevision: this.modules.noteDiscardRevision,
            saveRevision: this.modules.noteSaveRevision, topRevision: this.modules.topRequests[1],
            onNavigationDataChange: (years: StudyNoteFacet[], tags: StudyNoteFacet[], total: number) => {
              this.modules.noteYears = years; this.modules.noteTags = tags; this.modules.noteCount = total;
            },
            onEditorBusyChange: (busy: boolean) => this.modules.notesBusy = busy,
            onDirtyChange: (dirty: boolean) => this.modules.notesDirty = dirty,
            onScrollStateChange: (scrolled: boolean) => this.modules.notesScrolled = scrolled,
            onLoadingHintChange: (placement: LoadingHintPlacement) => this.modules.notesLoadingHint = placement,
            onOpenLog: () => this.onSelect(0),
            onInternalLink: (date: string, heading: string) => this.onNoteLink(date, heading) }).layoutWeight(1)
      }.width('100%').height('100%')
        .visibility((this.selectedModule === 1) || this.outgoingTab === 1 ? Visibility.Visible : Visibility.None)
        .opacity((this.selectedModule === 1) ? this.moduleReveal : 1)
        .hitTestBehavior((this.selectedModule === 1) ? HitTestMode.Default : HitTestMode.None)
        .zIndex((this.selectedModule === 1) ? 1 : 0)
      Row() {
          FavoritesPage({ data: this.favoritesData, viewMode: this.favoritesViewMode,
            onScrollStateChange: (scrolled: boolean) => this.modules.favoritesScrolled = scrolled,
            topRevision: this.modules.topRequests[2],
            onLoadingHintChange: (placement: LoadingHintPlacement) => this.modules.favoritesLoadingHint = placement,
            onViewModeChange: (mode: string) => {
              workspacePreferences.set('favoritesView', mode)
                .catch(() => appFeedback.show('收藏显示方式保存失败', 'error'));
            },
            onOpenLog: () => this.onSelect(0),
            onOpenFavorite: (favorite: FavoriteHeading) => this.onFavorite(favorite) }).layoutWeight(1)
      }.width('100%').height('100%')
        .visibility((this.selectedModule === 2) || this.outgoingTab === 2 ? Visibility.Visible : Visibility.None)
        .opacity((this.selectedModule === 2) ? this.moduleReveal : 1)
        .hitTestBehavior((this.selectedModule === 2) ? HitTestMode.Default : HitTestMode.None)
        .zIndex((this.selectedModule === 2) ? 1 : 0)
      Row() {
          Stack() {
            StatsPage({ showTaxonomyManager: true, onOpenTaxonomyManager: () => this.onOpenTaxonomy(),
              onScrollStateChange: (scrolled: boolean) => this.modules.statsScrolled = scrolled,
              topRevision: this.modules.topRequests[4],
              requestedMonth: this.modules.statsMonth, requestedMonthRevision: this.modules.statsMonthRevision,
              refreshRevision: this.modules.statsRefreshRevision,
              onLoadingHintChange: (placement: LoadingHintPlacement) => this.modules.statsLoadingHint = placement,
              onMonthsChange: (months: MonthSummary[]) => this.modules.statsMonths = months,
              onMonthsLoadingChange: (loading: boolean) => this.modules.statsMonthsLoading = loading,
              onMonthsErrorChange: (error: string) => this.modules.statsMonthsError = error,
              onSelectedMonthChange: (month: string) => this.modules.statsMonth = month,
              onOpenLog: () => this.onSelect(0),
              onOpenEntry: (entry: StatsEntry) => this.onStatsEntry(entry) })
              .width('100%').height('100%')
            if (this.wide && this.modules.taxonomyOpen) {
              WorkspaceTaxonomyPage({ modules: this.modules, onBack: () => this.onCloseTaxonomy() }).width('100%').height('100%').transition(secondaryPageTransition())
            }
          }.layoutWeight(1).height('100%')
      }.width('100%').height('100%')
        .visibility((this.selectedModule === 4) || this.outgoingTab === 4 ? Visibility.Visible : Visibility.None)
        .opacity((this.selectedModule === 4) ? this.moduleReveal : 1)
        .hitTestBehavior((this.selectedModule === 4) ? HitTestMode.Default : HitTestMode.None)
        .zIndex((this.selectedModule === 4) ? 1 : 0)
      this.logContent()
    }.layoutWeight(1).height('100%')
  }
}

@Component
export struct WorkspaceTaxonomyPage {
  @ObjectLink modules: WorkspaceModuleState;
  onBack: () => void = () => {};

  build() {
    TaxonomyManagerPage({ onBack: () => this.onBack(),
      onStateChange: (dirty: boolean, busy: boolean) => {
        this.modules.taxonomyDirty = dirty; this.modules.taxonomyBusy = busy;
      },
      onSaved: () => this.modules.statsRefreshRevision++
    }).width('100%').height('100%')
  }
}
