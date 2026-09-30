@Observed
export class WorkspaceSidebarState {
  collapsedModules: boolean[] = [false, false, false, false, false];
  sidebarExpansion: number = 1;
  sidebarAnimating: boolean = false;
  sidebarMotionRevision: number = 0;
}
