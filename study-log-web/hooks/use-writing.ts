"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmationOptions } from "@/components/ConfirmDialog";
import { ApiRequestError, requestJson } from "@/lib/client-http";
import type { GeneratedLog } from "@/lib/ai-generation";
import type { ExtractedDocument } from "@/lib/upload-extract";
import { todayInShanghai } from "@/lib/study-date";
import { appendMaterial, writingConfigurationMessages, writingInputProblem, type WritingCapabilities } from "@/lib/writing-view";
import { useGenerationPresets } from "./use-generation-presets";

interface Options {
  active: boolean; visible: boolean; date: string;
  onConfirm: (options: ConfirmationOptions) => Promise<boolean>;
  onApply: (date: string, content: string) => Promise<boolean>;
}
type Operation = { kind: "import" | "generate" | "apply"; date: string; generation: number; controller: AbortController };
export type WritingController = ReturnType<typeof useWriting>;

export function useWriting(options: Options) {
  const live = useRef(options); live.current = options;
  const presets = useGenerationPresets(options.active);
  const usesLegacyTemplate = presets.selectedId === "legacy";
  const [instruction, setInstruction] = useState("");
  const [material, setMaterial] = useState("");
  const [output, setOutput] = useState("");
  const [outputDate, setOutputDate] = useState("");
  const inputs = useRef({ instruction, material, output, outputDate });
  inputs.current = { instruction, material, output, outputDate };
  const [materialWarnings, setMaterialWarnings] = useState<string[]>([]);
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"error" | "warning" | "pending" | "success">("success");
  const [busy, setBusy] = useState<Operation["kind"] | null>(null);
  const pending = useRef<Operation | null>(null);
  const generation = useRef(0);
  const confirming = useRef(false);
  const [capabilities, setCapabilities] = useState<WritingCapabilities | null>(null);
  const [configurationError, setConfigurationError] = useState("");
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const configurationRequest = useRef<AbortController | null>(null);
  const dirty = Boolean(instruction || material || output);
  const configured = Boolean(capabilities?.features.aiWriting.supported && (usesLegacyTemplate ? capabilities.features.aiWriting.configured :
    capabilities.aiConfiguration?.provider.configured ?? capabilities.features.aiWriting.configured));
  const inputProblem = writingInputProblem(options.date, todayInShanghai(), material, instruction);

  function feedback(message: string, kind: typeof statusKind = "success") { setStatus(message); setStatusKind(kind); }
  const refreshConfiguration = useCallback(async () => {
    if (!live.current.active) return;
    configurationRequest.current?.abort();
    const controller = new AbortController(); configurationRequest.current = controller;
    setConfigurationLoading(true); setConfigurationError("");
    try {
      const payload = await requestJson<WritingCapabilities>("/api/capabilities", { signal: controller.signal });
      if (!controller.signal.aborted && live.current.active) setCapabilities(payload);
    } catch (error) {
      if (!controller.signal.aborted && live.current.active) { setConfigurationError(error instanceof Error ? error.message : "读取生成配置失败"); setCapabilities(null); }
    } finally { if (configurationRequest.current === controller) { configurationRequest.current = null; setConfigurationLoading(false); } }
  }, []);
  function cancelOperation() {
    const previous = pending.current;
    pending.current?.controller.abort(); pending.current = null; generation.current++; setBusy(null);
    if (previous) feedback("已取消当前操作，现有材料和草稿已保留。", "warning");
  }
  function discard() {
    cancelOperation(); confirming.current = false;
    inputs.current = { instruction: "", material: "", output: "", outputDate: "" };
    setInstruction(""); setMaterial(""); setOutput(""); setOutputDate("");
    setMaterialWarnings([]); setGenerationWarnings([]); setStatus("");
  }
  useEffect(() => {
    if (options.active) void refreshConfiguration();
    return () => { configurationRequest.current?.abort(); };
  }, [options.active, refreshConfiguration]);
  useEffect(() => () => {
    const wasPending = Boolean(pending.current);
    pending.current?.controller.abort(); pending.current = null; generation.current++; confirming.current = false; setBusy(null);
    if (wasPending) feedback("当前操作已取消，现有材料和草稿已保留。", "warning");
  }, [options.active, options.date]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  function current(operation: Operation) {
    return pending.current === operation && !operation.controller.signal.aborted && live.current.active &&
      operation.generation === generation.current && operation.date === live.current.date;
  }
  function begin(kind: Operation["kind"]): Operation {
    const operation = { kind, date: live.current.date, generation: generation.current, controller: new AbortController() };
    pending.current = operation; setBusy(kind); setStatus(""); return operation;
  }
  function finish(operation: Operation) { if (pending.current === operation) { pending.current = null; setBusy(null); } }
  async function beforeLeave() {
    if (!live.current.active || confirming.current) return false;
    if (!Object.values(inputs.current).some(Boolean) && !pending.current) return true;
    confirming.current = true;
    const token = generation.current;
    try {
      const accepted = await live.current.onConfirm({ title: "放弃 AI 助手内容？", message: "当前学习材料、补充要求和生成草稿尚未保存。离开将清除这些内容并取消正在进行的操作。", confirmLabel: "放弃", tone: "danger" });
      if (!accepted || !live.current.active || token !== generation.current) return false;
      discard(); return true;
    } finally { confirming.current = false; }
  }
  async function importFiles(files: File[]) {
    if (!live.current.active || !live.current.visible || pending.current || confirming.current || !files.length) return;
    if (files.length > 5) { feedback("一次最多导入 5 个文件", "warning"); return; }
    const operation = begin("import"); let imported = 0, failed = 0;
    try {
      for (const file of files) {
        if (!current(operation)) return;
        try {
          if (!/\.(?:txt|md|markdown|pdf|docx|pptx)$/i.test(file.name)) throw new Error("不支持的材料格式");
          if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("文件不能为空或超过 20 MiB");
          feedback(`正在导入 ${file.name}…`, "pending");
          const form = new FormData(); form.append("file", file);
          const { document } = await requestJson<{ document: ExtractedDocument }>("/api/materials/extract", { method: "POST", body: form, signal: operation.controller.signal });
          if (!current(operation)) return;
          setMaterial(value => appendMaterial(value, document)); imported++;
          setMaterialWarnings(value => [...value, ...document.warnings.map(warning => `${document.fileName}：${warning}`)]);
        } catch (error) {
          if (!current(operation) || (error instanceof ApiRequestError && error.status === 401)) return;
          failed++; setMaterialWarnings(value => [...value, `${file.name}：${error instanceof Error ? error.message : "导入失败"}`]);
        }
      }
      if (current(operation)) feedback(failed ? `已导入 ${imported} 个文件，${failed} 个失败` : "文件文本已按顺序导入学习材料区", failed ? "warning" : "success");
    } finally { finish(operation); }
  }
  async function generate() {
    if (!live.current.active || !live.current.visible || pending.current || confirming.current || presets.loading || presets.saving) return;
    const problem = writingInputProblem(live.current.date, todayInShanghai(), inputs.current.material, inputs.current.instruction);
    if (problem) { feedback(problem, "warning"); return; }
    if (!configured) { feedback("请先完成日志生成配置；现有学习材料已保留。", "warning"); return; }
    const token = generation.current;
    if (inputs.current.output.trim()) {
      confirming.current = true;
      let accepted = false;
      try { accepted = await live.current.onConfirm({ title: "重新生成草稿？", message: "生成成功后会替换当前生成草稿；若失败，仍保留现有草稿。", confirmLabel: "重新生成" }); }
      finally { confirming.current = false; }
      if (!accepted || !live.current.active || token !== generation.current) return;
    }
    const operation = begin("generate");
    try {
      const { result } = await requestJson<{ result: GeneratedLog }>("/api/ai/generate", { method: "POST", signal: operation.controller.signal,
        body: JSON.stringify({ date: operation.date, material: inputs.current.material, instruction: inputs.current.instruction, presetId: presets.selectedId }) });
      if (!current(operation)) return;
      setOutput(result.content); setOutputDate(operation.date); setGenerationWarnings(result.warnings);
      feedback(`已生成草稿，模型：${result.model}`);
    } catch (error) { if (current(operation)) feedback(error instanceof Error ? error.message : "生成失败，请重试", "error"); }
    finally { finish(operation); }
  }
  async function apply() {
    if (!live.current.active || !live.current.visible || pending.current || confirming.current || !inputs.current.output.trim()) return;
    if (!live.current.date || inputs.current.outputDate !== live.current.date) { feedback(`该草稿属于 ${inputs.current.outputDate || "其他日期"}，切回对应日志后才能追加。`, "warning"); return; }
    const operation = begin("apply");
    try {
      const accepted = await live.current.onApply(operation.date, inputs.current.output);
      if (current(operation)) feedback(accepted ? "AI 草稿已追加到当前编辑草稿，尚未保存。" : "当前日志暂时无法追加，生成草稿已保留。", accepted ? "success" : "warning");
    } catch (error) { if (current(operation)) feedback(error instanceof Error ? error.message : "追加失败，生成草稿已保留", "error"); }
    finally { finish(operation); }
  }
  return { active: options.active, visible: options.visible, date: options.date, instruction, material, output, outputDate,
    setInstruction, setMaterial, setOutput: (value: string) => { setOutput(value); if (!inputs.current.outputDate) setOutputDate(live.current.date); },
    materialWarnings, generationWarnings, status, statusKind, busy, dirty, configured, inputProblem, presets,
    configurationLoading, configurationError, configurationMessages: capabilities ? writingConfigurationMessages(capabilities, usesLegacyTemplate) : [],
    refreshConfiguration, beforeLeave, discard, cancelOperation, importFiles, generate, apply };
}
