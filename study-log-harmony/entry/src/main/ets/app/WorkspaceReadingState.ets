@Observed
export class WorkspaceReadingState {
  logsReadingMode: boolean = false;
  readingProgress: number = 0;
  readingCoverX: number = 0;
  readingCoverY: number = 0;
  readingCoverWidth: number = 0;
  readingCoverHeight: number = 0;
  readingImageInset: number = 0;
  readingImageWidth: number = 0;
  readingImageHeight: number = 0;
  workspaceOriginX: number = 0;
  workspaceOriginY: number = 0;
  readingViewportX: number = 0;
  readingViewportY: number = 0;
  readingViewportWidth: number = 0;
  readingViewportHeight: number = 0;
  workspaceLayoutRevision: number = 0;
}
