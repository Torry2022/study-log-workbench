import test from "node:test";
import assert from "node:assert/strict";
import { appendMaterial, writingInputProblem, writingConfigurationMessages } from "../lib/writing-view.ts";

test("ordered material imports append to text entered while extraction was pending", () => {
  let material = "原输入\n上传期间继续写";
  material = appendMaterial(material, { fileName: "first.md", text: "首个文件" });
  material += "\n第二次继续写";
  material = appendMaterial(material, { fileName: "second.txt", text: "第二个文件" });
  assert.equal(material, "原输入\n上传期间继续写\n\n[文件：first.md]\n首个文件\n第二次继续写\n\n[文件：second.txt]\n第二个文件");
});
test("generation limits explain blocked input without truncating materials in the editor", () => {
  assert.equal(writingInputProblem("2026-09-13", "2026-09-22", "", "只有要求也可以"), "");
  assert.match(writingInputProblem("2026-09-23", "2026-09-22", "材料", ""), /未来/);
  assert.match(writingInputProblem("2026-09-13", "2026-09-22", "a".repeat(120001), ""), /120,000/);
  assert.match(writingInputProblem("2026-09-13", "2026-09-22", "材料", "a".repeat(4001)), /4,000/);
});
test("configuration diagnostics distinguish unavailable service, provider and generation template", () => {
  assert.match(writingConfigurationMessages({ features: { aiWriting: { supported: false, configured: false } } })[0], /仍可导入/);
  const diagnostics = { features: { aiWriting: { supported: true, configured: false } }, aiConfiguration: { provider: { configured: false, issues: [{ message: "请配置模型" }] }, templates: { generation: { configured: false, issue: { message: "生成模板为空" } } } } };
  assert.deepEqual(writingConfigurationMessages(diagnostics), ["请配置模型", "生成模板为空"]);
  assert.deepEqual(writingConfigurationMessages({ features: { aiWriting: { supported: true, configured: true } } }), []);
});
