import { StudyNoteFacet } from '../features/notes/NoteModels';
import { MonthSummary } from '../features/logs/LogModels';
import { LoadingHintPlacement } from '../common/ui/LoadingHintAnchor';

// Index owns module navigation and leave-guard state, as in the personal workspace.
// A shared observed record keeps the navigation and mounted module content on the same state.
@Observed
export class WorkspaceModuleState {
  taxonomyOpen: boolean = false;
  taxonomyDirty: boolean = false;
  taxonomyBusy: boolean = false;
  qaBusy: boolean = false;
  qaDirty: boolean = false;
  qaPending: boolean = false;
  qaSessionId: string = '';
  qaRequestRevision: number = 0;
  qaDiscardRevision: number = 0;
  qaQuestionFocusRevision: number = 0;
  qaQuery: string = '';
  qaSearchRevision: number = 0;
  qaScrolled: boolean = false;
  notesDirty: boolean = false;
  notesBusy: boolean = false;
  notesScrolled: boolean = false;
  favoritesScrolled: boolean = false;
  statsScrolled: boolean = false;
  noteYears: StudyNoteFacet[] = [];
  noteTags: StudyNoteFacet[] = [];
  noteCount: number = 0;
  noteYearFilter: string = 'all';
  noteTagFilter: string = 'all';
  noteNewRevision: number = 0;
  noteDiscardRevision: number = 0;
  noteSaveRevision: number = 0;
  statsMonths: MonthSummary[] = [];
  statsMonth: string = '';
  statsMonthsLoading: boolean = false;
  statsMonthsError: string = '';
  statsMonthRevision: number = 0;
  statsRefreshRevision: number = 0;
  qaLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  notesLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  favoritesLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  statsLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  topRequests: number[] = [0, 0, 0, 0, 0];
}
