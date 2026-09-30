import { LogSearchResult } from '../features/logs/LogSearchPanel';
import { DaySummary, LogSourceTarget } from '../features/logs/LogModels';
import { FavoriteHeading } from '../features/favorites/FavoriteModels';
import { StatsEntry } from '../features/stats/StatsModels';
import { RagSessionSummary } from '../features/qa/QaModels';

export interface WorkspaceNavigationView {
  selectLogMonth: (month: string) => void;
  selectLogDay: (date: string) => void;
  selectLogHeading: (day: DaySummary, heading: string, index: number) => void;
  selectLogDate: (date: string) => void;
  createLog: (date: string) => void;
  retryLogNavigation: () => void;
  closeLogMenu: () => void;
  workspaceAreaChanged: (area: Area) => void;

  openLogSource: (target: LogSourceTarget) => Promise<void>;
  currentLogDate: () => string;
  hasLog: () => boolean;
  isLogOutlineOpen: () => boolean;
  isReading: () => boolean;
  canRead: (active: boolean) => boolean;
  beforeReading: () => void;
  canMoveSidebar: () => boolean;
  beginSidebarMotion: (width: number) => number[][];
  advanceSidebarMotion: (widths: number[][], progress: number) => void;
  finishSidebarMotion: () => void;
  scrollSidebar: (section: number) => void;
  openLogDatePicker: (mode: string) => void;
  isDocumentReady: (date: string) => boolean;
  confirmLogLeave: (action: () => void) => void;
  leaveLog: () => void;
  closeNavigation: () => void;
  changed: (index: number) => void;
}

// The mounted log view registers its feature callbacks; Index owns module decisions and transitions.
export class WorkspaceNavigationCommands {
  openSearch: () => void = () => {};
  settings: () => void = () => {};
  about: () => void = () => {};
  help: () => void = () => {};
  theme: (value: string) => void = () => {};
  changeServer: () => void = () => {};
  refreshNavigation: () => Promise<void> = async () => {};
  searchResult: (result: LogSearchResult) => void = () => {};
  citation: (date: string, heading: string, index: number) => void = () => {};
  noteLink: (date: string, heading: string) => void = () => {};
  favorite: (favorite: FavoriteHeading) => void = () => {};
  statsEntry: (entry: StatsEntry) => void = () => {};
  request: (index: number, discardNotes: boolean, discardQa: boolean, afterSwitch: () => void,
    targetDate: string) => void = () => {};
  notesLeave: (action: () => void) => void = () => {};
  qaLeave: (action: () => void) => void = () => {};
  taxonomyLeave: (action: () => void) => void = () => {};
  openTaxonomy: () => void = () => {};
  qaSession: (id: string, focus: boolean) => void = () => {};
  qaDelete: (session: RagSessionSummary) => void = () => {};
  ready: (date: string) => void = () => {};
  failed: (date: string) => void = () => {};
  readingMode: (active: boolean) => Promise<void> = async () => {};
  readingViewport: (area: Area) => void = () => {};
  readingReady: () => void = () => {};
  readingOrigin: (area: Area) => void = () => {};
  navigation: (open: boolean) => void = () => {};
  sidebarCollapsed: (collapsed: boolean, section: number) => void = () => {};
  editorCommand: (command: string) => void = () => {};
  focusRegion: (reverse: boolean) => void = () => {};
  dispose: () => void = () => {};
}
