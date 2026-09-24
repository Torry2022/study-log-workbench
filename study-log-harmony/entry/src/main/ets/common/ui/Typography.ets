import { WorkspaceBreakpoint } from '../AppConfig';

export function usesWideTypography(breakpoint: WorkspaceBreakpoint): boolean {
  return breakpoint !== WorkspaceBreakpoint.COMPACT;
}

export function workspaceSansFamily(_breakpoint: WorkspaceBreakpoint): string {
  return 'HarmonyOS Sans SC';
}

export function workspaceSerifFamily(_breakpoint: WorkspaceBreakpoint): string {
  return 'StudyLogDesktopSerif';
}

export function workspaceLatinSerifFamily(_breakpoint: WorkspaceBreakpoint): string {
  return 'StudyLogDesktopLatinSerif';
}

export function workspaceDateFamily(_breakpoint: WorkspaceBreakpoint): string {
  return 'StudyLogDesktopLatinSerif';
}

export function workspaceCodeFamily(_breakpoint: WorkspaceBreakpoint): string {
  return 'StudyLogMono';
}

export function workspacePaperMonoFamily(_breakpoint: WorkspaceBreakpoint): string {
  return 'StudyLogPaperMono';
}
