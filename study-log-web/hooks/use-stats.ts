"use client";

import { useEffect, useRef, useState } from "react";
import { ApiRequestError, requestJson } from "@/lib/client-http";
import { taxonomyMapping } from "@/lib/stats-tags";
import { todayInShanghai } from "@/lib/study-date";
import type { ConfirmationOptions } from "@/components/ConfirmDialog";
import type { MonthSummary } from "@/lib/types";
import type { MonthlyStats, Taxonomy, TaxonomyCatalogItem } from "@/lib/stats-types";
import { useTaxonomySuggestions } from "./use-taxonomy-suggestions";

interface Options {
  active: boolean; visible: boolean; routeMonth?: string;
  onRouteMonthChange?: (month: string) => Promise<boolean>;
  onConfirm: (options: ConfirmationOptions) => Promise<boolean>;
}
const empty = (): Taxonomy => ({ domains: ["其他"], mappings: {}, updatedAt: null, version: null });
const same = (a: Taxonomy, b: Taxonomy) => JSON.stringify(a.domains) === JSON.stringify(b.domains) && JSON.stringify(a.mappings) === JSON.stringify(b.mappings);
const validMonth = (month: string | undefined) => Boolean(month && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month));

export function useStats(options: Options) {
  const [view, setView] = useState<"overview" | "taxonomy">("overview");
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(validMonth(options.routeMonth) ? options.routeMonth! : "");
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>(empty);
  const [savedTaxonomy, setSavedTaxonomy] = useState<Taxonomy>(empty);
  const [catalog, setCatalog] = useState<TaxonomyCatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [taxonomyError, setTaxonomyError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [reloadRevision, setReloadRevision] = useState(0);
  const [statsRevision, setStatsRevision] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const current = useRef({ options, taxonomy, savedTaxonomy, selectedMonth, busy });
  current.current = { options, taxonomy, savedTaxonomy, selectedMonth, busy };
  const dirty = !same(taxonomy, savedTaxonomy);
  const ai = useTaxonomySuggestions({ active: options.active, visible: options.visible && view === "taxonomy", busy: busy || initialLoading, draft: taxonomy, saved: savedTaxonomy, onApply: setTaxonomy });

  useEffect(() => {
    if (validMonth(options.routeMonth)) setSelectedMonth(options.routeMonth!);
  }, [options.routeMonth]);

  useEffect(() => {
    if (!options.active || !options.visible) return;
    const controller = new AbortController();
    setInitialLoading(true); setTaxonomyError("");
    Promise.all([
      requestJson<{ months: MonthSummary[] }>("/api/logs/months", { signal: controller.signal }),
      requestJson<{ taxonomy: Taxonomy; catalog: TaxonomyCatalogItem[] }>("/api/taxonomy", { signal: controller.signal })
    ]).then(([monthPayload, payload]) => {
      if (controller.signal.aborted) return;
      setMonths(monthPayload.months); setCatalog(payload.catalog);
      if (same(current.current.taxonomy, current.current.savedTaxonomy)) {
        setTaxonomy(payload.taxonomy); setSavedTaxonomy(payload.taxonomy); setConflict(false);
      }
      if (!current.current.selectedMonth) {
        const month = monthPayload.months[0]?.id || todayInShanghai().slice(0, 7);
        setSelectedMonth(month); void current.current.options.onRouteMonthChange?.(month);
      }
    }).catch(error => {
      if (!controller.signal.aborted && error?.name !== "AbortError") setTaxonomyError(error instanceof Error ? error.message : "读取分类失败");
    }).finally(() => { if (!controller.signal.aborted) setInitialLoading(false); });
    return () => controller.abort();
  }, [options.active, options.visible, reloadRevision]);

  useEffect(() => {
    if (!options.active || !options.visible || !selectedMonth) return;
    const controller = new AbortController();
    setLoading(true); setStatsError(""); setMonthlyStats(null);
    requestJson<{ stats: MonthlyStats }>(`/api/stats?month=${encodeURIComponent(selectedMonth)}`, { signal: controller.signal })
      .then(payload => { if (!controller.signal.aborted) setMonthlyStats(payload.stats); })
      .catch(error => { if (!controller.signal.aborted && error?.name !== "AbortError") setStatsError(error instanceof Error ? error.message : "读取统计失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [options.active, options.visible, selectedMonth, statsRevision]);

  useEffect(() => {
    return () => { operation.current?.abort(); operation.current = null; setBusy(false); };
  }, [options.active, options.visible]);
  useEffect(() => {
    if (!dirty && !ai.review) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, ai.review]);

  async function beforeLeave(): Promise<boolean> {
    const state = current.current;
    if (!state.options.active || operation.current) return false;
    if (same(state.taxonomy, state.savedTaxonomy) && !ai.review) { ai.discard(); return true; }
    const accepted = await state.options.onConfirm({ title: "放弃未保存分类？", message: "当前领域、标签映射或未应用的分类建议有修改，离开后将丢弃这些修改。", confirmLabel: "放弃修改", tone: "danger" });
    if (!accepted || !current.current.options.active) return false;
    setTaxonomy(current.current.savedTaxonomy); setConflict(false); setTaxonomyError("");
    current.current.taxonomy = current.current.savedTaxonomy;
    ai.discard();
    return true;
  }
  async function changeMonth(month: string) {
    if (!validMonth(month)) return false;
    const navigate = current.current.options.onRouteMonthChange;
    if (!(await (navigate ? navigate(month) : beforeLeave()))) return false;
    setSelectedMonth(month); setView("overview"); return true;
  }
  async function showOverview() { if (await beforeLeave()) setView("overview"); }
  async function reloadTaxonomy() {
    if (!(await beforeLeave())) return;
    setReloadRevision(value => value + 1); setStatsRevision(value => value + 1);
  }
  async function saveTaxonomy() {
    const state = current.current;
    if (!state.options.active || !state.options.visible || operation.current || initialLoading) return;
    const controller = new AbortController(); operation.current = controller;
    const submitted = state.taxonomy;
    setBusy(true); setTaxonomyError(""); setConflict(false); setFeedback("");
    try {
      const payload = await requestJson<{ taxonomy: Taxonomy }>("/api/taxonomy", {
        method: "PUT", signal: controller.signal,
        body: JSON.stringify({ domains: submitted.domains, mappings: submitted.mappings, baseVersion: state.savedTaxonomy.version })
      });
      if (operation.current !== controller || controller.signal.aborted) return;
      setSavedTaxonomy(payload.taxonomy);
      setTaxonomy(previous => same(previous, submitted) ? payload.taxonomy : { ...previous, version: payload.taxonomy.version, updatedAt: payload.taxonomy.updatedAt });
      setCatalog(previous => previous.map(item => ({ ...item,
        domain: taxonomyMapping(payload.taxonomy.mappings, item.tag) ?? "其他", explicitlyMapped: taxonomyMapping(payload.taxonomy.mappings, item.tag) !== undefined })));
      setFeedback("领域映射已保存"); setStatsRevision(value => value + 1);
    } catch (error) {
      if (operation.current !== controller || controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
      setConflict(error instanceof ApiRequestError && error.status === 409);
      setTaxonomyError(error instanceof Error ? error.message : "保存映射失败，请重试");
    } finally { if (operation.current === controller) { operation.current = null; setBusy(false); } }
  }
  return { view, months, selectedMonth, monthlyStats: monthlyStats?.month === selectedMonth ? monthlyStats : null,
    taxonomy, savedTaxonomy, catalog, busy, loading, initialLoading, statsError, taxonomyError, conflict, feedback, dirty, ai,
    active: options.active && options.visible, beforeLeave, changeMonth, showOverview, saveTaxonomy, reloadTaxonomy,
    showManager: () => setView("taxonomy"), setTaxonomy, dismissFeedback: () => setFeedback(""),
    refreshStats: () => setStatsRevision(value => value + 1),
    confirmRemoveDomain: (domain: string) => options.onConfirm({ title: "删除自定义领域", message: `删除领域“${domain}”？其中的显式映射将移到“其他”。`, confirmLabel: "删除", tone: "danger" }) };
}
export type StatsController = ReturnType<typeof useStats>;
