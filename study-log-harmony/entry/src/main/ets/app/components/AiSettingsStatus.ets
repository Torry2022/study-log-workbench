import { AiSettingsController } from '../AiSettingsController';
import { apiClient } from '../../common/network/ApiClient';
import { activeInstance } from '../../common/network/InstanceConfig';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { expandSection } from '../../common/ui/WorkspaceMotion';

@Component
export struct AiSettingsStatus {
  @State private data: AiSettingsController = new AiSettingsController(apiClient, () => activeInstance.capabilities);
  @State private detailsOpen: boolean = false;

  aboutToAppear(): void { this.data.load(); }
  aboutToDisappear(): void { this.data.dispose(); }

  @Builder
  private field(label: string, value: string) {
    Column({ space: 4 }) {
      Text(label).fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted')).width('100%')
      Text(value).fontSize(14).fontColor($r('app.color.ink')).width('100%')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  build() {
    Column({ space: 16 }) {
      Text('AI 服务').fontSize(18).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).width('100%')
      if (this.data.loading) {
        Row({ space: 8 }) {
          LoadingProgress().width(16).height(16).color($r('app.color.primary'))
          Text('正在读取模型设置…').fontSize(13).fontColor($r('app.color.muted'))
        }.width('100%')
      } else if (this.data.error) {
        Text(this.data.error).id('settings_ai_error').width('100%').fontSize(13).fontColor($r('app.color.error'))
      } else if (this.data.summary) {
        Text('当前客户端仅查看此工作台的模型设置；如需修改，请联系部署者。')
          .fontSize(14).lineHeight(22).fontColor($r('app.color.muted')).width('100%')
        this.field('服务商', this.data.summary.provider === 'deepseek' ? 'DeepSeek' : '自定义服务')
        this.field('模型', this.data.summary.model || '尚未设置')
        this.field('API Key', this.data.summary.hasKey ? '已设置' : '尚未设置')
        this.field('服务地址', this.data.summary.endpointDisplay || (this.data.summary.hasEndpoint ? '地址已设置，格式需由部署者检查' : '尚未设置'))
        this.field('配置来源', this.data.summary.source === 'instance' ? '工作台配置' : '部署配置')
        ToolbarAction({ label: this.detailsOpen ? '收起详细状态' : '查看详细状态', showIcon: false,
          onAction: () => expandSection(this.getUIContext(), () => this.detailsOpen = !this.detailsOpen) })
          .id('settings_ai_details')
        if (this.detailsOpen) {
          this.field('配置修订', this.data.summary.revision === null ? '部署配置（无修订号）' : String(this.data.summary.revision))
          this.field('轻量任务模型', this.data.summary.lightModel || '沿用主模型')
          this.field('上下文容量声明', this.data.summary.contextWindowTokens || '未声明')
          this.field('推理参数', this.data.summary.thinking || '未设置')
          this.field('工具调用验证标记', this.data.summary.toolCallingVerified ? '已设置' : '未设置')
          this.field('回答校验标记', this.data.summary.statusVerificationEnabled ? '已设置' : '未设置')
          Text('配置与验证标记不代表所有功能已经就绪；模型、模板和检索各有自己的依赖。')
            .fontSize(12).lineHeight(18).fontColor($r('app.color.muted')).width('100%')
        }
      } else {
        Text(this.data.support === 'legacy' ? '当前服务器未提供应用内模型设置摘要，已有 AI 功能仍按原配置使用。' :
          this.data.support === 'unsupported' ? '当前客户端暂不支持此设置协议，已有工作台功能不受影响。' :
          '工作台模型配置暂不可读取，请由部署者检查配置文件和目录权限。')
          .fontSize(14).lineHeight(22).fontColor($r('app.color.muted')).width('100%')
      }
      Text(this.data.summary?.source === 'instance' ?
        '此实例以私有目录的工作台配置为准，请由部署者使用配置维护流程调整；修改旧环境变量不会替换已提交配置。完整接口路径和密钥不在客户端展示。' :
        this.data.summary?.source === 'deployment' ?
        '当前沿用服务器部署配置，请由部署者按部署说明调整并使其生效。完整接口路径和密钥不在客户端展示。' :
        '请由部署者参照部署说明检查配置来源和目录权限；显示的服务来源地址不能当作完整接口地址回填。')
        .fontSize(12).lineHeight(18).fontColor($r('app.color.muted')).width('100%')
      ToolbarAction({ label: '重新读取', showIcon: false, busy: this.data.loading,
        onAction: () => this.data.load(true) }).id('settings_ai_reload')
    }.width('100%').alignItems(HorizontalAlign.Start).id('settings_ai_status')
  }
}
