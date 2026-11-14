"use client";

type Preview = { provider: string; endpointDisplay: string; model: string; hasKey: boolean };

export function AiSettingsPreview({ preview, busy, onRestore }: { preview: Preview; busy: boolean; onRestore: () => void }) {
  return <section className="settings-preview" aria-label="部署配置">
    <h4>部署配置</h4>
    <dl className="settings-summary">
      <div><dt>服务商</dt><dd>{preview.provider === "deepseek" ? "DeepSeek" : "自定义服务"}</dd></div>
      <div><dt>服务地址</dt><dd>{preview.endpointDisplay || "未设置"}</dd></div>
      <div><dt>模型</dt><dd>{preview.model || "未设置"}</dd></div>
      <div><dt>API Key</dt><dd>{preview.hasKey ? "已设置" : "未设置"}</dd></div>
    </dl>
    <button className="button secondary" type="button" disabled={busy} onClick={onRestore}>确认恢复</button>
  </section>;
}
