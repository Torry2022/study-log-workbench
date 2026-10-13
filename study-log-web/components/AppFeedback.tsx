"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type FeedbackTone = "info" | "success" | "warning" | "error";

export type FeedbackMessage = {
  message: string;
  tone: FeedbackTone;
  action?: { label: string; onClick: () => void };
};

type AppFeedbackProps = {
  feedback: FeedbackMessage | null;
  onDismiss: () => void;
};

const ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert
};

export function AppFeedback({ feedback, onDismiss }: AppFeedbackProps) {
  const [rendered, setRendered] = useState<FeedbackMessage | null>(feedback);
  const [exiting, setExiting] = useState(false);
  const renderedRef = useRef<FeedbackMessage | null>(feedback);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (feedback) {
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = null;
      const current = renderedRef.current;
      if (current?.message !== feedback.message || current.tone !== feedback.tone || current.action?.label !== feedback.action?.label) {
        renderedRef.current = feedback;
        setRendered(feedback);
      }
      if (exiting) setExiting(false);
      return;
    }
    if (!renderedRef.current || exiting) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      renderedRef.current = null;
      setRendered(null);
      return;
    }
    setExiting(true);
    exitTimer.current = setTimeout(() => {
      renderedRef.current = null;
      setRendered(null);
      setExiting(false);
      exitTimer.current = null;
    }, 160);
  }, [exiting, feedback?.action?.label, feedback?.message, feedback?.tone]);
  useEffect(() => () => { if (exitTimer.current) clearTimeout(exitTimer.current); }, []);
  if (!rendered) return null;
  const { message, tone, action } = rendered;
  const Icon = ICONS[tone];
  const persistent = tone === "warning" || tone === "error";

  return (
    <div className={`toast ${tone}${exiting ? " exiting" : ""}`} role={persistent ? "alert" : "status"} aria-live={persistent ? "assertive" : "polite"}>
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
