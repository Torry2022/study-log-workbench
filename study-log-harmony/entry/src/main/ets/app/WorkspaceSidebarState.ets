@Observed
export class WorkspaceSidebarState {
  navigationOpen: boolean = false;
  navigationClosing: boolean = false;
  navigationOffset: number = -340;
  navigationScrimOpacity: number = 0;
  navigationMotionRevision: number = 0;
  collapsedModules: boolean[] = [false, false, false, false, false];
  sidebarExpansion: number = 1;
  sidebarAnimating: boolean = false;
  sidebarMotionRevision: number = 0;
}
