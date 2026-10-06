import type { ExtractedDocument } from "./upload-extract.ts";

export interface WritingCapabilities {
  features: { aiWriting: { supported: boolean; configured: boolean } };
  aiConfiguration?: {
    provider: { configured: boolean; issues: Array<{ message: string }> };
    templates: { generation: { configured: boolean; issue?: { message: string } } };
  };
}

export function writingConfigurationMessages(capabilities: WritingCapabilities, usesLegacyTemplate = true): string[] {
  if (!capabilities.features.aiWriting.supported) return ["此服务器尚未开放日志生成；仍可导入和整理学习材料。"];
  const configuration = capabilities.aiConfiguration;
  const messages = [...configuration?.provider.issues.map(issue => issue.message) || []];
  if (usesLegacyTemplate && configuration?.templates.generation.issue) messages.push(configuration.templates.generation.issue.message);
  if (!(usesLegacyTemplate ? capabilities.features.aiWriting.configured : configuration?.provider.configured ?? capabilities.features.aiWriting.configured) && !messages.length) messages.push("日志生成尚未配置完成，请联系实例维护者。仍可导入材料。");
  return messages;
}

/** Append to the latest user text, never to the snapshot captured before extraction. */
export function appendMaterial(current: string, document: Pick<ExtractedDocument, "fileName" | "text">): string {
  return `${current}${current.trim() ? "\n\n" : ""}[文件：${document.fileName}]\n${document.text}`;
}

export function writingInputProblem(date: string, today: string, material: string, instruction: string): string {
  if (!date) return "请先选择左侧日块";
  if (date > today) return "不能为未来日期生成日志";
  if (!material.trim() && !instruction.trim()) return "请先填写补充要求或学习材料";
  if (material.length > 120_000) return "学习材料不能超过 120,000 字符，请先整理材料";
  if (instruction.length > 4000) return "补充要求不能超过 4,000 字符";
  return "";
}
