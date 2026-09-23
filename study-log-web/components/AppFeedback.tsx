"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";

export type FeedbackTone = "info" | "success" | "warning" | "error";

export type FeedbackMessage = {
  message: string;
  tone: FeedbackTone;
};

type AppFeedbackProps = FeedbackMessage & {
  onDismiss: () => void;
  action?: { label: string; onClick: () => void };
};

const ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert
};

export function AppFeedback({ message, tone, onDismiss, action }: AppFeedbackProps) {
  const Icon = ICONS[tone];
  const persistent = tone === "warning" || tone === "error";

  return (
    <div className={`toast ${tone}`} role={persistent ? "alert" : "status"} aria-live={persistent ? "assertive" : "polite"}>
      <Icon size={16} aria-hidden="true" />
      <span>{message}</span>
      {action && <button className="toast-action" type="button" onClick={action.onClick}>{action.label}</button>}
      {persistent && (
        <button type="button" onClick={onDismiss} aria-label="关闭提示">
          <X size={15} />
        </button>
      )}
    </div>
  );
}
