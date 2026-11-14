declare global {
  interface Window { studyLogDesktop?: {
    close: () => void;
    context: () => Promise<{ mode: "local" | "remote"; root: string; appVersion?: string }>;
    configuration: () => Promise<DesktopAiConfiguration>;
    configure: (value: DesktopAiUpdate) => Promise<DesktopAiConfiguration>;
    probe: (value: { action: "models" | "test"; apiUrl: string; model: string; apiKey: string; expectedRevision: number; expectedInstanceId: string }) => Promise<{ models?: string[]; ok?: boolean; cancelled?: boolean }>;
    deploymentPreview: () => Promise<DesktopAiConfiguration & { previewId: string }>;
    deploymentRestore: (value: { expectedInstanceId: string; expectedRevision: number; operationId: string; previewId: string }) => Promise<DesktopAiConfiguration>;
    settingsAction: (action: "connection" | "backup" | "restore" | "history" | "folder") => Promise<void>;
  } }
}

export type DesktopAiConfiguration = { instanceId: string; revision: number; operationId: string | null; provider: "deepseek" | "custom"; endpointDisplay: string; hasEndpoint: boolean; model: string; hasKey: boolean; lightModel: string; contextWindowTokens: string; thinking: string; toolCallingVerified: boolean; statusVerificationEnabled: boolean };
export type DesktopAiUpdate = { apiUrl: string; model: string; lightModel: string; contextWindowTokens?: string; thinking?: string; apiKey: string; clearKey: boolean; expectedRevision: number; expectedInstanceId: string; operationId: string };

export function closeDesktopWindow(): boolean {
  if (!window.studyLogDesktop) return false;
  window.studyLogDesktop.close();
  return true;
}
