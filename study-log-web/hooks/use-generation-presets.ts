"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, requestJson } from "@/lib/client-http";
import { LEGACY_GENERATION_PRESET, type GenerationPresetsSnapshot } from "@/lib/generation-presets-types";
import { parseGenerationPresets, survivingPresetSelection } from "@/lib/generation-presets-view";

export type GenerationPresetsController = ReturnType<typeof useGenerationPresets>;
export function useGenerationPresets(active: boolean) {
  const [snapshot, setSnapshot] = useState<GenerationPresetsSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState(LEGACY_GENERATION_PRESET);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const live = useRef(active); live.current = active;
  const initialized = useRef(false);
  const readRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const current = useRef(snapshot); current.current = snapshot;

  const refresh = useCallback(async () => {
    if (!live.current || writeRequest.current) return null;
    readRequest.current?.abort();
    const controller = new AbortController(); readRequest.current = controller;
    setLoading(true); setError(""); setConflict(false);
    try {
      const next = parseGenerationPresets(await requestJson<unknown>("/api/ai/generation-presets", { signal: controller.signal }));
      if (controller.signal.aborted || !live.current) return null;
      current.current = next; setSnapshot(next);
      const alreadyInitialized = initialized.current;
      setSelectedId(previous => alreadyInitialized ? survivingPresetSelection(next, previous) : next.defaultPresetId);
      initialized.current = true;
      return next;
    } catch (failure) {
      if (!controller.signal.aborted && live.current) setError(failure instanceof Error ? failure.message : "读取生成方案失败");
      return null;
    } finally { if (readRequest.current === controller) { readRequest.current = null; setLoading(false); } }
  }, []);

  useEffect(() => {
    if (active) void refresh();
    return () => { readRequest.current?.abort(); writeRequest.current?.abort(); };
  }, [active, refresh]);

  async function save(method: "POST" | "PATCH" | "DELETE", input: Record<string, unknown>, version?: string) {
    if (!live.current || writeRequest.current || !current.current) return null;
    readRequest.current?.abort();
    const controller = new AbortController(); writeRequest.current = controller;
    setSaving(true); setError(""); setConflict(false);
    try {
      const next = parseGenerationPresets(await requestJson<unknown>("/api/ai/generation-presets", { method,
        body: JSON.stringify({ ...input, version: version ?? current.current.version }), signal: controller.signal }));
      if (controller.signal.aborted || !live.current) return null;
      current.current = next; setSnapshot(next); setSelectedId(previous => survivingPresetSelection(next, previous));
      return next;
    } catch (failure) {
      if (!controller.signal.aborted && live.current) {
        setError(failure instanceof Error ? failure.message : "保存生成方案失败，输入已保留");
        setConflict(failure instanceof ApiRequestError && failure.status === 409);
      }
      return null;
    } finally { if (writeRequest.current === controller) { writeRequest.current = null; setSaving(false); } }
  }
  return { snapshot, selectedId, setSelectedId, loading, saving, error, conflict, refresh, save };
}
