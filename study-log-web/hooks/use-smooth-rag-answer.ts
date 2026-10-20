"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RagChatMessage } from "@/lib/rag-types";

const DRAIN_MS = 250;
const COMMIT_MS = 50;
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
interface Reveal {
  key: string; navigation: number; intent: number; generating: boolean; eligible: boolean; text: string; target: string;
  ends: number[]; cursor: number; pending: { end: number; deadline: number }[]; lastFrame: number; lastCommit: number; frame: number;
}

function graphemeIndex(ends: number[], offset: number, roundUp = false) {
  let low = 0, high = ends.length;
  while (low < high) { const middle = (low + high) >>> 1; if (ends[middle] <= offset) low = middle + 1; else high = middle; }
  return roundUp && low < ends.length && ends[low - 1] !== offset ? low + 1 : low;
}

// Presentation only: one animation clock and 50ms-spaced Markdown commits
// (plus the final flush). Task state/copy/save always use the received text.
export function useSmoothRagAnswer(message: RagChatMessage | undefined, generating: boolean, navigation: number, intent: number, enabled: boolean) {
  const key = `${navigation}:${message?.id || ""}`, content = message?.content || "";
  const current = useRef<Reveal | null>(null);
  const [visible, setVisible] = useState({ key, text: content });
  const motionAllowed = () => Boolean(segmenter && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const cancel = (job: Reveal) => { cancelAnimationFrame(job.frame); job.frame = 0; };
  const flush = (job: Reveal) => {
    cancel(job); job.pending = []; job.ends = []; job.cursor = 0; job.text = job.target;
    if (!job.generating) job.eligible = false;
    setVisible({ key: job.key, text: job.text });
  };

  useLayoutEffect(() => {
    if (!enabled) { if (current.current) cancel(current.current); current.current = null; return; }
    let job = current.current;
    const startedHere = Boolean(job && job.intent !== intent && (generating || job.key !== key));
    if (!job || job.key !== key) {
      const carry = Boolean(job && job.navigation === navigation && job.eligible && generating && content.startsWith(job.text));
      const text = startedHere ? "" : carry ? job!.text : content;
      if (job) cancel(job);
      job = { key, navigation, intent, generating, eligible: startedHere || carry || generating, text, target: text,
        ends: [], cursor: 0, pending: [], lastFrame: 0, lastCommit: 0, frame: 0 };
      current.current = job; setVisible({ key, text });
    } else if (startedHere) {
      cancel(job); job.eligible = true; job.text = ""; job.target = ""; job.pending = [];
      setVisible({ key, text: "" });
    }
    job.intent = intent;
    job.generating = generating;
    if (!job.eligible || !motionAllowed() || message?.status === "stopped" || message?.status === "error" || !content.startsWith(job.text)) {
      job.target = content;
      flush(job);
      job.eligible = generating && message?.status !== "stopped" && message?.status !== "error";
      return;
    }
    if (job.target !== content) {
      const now = performance.now(), waiting = job.pending.length > 0;
      const append = content.startsWith(job.target), keep = append ? Math.max(0, job.ends.length - 1) : 0;
      const start = job.ends[keep - 1] || 0;
      if (!append) job.pending = [];
      job.target = content; job.ends.length = keep;
      // Only the previous last cluster can merge with an appended delta.
      for (const part of segmenter!.segment(content.slice(start))) {
        const end = start + part.index + part.segment.length, last = content.charCodeAt(end - 1);
        if (generating && end === content.length && (last >= 0xd800 && last <= 0xdbff || last === 0x200d)) break;
        job.ends.push(end);
      }
      const availableEnd = job.ends.at(-1) || 0;
      job.pending = job.pending.filter(part => part.end > job.text.length && part.end <= availableEnd);
      if (availableEnd > (job.pending.at(-1)?.end || job.text.length)) job.pending.push({ end: availableEnd, deadline: now + DRAIN_MS });
      job.cursor = graphemeIndex(job.ends, job.text.length);
      job.lastFrame = now; if (!waiting) job.lastCommit = now;
    }
    if (job.text === content) { if (!generating) job.eligible = false; return; }
    const owned = job;
    const frame = (now: number) => {
      owned.frame = 0;
      if (current.current !== owned) return;
      if (!motionAllowed()) { flush(owned); return; }
      let time = owned.lastFrame, budget = now - time, due = false, partIndex = 0;
      while (budget > 0 && partIndex < owned.pending.length) {
        const part = owned.pending[partIndex], goal = graphemeIndex(owned.ends, part.end, true);
        due ||= now >= part.deadline;
        if (owned.cursor >= goal) { partIndex++; continue; }
        const remaining = goal - owned.cursor, rate = Math.max(1 / 5, remaining / Math.max(1, part.deadline - time));
        const spent = Math.min(budget, remaining / rate);
        owned.cursor = Math.min(goal, owned.cursor + rate * spent); time += spent; budget -= spent;
        if (goal - owned.cursor < 0.000001) { owned.cursor = goal; partIndex++; }
      }
      owned.lastFrame = now;
      const done = owned.cursor >= graphemeIndex(owned.ends, owned.pending.at(-1)?.end || owned.text.length, true);
      const end = Math.max(owned.text.length, owned.ends[Math.floor(owned.cursor) - 1] || 0);
      if (done && !owned.generating || due || now - owned.lastCommit >= COMMIT_MS) {
        const text = owned.target.slice(0, end);
        owned.lastCommit = now;
        if (text !== owned.text) { owned.text = text; setVisible({ key: owned.key, text }); }
        owned.pending = owned.pending.filter(part => part.end > owned.text.length);
        if (done && !owned.generating) owned.eligible = false;
      }
      if (!done || owned.text.length !== end) owned.frame = requestAnimationFrame(frame);
    };
    if (!owned.frame) owned.frame = requestAnimationFrame(frame);
  }, [key, content, message?.status, generating, navigation, intent, enabled]);

  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const settle = () => { if (current.current && (document.hidden || motion.matches)) flush(current.current); };
    document.addEventListener("visibilitychange", settle); motion.addEventListener("change", settle);
    return () => { document.removeEventListener("visibilitychange", settle); motion.removeEventListener("change", settle); if (current.current) cancel(current.current); };
  }, []);

  const job = current.current;
  const startedHere = job && job.intent !== intent && (generating || job.key !== key);
  const eligible = Boolean((startedHere || job?.eligible && job.navigation === navigation && (job.key === key || generating)) &&
    message?.status !== "error" && message?.status !== "stopped" &&
    typeof document !== "undefined" && motionAllowed());
  const text = startedHere && visible.key !== key ? "" : eligible && (visible.key === key || generating) && content.startsWith(visible.text) ? visible.text : content;
  return { content: enabled ? text : content, pending: enabled && eligible && text !== content };
}
