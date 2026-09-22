import { AiChatError, requestChat } from "./ai-chat.ts";
import { getLightChatConfig } from "./ai-config.ts";

export async function generateRagSessionTitle(question: string, signal?: AbortSignal): Promise<string> {
  const response = await requestChat(getLightChatConfig(), [
    { role: "system", content: [
      "为知识库问答会话生成一个短语式标题。",
      "中文通常使用4至10个汉字；英文或中英混合标题通常使用2至5个词。",
      "保留必要的英文技术术语，不要强行翻译。",
      "不要使用‘关于’、‘介绍’、‘如何’、‘问题分析’等空泛前缀。",
      "不要回答问题，不要使用引号、句号或Markdown，只返回标题。"
    ].join("\n") },
    { role: "user", content: question.slice(0, 8000) }
  ], { signal, temperature: 0.1 });
  const title = response.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/, "")
    .replace(/^[“”‘’"']+|[“”‘’"'。！？!?]+$/g, "").replace(/\s+/g, " ").trim();
  if (!title || Array.from(title).length > 60 || /[\u0000-\u001f\u007f]/.test(title)) throw new AiChatError("AI_INVALID_TITLE", "模型未返回有效标题");
  return title;
}
