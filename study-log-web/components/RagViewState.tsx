import { Inbox, LoaderCircle, type LucideIcon } from "lucide-react";

export function RagViewState({ kind, title, description, layout = "panel", icon, className = "" }: {
  kind: "loading" | "empty"; title: string; description?: string;
  layout?: "panel" | "compact"; icon?: LucideIcon; className?: string;
}) {
  const Icon = icon ?? (kind === "loading" ? LoaderCircle : Inbox);
  return <div className={`workspace-state workspace-state-${kind} workspace-state-${layout} ${className}`} role="status" aria-live="polite">
    <div className="workspace-state-body">
      <span className="workspace-state-icon" aria-hidden="true"><Icon strokeWidth={1.8} /></span>
      <strong className="workspace-state-title">{title}</strong>
      {description && <span className="workspace-state-description">{description}</span>}
    </div>
  </div>;
}
