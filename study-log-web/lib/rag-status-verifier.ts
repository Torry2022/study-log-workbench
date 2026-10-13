import { requestChat, AiChatError, type ChatMessage } from "./ai-chat.ts";
import type { ChatConfig } from "./ai-config.ts";
import type { RagPromptMessage, RagRetrievalStrategy } from "./rag-types.ts";
import { unified } from "unified";
import remarkParse from "remark-parse";

type AstNode = {
  type: string;
  depth?: number;
  value?: string;
  children?: AstNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

export interface RangeStatusClaim { claimId: string; text: string }
export interface RangeStatusVerdict extends RangeStatusClaim {
  verdict: "supported" | "outdated" | "unclear";
  sourceIds: string[];
  reason: string;
}
type LocatedClaim = RangeStatusClaim & { start: number; end: number; section: number };
type LocatedSection = { start: number; end: number; claimIds: string[] };

const nodeText = (node: AstNode): string => node.value ?? (node.children || []).map(nodeText).join("");
const offsets = (node: AstNode): [number, number] | null => {
  const start = node.position?.start.offset, end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : [start, end];
};

function locateRangeStatusClaims(markdown: string): { claims: LocatedClaim[]; sections: LocatedSection[] } {
  const root = unified().use(remarkParse).parse(markdown) as AstNode;
  const children = root.children || [], claims: LocatedClaim[] = [], sections: LocatedSection[] = [];
  for (let index = 0; index < children.length; index++) {
    const heading = children[index];
    if (heading.type !== "heading" || !heading.depth || nodeText(heading).trim() !== "仍待解决") continue;
    const headingRange = offsets(heading);
    if (!headingRange) continue;
    let endIndex = index + 1;
    while (endIndex < children.length && !(children[endIndex].type === "heading" && (children[endIndex].depth || 7) <= heading.depth)) endIndex++;
    const sectionIndex = sections.length, claimIds: string[] = [];
    for (const node of children.slice(index + 1, endIndex)) {
      if (node.type !== "list") continue;
      for (const item of node.children || []) {
        if (item.type !== "listItem") continue;
        const range = offsets(item);
        if (!range) continue;
        const claimId = `C${claims.length + 1}`;
        claimIds.push(claimId);
        claims.push({ claimId, text: nodeText(item).trim(), start: range[0], end: range[1], section: sectionIndex });
      }
    }
    const last = children[endIndex - 1], lastRange = last ? offsets(last) : null;
    sections.push({ start: headingRange[0], end: lastRange?.[1] ?? headingRange[1], claimIds });
    index = endIndex - 1;
  }
  return { claims, sections };
}

export function extractRangeStatusClaims(markdown: string): RangeStatusClaim[] {
  return locateRangeStatusClaims(markdown).claims.map(({ claimId, text }) => ({ claimId, text }));
}

export function applyRangeStatusVerdicts(markdown: string, verdicts: RangeStatusVerdict[]): string {
  const located = locateRangeStatusClaims(markdown);
  const byId = new Map(verdicts.map(verdict => [verdict.claimId, verdict]));
  if (verdicts.length !== located.claims.length || byId.size !== verdicts.length ||
    located.claims.some(claim => !byId.has(claim.claimId))) {
    throw new AiChatError("RAG_STATUS_VERIFICATION_INVALID", "范围末状态核对结果不完整，请重试");
  }
  const removed = new Set(verdicts.filter(verdict => verdict.verdict !== "supported").map(verdict => verdict.claimId));
  const ranges: Array<[number, number]> = [];
  for (const [sectionIndex, section] of located.sections.entries()) {
    if (section.claimIds.length && section.claimIds.every(claimId => removed.has(claimId))) ranges.push([section.start, section.end]);
    else for (const claim of located.claims) if (claim.section === sectionIndex && removed.has(claim.claimId)) ranges.push([claim.start, claim.end]);
  }
  let result = markdown;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) result = result.slice(0, start) + result.slice(end);
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export function rangeStatusVerificationEnabled(strategy: RagRetrievalStrategy, completeDays: number,
  env: Record<string, string | undefined> = process.env): boolean {
  return env.RAG_STATUS_VERIFICATION_ENABLED === "true" && strategy === "timeline_summary" && completeDays >= 14;
}

function parseVerdicts(value: string, claims: RangeStatusClaim[], validSources: Set<string>): RangeStatusVerdict[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new AiChatError("RAG_STATUS_VERIFICATION_INVALID", "范围末状态核对结果无效，请重试"); }
  const items = (parsed as { claims?: unknown } | null)?.claims;
  if (!Array.isArray(items) || items.length !== claims.length) throw new AiChatError("RAG_STATUS_VERIFICATION_INVALID", "范围末状态核对结果不完整，请重试");
  const expected = new Set(claims.map(claim => claim.claimId)), found = new Set<string>();
  const verdicts: RangeStatusVerdict[] = [];
  for (const value of items) {
    const item = value as Partial<RangeStatusVerdict> | null;
    if (!item || typeof item.claimId !== "string" || !expected.has(item.claimId) || found.has(item.claimId) ||
      !["supported", "outdated", "unclear"].includes(item.verdict || "") || !Array.isArray(item.sourceIds) || !item.sourceIds.length ||
      !item.sourceIds.every(sourceId => typeof sourceId === "string" && validSources.has(sourceId)) ||
      typeof item.reason !== "string" || !item.reason.trim()) {
      throw new AiChatError("RAG_STATUS_VERIFICATION_INVALID", "范围末状态核对结果无效，请重试");
    }
    found.add(item.claimId);
    verdicts.push({ claimId: item.claimId, text: claims.find(claim => claim.claimId === item.claimId)!.text,
      verdict: item.verdict as RangeStatusVerdict["verdict"], sourceIds: item.sourceIds, reason: item.reason.trim() });
  }
  return verdicts;
}

export async function verifyRangeStatusClaims(draft: string, evidenceMessages: RagPromptMessage[], config: ChatConfig,
  signal: AbortSignal, request: typeof requestChat = requestChat): Promise<{ answer: string; verdicts: RangeStatusVerdict[] }> {
  const claims = extractRangeStatusClaims(draft);
  if (!claims.length) return { answer: draft, verdicts: [] };
  if (claims.length > 12) throw new AiChatError("RAG_STATUS_VERIFICATION_INVALID", "待核对的范围末状态过多，请缩小日期范围");
  const evidence = evidenceMessages.at(-1)?.content;
  if (!evidence) throw new AiChatError("RAG_STATUS_VERIFICATION_INVALID", "范围末状态缺少核对材料，请重试");
  const validSources = new Set([...evidence.matchAll(/\[(S\d+)\]/g)].map(match => match[1]));
  const messages: ChatMessage[] = [
    { role: "system", content: "你是学习日志结论核对器。只依据用户提供的按日期排列的[S编号]原文，判断每条‘截至所问范围末仍待解决’的结论。supported表示范围末仍有原文支持且后续没有明确解决或取代；outdated表示只反映较早状态，后续记录已明确开始、补上、修复或取代；unclear表示原文不足以判断范围末状态，或不同项目、个人版、通用版身份无法可靠对应。必须按日期顺序核对同一对象，不能把曾失败或待验证自动延续到范围末，也不能因后来没有再提到就认定已经解决。sourceIds只能使用提供的S编号并列出支持判定的最少来源。reason用一句简短中文说明。只输出JSON对象，不要Markdown或额外文字，格式为：{\"claims\":[{\"claimId\":\"C1\",\"verdict\":\"supported|outdated|unclear\",\"sourceIds\":[\"S1\"],\"reason\":\"...\"}]}" },
    { role: "user", content: `${evidence}\n\n待核对结论：\n${claims.map(claim => `${claim.claimId}: ${claim.text}`).join("\n")}` }
  ];
  const text = await request(config, messages,
    { signal, temperature: 0, timeoutMs: 20_000, maxTokens: 2500, responseFormat: "json_object" });
  const verdicts = parseVerdicts(text, claims, validSources);
  return { answer: applyRangeStatusVerdicts(draft, verdicts), verdicts };
}
