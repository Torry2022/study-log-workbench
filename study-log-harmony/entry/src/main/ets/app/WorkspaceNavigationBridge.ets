import { RagSessionSummary } from '../features/qa/QaModels';

export interface WorkspaceNavigationView {
  hasLog: () => boolean;
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
  sidebarCollapsed: (collapsed: boolean, section: number) => void = () => {};
  editorCommand: (command: string) => void = () => {};
  focusRegion: (reverse: boolean) => void = () => {};
  dispose: () => void = () => {};
}
