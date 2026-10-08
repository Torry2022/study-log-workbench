"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/client-http";
import type { Taxonomy, TaxonomyCatalogItem } from "@/lib/stats-types";
import type { TaxonomySuggestion, TaxonomySuggestionResult } from "@/lib/ai-taxonomy";

interface Options { active: boolean; visible: boolean; busy: boolean; draft: Taxonomy; saved: Taxonomy; onApply: (taxonomy: Taxonomy) => void }
interface Capabilities {
  features: { aiTaxonomy?: { supported: boolean; configured: boolean } };
  aiConfiguration?: { provider: { issues: Array<{ message: string }> } };
}
interface Review { snapshot: Taxonomy; suggestions: Array<TaxonomySuggestion & { selected: boolean }>; warnings: string[] }
const same = (left: Taxonomy, right: Taxonomy) => left.version === right.version && JSON.stringify(left.domains) === JSON.stringify(right.domains) && JSON.stringify(left.mappings) === JSON.stringify(right.mappings);

export function useTaxonomySuggestions(options: Options) {
  const live = useRef(options); live.current = options;
  const [review, setReview] = useState<Review | null>(null);
  const reviewRef = useRef(review); reviewRef.current = review;
  const [phase, setPhase] = useState<"idle" | "requesting" | "applying">("idle");
  const requestRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState("");
  const [versionChanged, setVersionChanged] = useState(false);
  const [configuration, setConfiguration] = useState<Capabilities | null>(null);
  const [configurationError, setConfigurationError] = useState("");
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const configurationRef = useRef<AbortController | null>(null);
  const configured = Boolean(configuration?.features.aiTaxonomy?.supported && configuration.features.aiTaxonomy.configured);
  const configurationMessages = !configuration ? [] : !configuration.features.aiTaxonomy?.supported ? ["此服务器尚未开放分类建议。"] : configuration.aiConfiguration?.provider.issues.map(issue => issue.message) || [];
  if (configuration?.features.aiTaxonomy?.supported && !configured && !configurationMessages.length) configurationMessages.push("分类建议尚未配置完成，请检查模型配置。");
  const inputProblem = !same(options.draft, options.saved) ? "请先保存当前分类修改，再请求新的分类建议。" : !options.saved.domains.some(domain => domain !== "其他") ? "请先添加并保存自定义领域，再请求分类建议。" : "";

  function cancel() { requestRef.current?.abort(); requestRef.current = null; setPhase("idle"); }
  function discard() { cancel(); reviewRef.current = null; setReview(null); setStatus(""); setVersionChanged(false); }
  async function refreshConfiguration() {
    if (!live.current.active || !live.current.visible) return;
    configurationRef.current?.abort(); const controller = new AbortController(); configurationRef.current = controller;
    setConfigurationLoading(true); setConfigurationError("");
    try {
      const value = await requestJson<Capabilities>("/api/capabilities", { signal: controller.signal });
      if (!controller.signal.aborted && configurationRef.current === controller) setConfiguration(value);
    } catch (error) {
      if (!controller.signal.aborted) setConfigurationError(error instanceof Error ? error.message : "读取 AI 配置失败");
    } finally { if (configurationRef.current === controller) { configurationRef.current = null; setConfigurationLoading(false); } }
  }
  useEffect(() => {
    if (options.active && options.visible) void refreshConfiguration();
    return () => { cancel(); configurationRef.current?.abort(); configurationRef.current = null; };
    // Configuration is re-read when re-entering the module or after login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.active, options.visible]);
  useEffect(() => {
    if (!reviewRef.current && !requestRef.current) return;
    discard(); setStatus("分类草稿或保存版本已变化，旧建议未应用；请核对后重新请求。");
    // Any draft edit invalidates suggestions based on the previous snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.draft, options.saved]);

  async function request(items: TaxonomyCatalogItem[]) {
    const state = live.current;
    if (!state.active || !state.visible || state.busy || requestRef.current || !configured || !same(state.draft, state.saved) || !state.saved.domains.some(domain => domain !== "其他")) return;
    if (!items.length || items.length > 200) { setStatus("请通过筛选将本次标签范围控制在 1 至 200 个。"); return; }
    const snapshot = state.saved;
    const controller = new AbortController(); requestRef.current = controller; setPhase("requesting"); setStatus(""); setVersionChanged(false);
    try {
      const result = await requestJson<TaxonomySuggestionResult>("/api/taxonomy/suggest", { method: "POST", signal: controller.signal,
        body: JSON.stringify({ items: items.map(item => ({ tag: item.tag, sources: item.sources.slice(0, 4) })) }) });
      if (requestRef.current !== controller || controller.signal.aborted || !live.current.active || !live.current.visible) return;
      if (!same(live.current.draft, snapshot) || !same(live.current.saved, snapshot) || result.snapshotVersion !== snapshot.version) {
        setVersionChanged(true); setStatus("分类保存版本已变化，本次建议未载入；请重新读取分类后再请求。"); return;
      }
      const requested = new Set(items.map(item => item.tag));
      const suggestions = result.suggestions.filter(item => requested.has(item.tag) && snapshot.domains.includes(item.domain)).map(item => ({ ...item, selected: true }));
      const value = suggestions.length ? { snapshot, suggestions, warnings: result.warnings } : null;
      reviewRef.current = value; setReview(value);
      setStatus(suggestions.length ? `已生成 ${suggestions.length} 条建议，请审核后应用到草稿。` : result.warnings.join("；") || "本次没有可用的分类建议。");
    } catch (error) {
      if (requestRef.current === controller && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "分类建议失败，请重试");
    } finally { if (requestRef.current === controller) { requestRef.current = null; setPhase("idle"); } }
  }
  function editSuggestion(tag: string, patch: { domain?: string; selected?: boolean }) {
    const current = reviewRef.current;
    if (!current || requestRef.current || !live.current.active || !live.current.visible) return;
    if (patch.domain && !current.snapshot.domains.includes(patch.domain)) return;
    const next = { ...current, suggestions: current.suggestions.map(item => item.tag === tag ? { ...item, ...patch } : item) };
    reviewRef.current = next; setReview(next);
  }
  async function apply() {
    const selected = reviewRef.current, state = live.current;
    if (!selected || !state.active || !state.visible || state.busy || requestRef.current || !same(state.draft, selected.snapshot) || !same(state.saved, selected.snapshot)) return;
    const choices = selected.suggestions.filter(item => item.selected);
    if (!choices.length) return;
    const controller = new AbortController(); requestRef.current = controller; setPhase("applying"); setStatus("");
    try {
      const payload = await requestJson<{ taxonomy: Taxonomy }>("/api/taxonomy", { signal: controller.signal });
      if (requestRef.current !== controller || controller.signal.aborted || !live.current.active || !live.current.visible || reviewRef.current !== selected) return;
      if (!same(payload.taxonomy, selected.snapshot) || !same(live.current.draft, selected.snapshot) || !same(live.current.saved, selected.snapshot)) {
        setVersionChanged(true); setStatus("分类保存版本已变化，建议未应用，当前草稿保留；请重新读取分类后再请求。"); return;
      }
      reviewRef.current = null; setReview(null);
      const next = { ...live.current.draft, mappings: { ...live.current.draft.mappings, ...Object.fromEntries(choices.map(item => [item.tag, item.domain])) } };
      requestRef.current = null; setPhase("idle");
      live.current.onApply(next); setStatus(`已应用 ${choices.length} 条建议到草稿，请点击“保存映射”完成保存。`);
    } catch (error) {
      if (requestRef.current === controller && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "核对分类版本失败，草稿未修改");
    } finally { if (requestRef.current === controller) { requestRef.current = null; setPhase("idle"); } }
  }
  return { review, phase, status, versionChanged, configured, configurationLoading, configurationError, configurationMessages, inputProblem,
    refreshConfiguration, request, cancel: () => { cancel(); setStatus("已取消分类建议请求。"); }, discard, editSuggestion, apply };
}
export type TaxonomySuggestionsController = ReturnType<typeof useTaxonomySuggestions>;
