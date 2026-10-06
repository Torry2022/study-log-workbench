import type { ReactNode } from "react";
import { CircleAlert, Inbox, LoaderCircle, type LucideIcon } from "lucide-react";

type WorkspaceStateKind = "loading" | "empty" | "error";
type WorkspaceStateLayout = "fullscreen" | "panel" | "compact" | "module";

type WorkspaceStateProps = {
  kind: WorkspaceStateKind;
  title: string;
  description?: string;
  layout?: WorkspaceStateLayout;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
};

export function WorkspaceState({
  kind,
  title,
  description,
  layout = "panel",
  icon,
  actions,
  className = ""
}: WorkspaceStateProps) {
  const Icon = icon ?? (kind === "loading" ? LoaderCircle : kind === "error" ? CircleAlert : Inbox);
  const classes = ["workspace-state", `workspace-state-${kind}`, `workspace-state-${layout}`, className]
    .filter(Boolean)
    .join(" ");

  const heading = <>
        <span className="workspace-state-icon" aria-hidden="true">
          <Icon strokeWidth={1.8} />
        </span>
        <strong className="workspace-state-title">{title}</strong>
  </>;

  return (
    <div className={classes} role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"}>
      <div className="workspace-state-body">
        {layout === "compact" ? <div className="workspace-state-heading">{heading}</div> : heading}
        {description && <span className="workspace-state-description">{description}</span>}
        {actions && <div className="workspace-state-actions">{actions}</div>}
      </div>
    </div>
  );
}
