import { SourceError } from "./paths.mjs";

const text = { type: "string", maxLength: 60000 };
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", maxLength: 10 };
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const retrieval = { dateFrom: date, dateTo: date,
  strategy: { type: "string", enum: ["relevance", "timeline_summary", "comparison"] }, rerank: { type: "boolean" } };
const tool = (name, description, properties, required = []) => ({ name, description,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: { type: "object", properties, required, additionalProperties: false } });
export const tools = [
  tool("list_months", "列出原始日志月份和日期范围。", {}),
  tool("list_days", "列出指定月份原始日志的日块摘要。", { month: { type: "string", pattern: "^\\d{4}-\\d{2}$", maxLength: 7 } }, ["month"]),
  tool("get_day", "读取原始 Markdown 日块，不修改日志。", { date, maxChars: integer(1, 100000) }, ["date"]),
  tool("search_logs", "按连续字面文本搜索原始日志。", { query: text, ignoreCase: { type: "boolean" }, maxResults: integer(1, 50), contextLines: integer(0, 4) }, ["query"]),
  tool("find_related", "检索相关日志小节并按日期聚合；未配置向量模型时使用关键词。", { input: { ...text, minLength: 1 }, maxResults: integer(1, 20), ...retrieval }, ["input"]),
  tool("retrieve_contexts", "返回可定位的原始日志证据；支持日期范围、字面查找、相关度、时间覆盖和主题比较。", {
    input: { ...text, minLength: 1 }, maxChunks: integer(1, 20), maxChars: integer(1000, 30000), ...retrieval,
    matchMode: { type: "string", enum: ["hybrid", "literal"] }, literalQuery: text }, ["input"]),
  tool("get_recent_context", "返回最近有效日块的摘要。", { limit: integer(1, 30) }),
  tool("get_style_examples", "读取调用者指定日期或最近有效日块作为写作样例；不预设个人日期和风格。", {
    dates: { type: "array", items: date, maxItems: 30 }, maxChars: integer(1, 100000) })
];

function valid(value, schema) {
  if (schema.type === "string") return typeof value === "string" && value.length <= (schema.maxLength ?? Infinity) && value.length >= (schema.minLength ?? 0) && (!schema.enum || schema.enum.includes(value)) && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (schema.type === "integer") return Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "array") return Array.isArray(value) && value.length <= schema.maxItems && value.every(item => valid(item, schema.items));
  return false;
}
export function validateToolArguments(name, args) {
  const definition = tools.find(item => item.name === name);
  if (!definition) throw new SourceError("Unknown tool.", "INVALID_ARGUMENT");
  const { properties, required } = definition.inputSchema;
  if (!args || typeof args !== "object" || Array.isArray(args) || required.some(key => !Object.hasOwn(args, key)) || Object.entries(args).some(([key, value]) => !Object.hasOwn(properties, key) || !valid(value, properties[key]))) throw new SourceError("Invalid tool arguments.", "INVALID_ARGUMENT");
}
