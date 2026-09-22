"use client";

import "@/app/rag-workspace.css";

import { BookOpen, Check, ChevronDown, CircleAlert, Copy, FileText, LoaderCircle, MessageSquareText, RotateCcw, Send, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { RagViewState as WorkspaceState } from "@/components/RagViewState";
import type { RagAnswerMode, RagChatMessage, RagCitation } from "@/lib/rag-types";
import { stripRagCitationLabels } from "@/lib/rag-answer";

interface RagWorkspaceProps {
  active: boolean;
  visible: boolean;
  disabled?: boolean;
  messages: RagChatMessage[];
  initializing: boolean;
  question: string;
  stage: string;
  generating: boolean;
  themeMode: "light" | "dark";
  answerMode: RagAnswerMode;
  focusRequestToken: number;
  sessionNavigationToken: number;
  onQuestionChange: (value: string) => void;
  onAnswerModeChange: (mode: RagAnswerMode) => void;
  onSubmit: () => void;
  onStop: () => void;
  onRegenerate: () => void;
  onCitation: (citation: RagCitation) => void;
}

export function RagWorkspace({
  active,
  visible,
  disabled = false,
  messages,
  initializing,
  question,
  stage,
  generating,
  themeMode,
  answerMode,
  focusRequestToken,
  sessionNavigationToken,
  onQuestionChange,
  onAnswerModeChange,
  onSubmit,
  onStop,
  onRegenerate,
  onCitation
}: RagWorkspaceProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const followOutputRef = useRef(true);
  const mountedRef = useRef(false);
  const previousMessageCountRef = useRef(messages.length);
  const lastNavigationToken = useRef<number | null>(null);
  const lastFocusToken = useRef(0);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [composerHidden, setComposerHidden] = useState(false);
  const [expandedCitationKey, setExpandedCitationKey] = useState<string | null>(null);
  const enabled = active && visible;

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [enabled, question]);

  useEffect(() => {
    if (enabled && focusRequestToken > lastFocusToken.current) {
      lastFocusToken.current = focusRequestToken;
      textareaRef.current?.focus();
    }
  }, [enabled, focusRequestToken]);

  useEffect(() => {
    if (question.trim() || generating) setComposerHidden(false);
  }, [generating, question]);

  useEffect(() => {
    if (enabled && lastNavigationToken.current === sessionNavigationToken) return;
    previousMessageCountRef.current = messages.length;
    followOutputRef.current = false;
    if (!enabled) return;
    lastNavigationToken.current = sessionNavigationToken;
    setComposerHidden(false);
    setExpandedCitationKey(null);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [enabled, sessionNavigationToken]);

  useEffect(() => {
    if (!enabled) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      previousMessageCountRef.current = messages.length;
      return;
    }

    const hasNewMessage = messages.length > previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;
    if (hasNewMessage) followOutputRef.current = true;
    if (!followOutputRef.current) return;

    const anchor = endRef.current;
    if (!anchor) return;
    anchor.style.scrollMarginBottom = `${(composerRef.current?.offsetHeight || 0) + 16}px`;
    anchor.scrollIntoView({ block: "end" });
  }, [enabled, messages, stage]);

  useEffect(() => {
    if (!enabled) return;
    let lastScrollY = window.scrollY;
    let travel = 0;
    let direction = 0;

    function handleScroll() {
      const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      followOutputRef.current = remaining < 220;

      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;
      lastScrollY = currentScrollY;

      if (remaining < 160 || Boolean(question.trim()) || generating) {
        travel = 0;
        setComposerHidden(false);
        return;
      }

      if (Math.abs(delta) < 2) return;
      const nextDirection = delta > 0 ? 1 : -1;
      if (nextDirection !== direction) {
        direction = nextDirection;
        travel = 0;
      }
      travel += Math.abs(delta);
      if (travel < 48) return;

      const shouldHide = nextDirection < 0;
      setComposerHidden(shouldHide);
      if (shouldHide && document.activeElement === textareaRef.current) {
        textareaRef.current?.blur();
      }
      travel = 0;
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [enabled, generating, question]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!enabled || disabled || !question.trim() || generating) return;
    followOutputRef.current = true;
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  async function copyAnswer(message: RagChatMessage) {
    const content = stripRagCitationLabels(message.content);

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(content);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    setCopiedMessageId(message.id);
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = setTimeout(() => setCopiedMessageId(null), 1600);
  }

  function toggleCitation(messageId: string, citation: RagCitation, open = false) {
    const key = `${messageId}:${citation.sourceId}`;
    setExpandedCitationKey((current) => (current === key && !open ? null : key));
    if (open) {
      window.requestAnimationFrame(() => {
        document.getElementById(`rag-source-${key}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }

  return (
    <div className={`rag-workspace${messages.length > 0 ? " has-messages" : ""}`} hidden={!enabled}>
      <div className="rag-conversation" aria-live="polite">
        {initializing && messages.length === 0 ? (
          <WorkspaceState kind="loading" title="正在加载历史问答" className="rag-empty" />
        ) : messages.length === 0 ? (
          <WorkspaceState
            kind="empty"
            icon={MessageSquareText}
            title="从学习日志中查找答案"
            description="回答将引用已有日块中的具体小节。"
            className="rag-empty"
          />
        ) : (
          <div className="rag-message-list">
            {messages.map((message, index) => (
              <article className={`rag-message rag-message-${message.role}`} key={message.id}>
                <div className="rag-message-label">{message.role === "user" ? "你" : "日志问答"}</div>
                {message.role === "assistant" ? (
                  <>
                    {message.content ? (
                      <div className="rag-answer">
                        <MarkdownPreview
                          content={message.content}
                          active={enabled}
                          themeMode={themeMode}
                          citationSourceIds={(message.citations || []).map((citation) => citation.sourceId)}
                          onCitationLink={(sourceId) => {
                            const citation = message.citations?.find((item) => item.sourceId === sourceId);
                            if (citation) toggleCitation(message.id, citation, true);
                          }}
                        />
                      </div>
                    ) : message.status === "streaming" ? (
                      <div className="rag-answer-pending" role="status">
                        <LoaderCircle size={15} aria-hidden="true" />
                        <span>{stage || "正在准备回答"}</span>
                      </div>
                    ) : null}
                    {message.status === "error" && (
                      <div className="rag-message-state error" role="alert">
                        <CircleAlert size={15} aria-hidden="true" />
                        <span>{message.error || "回答生成失败"}</span>
                        {index === messages.length - 1 && (
                          <button type="button" onClick={onRegenerate} disabled={generating || disabled}>
                            <RotateCcw size={13} />
                            重试
                          </button>
                        )}
                      </div>
                    )}
                    {message.status === "stopped" && (
                      <div className="rag-message-state note" role="status">
                        <span>生成已停止</span>
                        {index === messages.length - 1 && (
                          <button type="button" onClick={onRegenerate} disabled={generating || disabled}>
                            <RotateCcw size={13} />
                            重新生成
                          </button>
                        )}
                      </div>
                    )}
                    {message.groundingWarning && (
                      <div className="rag-grounding-warning">
                        <CircleAlert size={14} />
                        {message.groundingWarning}
                      </div>
                    )}
                    {message.citations && message.citations.length > 0 && (
                      <div className="rag-citations" aria-label="回答来源">
                        <div className="rag-citations-title">
                          <BookOpen size={14} />
                          来源
                        </div>
                        <div className="rag-citation-list">
                          {message.citations.map((citation) => (
                            <div
                              className={`rag-citation-entry${expandedCitationKey === `${message.id}:${citation.sourceId}` ? " expanded" : ""}`}
                              id={`rag-source-${message.id}:${citation.sourceId}`}
                              key={`${message.id}:${citation.sourceId}`}
                            >
                              <button className="rag-citation" type="button" onClick={() => toggleCitation(message.id, citation)}>
                                <span>{citation.sourceId}</span>
                                <strong>{citation.date}</strong>
                                <em>{citation.heading || "日块原文"}</em>
                                <ChevronDown size={14} />
                              </button>
                              {expandedCitationKey === `${message.id}:${citation.sourceId}` && (
                                <div className="rag-citation-detail">
                                  <p>{citation.excerpt || "该历史会话未保存来源片段，可前往来源页面查看。"}</p>
                                  <button type="button" onClick={() => onCitation(citation)}>
                                    <FileText size={14} />
                                    查看原日志
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {message.content && message.status !== "streaming" && (
                      <div className="rag-answer-actions">
                        <button type="button" onClick={() => void copyAnswer(message)}>
                          {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
                          {copiedMessageId === message.id ? "已复制" : "复制"}
                        </button>
                        {index === messages.length - 1 && (
                          <button type="button" onClick={onRegenerate} disabled={generating || disabled}>
                            <RotateCcw size={14} />
                            重新生成
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p>{message.content}</p>
                )}
              </article>
            ))}
          </div>
        )}
        <div className="rag-scroll-anchor" ref={endRef} />
      </div>

      <form className={`rag-composer${composerHidden ? " is-hidden" : ""}`} onSubmit={submit} ref={composerRef}>
        <textarea
          ref={textareaRef}
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="询问学习日志中的内容"
          aria-label="输入知识库问题"
          rows={1}
          disabled={generating}
          onFocus={() => setComposerHidden(false)}
        />
        <div className="rag-answer-mode" role="group" aria-label="回答知识范围">
          <button
            type="button"
            className={answerMode === "logs_only" ? "active" : ""}
            onClick={() => onAnswerModeChange("logs_only")}
            disabled={generating}
          >
            仅依据日志
          </button>
          <button
            type="button"
            className={answerMode === "logs_and_general" ? "active" : ""}
            onClick={() => onAnswerModeChange("logs_and_general")}
            disabled={generating}
          >
            日志 + 通用知识
          </button>
        </div>
        {generating ? (
          <button className="rag-send stop" type="button" onClick={onStop} title="停止生成" aria-label="停止生成">
            <Square size={15} fill="currentColor" />
          </button>
        ) : (
          <button className="rag-send" type="submit" disabled={disabled || !question.trim()} title="发送问题" aria-label="发送问题">
            <Send size={17} />
          </button>
        )}
      </form>
    </div>
  );
}
