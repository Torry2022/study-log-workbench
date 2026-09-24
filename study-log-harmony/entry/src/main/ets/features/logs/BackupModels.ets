import { DayEntry } from './LogModels';

export interface BackupVersion {
  id: string;
  kind: 'write';
  createdAt: string;
  sizeBytes: number;
  fileName: string;
}

export interface BackupOverview {
  write: BackupVersion[];
  nextCursor: string | null;
}

export interface BackupPreview {
  date: string;
  kind: 'write';
  id: string;
  fileName: string;
  historicalContent: string;
  currentContent: string;
  currentVersion: string | null;
  backupVersion: string;
}

export interface BackupOverviewResponse { backup: BackupOverview; }
export interface BackupPreviewResponse { preview: BackupPreview; }
export interface BackupRestoreResponse { day: DayEntry; }

export interface BackupRestoreRequest {
  date: string;
  kind: 'write';
  id: string;
  baseVersion: string | null;
  backupVersion: string;
}
