"use client";

import "@/app/rag-workspace.css";

import { BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Copy, FileText, LoaderCircle, MessageSquareText, RotateCcw, Send, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { WorkspaceState } from "@/components/WorkspaceState";
import type { RagAnswerMode, RagChatMessage, RagCitation } from "@/lib/rag-types";
import { stripRagCitationLabels } from "@/lib/rag-answer";
import type { RagAnswerMessage } from "@/lib/rag-answer-versions";
import { useSmoothRagAnswer } from "@/hooks/use-smooth-rag-answer";
import { captureRagReadingAnchor, ragDocumentWillScroll, restoreRagReadingAnchor, type RagReadingAnchor } from "@/lib/rag-reading-anchor";

const RagAnswerBody = memo(function RagAnswerBody({ message, content, enabled, themeMode, onCitation }: {
  message: RagAnswerMessage; content: string; enabled: boolean; themeMode: "light" | "dark";
  onCitation: (messageId: string, citation: RagCitation, open?: boolean) => void;
}) {
  const sourceIds = useMemo(() => (message.citations || []).map(citation => citation.sourceId), [message.citations]);
  const openSource = useCallback((sourceId: string) => {
    const citation = message.citations?.find(item => item.sourceId === sourceId);
    if (citation) onCitation(message.id, citation, true);
  }, [message.id, message.citations, onCitation]);
  return <MarkdownPreview content={content} active={enabled} themeMode={themeMode} citationSourceIds={sourceIds} onCitationLink={openSource} />;
});

interface RagWorkspaceProps {
  availability?: ReactNode;
  feedback?: ReactNode;
  noLogs?: boolean;
  onOpenLog?: () => void;
  active: boolean;
  visible: boolean;
  disabled?: boolean;
  messages: RagAnswerMessage[];
  viewingPreviousAnswer?: boolean;
  answerActionBusy?: boolean;
  onAnswerVersion: (questionId: string, answerId: string) => void;
  onSaveAnswer: (taskId: string) => void;
  onDiscardAnswer: (taskId: string) => void;
  initializing: boolean;
  question: string;
  stage: string;
  generating: boolean;
  themeMode: "light" | "dark";
  answerMode: RagAnswerMode;
  focusRequestToken: number;
  sessionNavigationToken: number;
  answerStartToken: number;
  onQuestionChange: (value: string) => void;
  onAnswerModeChange: (mode: RagAnswerMode) => void;
  onSubmit: () => void;
  onStop: () => void;
  onRegenerate: (answerId: string) => void;
  onCitation: (citation: RagCitation) => void;
}

export function RagWorkspace({
  availability,
  feedback,
  noLogs = false,
  active,
  onOpenLog,
  visible,
  disabled = false,
  messages,
  viewingPreviousAnswer = false,
  answerActionBusy = false,
  onAnswerVersion,
  onSaveAnswer,
  onDiscardAnswer,
  initializing,
  question,
  stage,
  generating,
  themeMode,
  answerMode,
  focusRequestToken,
  sessionNavigationToken,
  answerStartToken,
  onQuestionChange,
  onAnswerModeChange,
  onSubmit,
  onStop,
  onRegenerate,
  onCitation
}: RagWorkspaceProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const followOutputRef = useRef(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const readingAnchorRef = useRef<RagReadingAnchor | null>(null);
  const scrollYRef = useRef(0);
  const wasAnswerStartTokenRef = useRef(answerStartToken);
  const wasPresentingRef = useRef(generating);
  const lastNavigationToken = useRef<number | null>(null);
  const lastFocusToken = useRef(0);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [composerHidden, setComposerHidden] = useState(false);
  const [expandedCitationKey, setExpandedCitationKey] = useState<string | null>(null);
  const enabled = active && visible;
  const output = messages.at(-1);
  const presented = useSmoothRagAnswer(output, generating, sessionNavigationToken, answerStartToken, enabled);
  const presenting = generating || presented.pending;
  const hasMessages = messages.length > 0;

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

  useLayoutEffect(() => {
    if (enabled && lastNavigationToken.current === sessionNavigationToken) return;
    wasPresentingRef.current = presenting;
    wasAnswerStartTokenRef.current = answerStartToken;
    followOutputRef.current = false;
    if (!enabled) return;
    lastNavigationToken.current = sessionNavigationToken;
    setComposerHidden(false);
    setExpandedCitationKey(null);
    window.scrollTo({ top: 0, behavior: "auto" });
    scrollYRef.current = window.scrollY;
  }, [enabled, sessionNavigationToken]);

  useLayoutEffect(() => { readingAnchorRef.current = null; }, [enabled, sessionNavigationToken, answerStartToken, output?.id]);

  const followLatest = useCallback(() => {
    if (!enabled || !workspaceRef.current?.getClientRects().length) return;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    scrollYRef.current = window.scrollY;
  }, [enabled]);

  useLayoutEffect(() => {
    if (!enabled) {
      wasAnswerStartTokenRef.current = answerStartToken;
      wasPresentingRef.current = presenting;
      followOutputRef.current = false;
      return;
    }
    const startedHere = wasAnswerStartTokenRef.current !== answerStartToken;
    const wasPresenting = wasPresentingRef.current;
    wasAnswerStartTokenRef.current = answerStartToken;
    wasPresentingRef.current = presenting;
    if (startedHere) followOutputRef.current = true;
    // Render new output and its completion at the bottom while this answer owns it.
    // Saved-session/title snapshots and ordinary parent renders never reclaim ownership.
    if ((presenting || wasPresenting) && followOutputRef.current) {
      followLatest();
    }
  }, [enabled, output?.id, presented.content, output?.status, generating, presenting, answerStartToken, followLatest]);

  const restoreReading = useCallback(() => {
    const root = workspaceRef.current, anchor = readingAnchorRef.current;
    if (!enabled || !root || !anchor || followOutputRef.current) return;
    const before = window.scrollY, anchoredY = anchor.y;
    if (!restoreRagReadingAnchor(root, anchor)) readingAnchorRef.current = null;
    // Layout corrections are not user input and cannot resume following or hide the composer.
    else if (before !== window.scrollY || anchoredY !== before) scrollYRef.current = window.scrollY;
  }, [enabled]);
  useLayoutEffect(() => { restoreReading(); });
  useEffect(() => {
    const root = workspaceRef.current;
    if (!enabled || !root) return;
    const observer = new ResizeObserver(() => {
      if (!root.getClientRects().length) { followOutputRef.current = false; readingAnchorRef.current = null; return; }
      if (followOutputRef.current) followLatest();
      else restoreReading();
    });
    observer.observe(root);
    const content = root.querySelector(".rag-message-list");
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [enabled, sessionNavigationToken, hasMessages, restoreReading, followLatest]);

  useEffect(() => {
    if (!enabled) return;
    scrollYRef.current = window.scrollY;
    let travel = 0;
    let direction = 0;
    let touchY = 0;
    const startManualScroll = (target: EventTarget | null, delta: number) => {
      if (!ragDocumentWillScroll(target, delta)) return;
      // Keep the current anchor until an actual scroll replaces it.
      if (delta < 0 || !presenting) followOutputRef.current = false;
    };
    const handleWheel = (event: WheelEvent) => { startManualScroll(event.target, event.deltaY); };
    const handleTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY || 0; };
    const handleTouchMove = (event: TouchEvent) => {
      const next = event.touches[0]?.clientY || touchY;
      startManualScroll(event.target, touchY - next);
      touchY = next;
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest("input,textarea,select"))) return;
      if (event.key === " " && event.target instanceof Element && event.target.closest("button,a")) return;
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || event.key === " " && event.shiftKey) startManualScroll(event.target, -1);
      else if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) startManualScroll(event.target, 1);
    };

    function handleScroll() {
      const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;

      const currentScrollY = window.scrollY;
      const delta = currentScrollY - scrollYRef.current;
      const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const clamped = scrollYRef.current > maximum + 1 && Math.abs(currentScrollY - maximum) <= 1;
      scrollYRef.current = currentScrollY;
      // A shorter document can clamp the viewport upward without user input.
      if (delta < -1 && !clamped) followOutputRef.current = false;
      else if (presenting && delta > 0 && remaining <= 2) followOutputRef.current = true;
      if (followOutputRef.current) readingAnchorRef.current = null;
      else if (Math.abs(delta) >= 1 && workspaceRef.current) {
        readingAnchorRef.current = captureRagReadingAnchor(workspaceRef.current);
      }

      // Focusing a sticky composer can itself scroll the page in WebKit. Do not
      // hide and blur the field while the user is trying to enter a follow-up.
      if (remaining < 160 || Boolean(question.trim()) || generating || document.activeElement === textareaRef.current) {
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
      travel = 0;
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("scroll", handleScroll); window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart); window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("keydown", handleKey);
    };
  }, [enabled, generating, presenting, question]);

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

  const toggleCitation = useCallback((messageId: string, citation: RagCitation, open = false) => {
    const key = `${messageId}:${citation.sourceId}`;
    setExpandedCitationKey((current) => (current === key && !open ? null : key));
    if (open) {
      window.requestAnimationFrame(() => {
        document.getElementById(`rag-source-${key}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }, []);

  // Bottom ownership survives completion until the reader acts on the conversation.
  const releaseFollowing = () => { followOutputRef.current = false; };

  return (<>
    {enabled && <div className="reader-toolbar-container"><div className="reader-toolbar reader-toolbar-qa">
      <div className="module-title-block"><div className="reader-heading-row"><h2>知识问答</h2></div></div>
      <div className="reader-controls">{onOpenLog && <button className="button secondary" type="button" onClick={onOpenLog}><FileText size={15} />日志</button>}</div>
    </div></div>}
    <div onPointerDownCapture={releaseFollowing} onKeyDownCapture={releaseFollowing} ref={workspaceRef} className={`rag-workspace${messages.length > 0 ? " has-messages" : ""}`} hidden={!enabled}>
      <div className="rag-conversation" aria-live="polite">
        {feedback}
        {initializing && messages.length === 0 ? (
          <WorkspaceState kind="loading" title="正在加载历史问答" className="rag-empty" />
        ) : messages.length === 0 ? (
          <WorkspaceState
            kind="empty"
            icon={MessageSquareText}
            title={noLogs ? "从第一篇日志开始，积累可提问的经历" : "从一个问题，找回自己的学习经历"}
            description={noLogs ? "保存学习日志后，让 AI 帮你回顾内容、串起相关主题，回答中的来源可以带你回到原文。" : "让 AI 帮你回顾、关联与理解已有记录，沿着回答中的来源继续阅读。选一个问题，修改后再发送。"}
            layout="module"
            className="rag-empty workspace-onboarding"
            actions={noLogs ? onOpenLog && <button className="button primary" type="button" onClick={onOpenLog}>前往日志</button> : !question.trim() && <div className="onboarding-questions" role="group" aria-label="示例问题">
              {[
                { label: "回顾收获", question: "帮我回顾最近记录的主要内容。" },
                { label: "串起主题", question: "哪些记录讨论了同一个主题？" },
                { label: "接着探索", question: "我记录过哪些尚未解决的问题？" }
              ].map(example => <button className="button secondary rag-example-question" type="button" key={example.question} disabled={generating} onClick={() => { onQuestionChange(example.question); textareaRef.current?.focus(); }}><strong>{example.label}</strong><span>{example.question}</span></button>)}
            </div>}
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
                        <RagAnswerBody message={message} content={index === messages.length - 1 ? presented.content : message.content}
                          enabled={enabled} themeMode={themeMode} onCitation={toggleCitation} />
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
                        {(message.canRetry ?? index === messages.length - 1) && (
                          <button type="button" onClick={() => onRegenerate(message.id)} disabled={generating || disabled || !!question.trim() || message.canRetry === false}>
                            <RotateCcw size={13} />
                            重试
                          </button>
                        )}
                      </div>
                    )}
                    {message.status === "stopped" && (
                      <div className="rag-message-state note" role="status">
                        <span>生成已停止</span>
                        {(message.canRetry ?? index === messages.length - 1) && (
                          <button type="button" onClick={() => onRegenerate(message.id)} disabled={generating || disabled || !!question.trim() || message.canRetry === false}>
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
                                <em>{citation.heading || "日志原文"}</em>
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
                    {message.saveError && <div className="rag-message-state error" role="alert">{message.saveError}</div>}
                    {message.saving && <div className="rag-message-state note" role="status">正在保存问答历史…</div>}
                    {(message.content && message.status !== "streaming" || (message.versions?.length || 0) > 1) && (
                      <div className="rag-answer-actions">
                        {(message.versions?.length || 0) > 1 && <div className="rag-answer-versions" aria-label="回答版本">
                          <button type="button" aria-label="上一个回答版本" disabled={!message.versionIndex} onClick={() => { followOutputRef.current = false; onAnswerVersion(message.questionId!, message.versions![message.versionIndex! - 1]); }}><ChevronLeft size={14} /></button>
                          <span>{message.versionIndex! + 1} / {message.versions!.length}</span>
                          <button type="button" aria-label="下一个回答版本" disabled={message.versionIndex === message.versions!.length - 1} onClick={() => { followOutputRef.current = false; onAnswerVersion(message.questionId!, message.versions![message.versionIndex! + 1]); }}><ChevronRight size={14} /></button>
                        </div>}
                        {message.content && <>
                        <button type="button" onClick={() => void copyAnswer(message)}>
                          {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
                          {copiedMessageId === message.id ? "已复制" : "复制"}
                        </button>
                        {(message.canRegenerate ?? index === messages.length - 1) && (
                          <button type="button" onClick={() => onRegenerate(message.id)} disabled={generating || disabled || !!question.trim()}>
                            <RotateCcw size={14} />
                            重新生成
                          </button>
                        )}
                        </>}
                        {message.canSave && <button type="button" disabled={answerActionBusy} onClick={() => onSaveAnswer(message.taskId!)}>重试保存</button>}
                        {message.canDiscard && <button type="button" disabled={answerActionBusy} onClick={() => onDiscardAnswer(message.taskId!)}>放弃此结果</button>}
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
      </div>

      <div className={`rag-composer-slot${composerHidden ? " is-hidden" : ""}`}>
      <form className={`rag-composer${composerHidden ? " is-hidden" : ""}`} onSubmit={submit} ref={composerRef}>
        {availability}
        <textarea
          ref={textareaRef}
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={viewingPreviousAnswer ? "继续提问将依据当前所选回答" : "询问学习日志中的内容"}
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
    </div>
  </>);
}
