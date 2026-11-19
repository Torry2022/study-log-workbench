import { AiSettingsController } from '../AiSettingsController';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { iconTint } from '../../common/ui/IconTint';
import { expandSection } from '../../common/ui/WorkspaceMotion';

@Component
export struct AiSettingsStatus {
  @ObjectLink data: AiSettingsController;
  @Link detailsOpen: boolean;
  onEdit: () => void = () => {};

  @Builder
  private field(label: string, value: string) {
    Row({ space: 12 }) {
      Text(label).fontSize(14).fontColor($r('app.color.ink')).flexShrink(0)
      Text(value).fontSize(13).fontColor($r('app.color.muted')).layoutWeight(1)
        .wordBreak(WordBreak.BREAK_ALL).textAlign(TextAlign.End)
    }.width('100%').constraintSize({ minHeight: 48 }).padding({ left: 16, right: 16, top: 8, bottom: 8 })
  }

  @Builder
  private action(label: string, id: string, onClick: () => void) {
    Button({ type: ButtonType.Normal }) {
      Row() {
        Text(label).fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1).textAlign(TextAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right'))
          .fontSize(14).fontColor([$r('app.color.muted')])
      }.width('100%')
    }.width('100%').height(48).padding({ left: 16, right: 16 }).backgroundColor(Color.Transparent)
      .borderRadius(0).id(id).onClick(onClick)
  }

  build() {
    Column({ space: 16 }) {
      if (this.data.loading) {
        Row({ space: 8 }) {
          LoadingProgress().width(16).height(16).color($r('app.color.primary'))
          Text('正在读取模型设置…').fontSize(13).fontColor($r('app.color.muted'))
        }.width('100%')
      } else if (this.data.error) {
        Text(this.data.error).id('settings_ai_error').width('100%').fontSize(13).fontColor($r('app.color.error'))
      } else if (this.data.summary) {
        Column({ space: 8 }) {
          Column() {
            Row({ space: 12 }) {
              Image($r('app.media.sparkles')).width(20).height(20).colorFilter(iconTint($r('app.color.primary_active')))
              Text(this.data.summary.provider === 'deepseek' ? 'DeepSeek' : '自定义服务')
                .fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
              Text(this.data.summary.hasEndpoint && this.data.summary.model ? '已设置' : '待设置')
                .fontSize(12).fontColor($r('app.color.muted'))
            }.width('100%').height(60).padding({ left: 16, right: 16 })
            Divider().color($r('app.color.hairline'))
            this.field('模型', this.data.summary.model || '尚未设置')
            Divider().color($r('app.color.hairline'))
            this.field('API Key', this.data.summary.hasKey ? '已保存' : '尚未设置')
            Divider().color($r('app.color.hairline'))
            this.field('轻量任务模型', this.data.summary.lightModel || '沿用主模型')
            if (this.data.writable) {
              Divider().color($r('app.color.hairline'))
              this.action('修改 AI 设置', 'settings_ai_edit', this.onEdit)
            }
          }.width('100%').backgroundColor($r('app.color.surface_soft')).borderRadius(12).clip(true)
            .border({ width: 1, color: $r('app.color.hairline') })
          Text(this.data.writable ? '连接同一工作台的设备共用此设置。' : '模型设置由工作台部署者维护。')
            .fontSize(12).lineHeight(18).fontColor($r('app.color.muted')).width('100%').padding({ left: 4 })
        }.width('100%')
        Column() {
          Button({ type: ButtonType.Normal }) {
            Row() {
              Text('功能状态').fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1).textAlign(TextAlign.Start)
              if (this.detailsOpen) {
                SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(14).fontColor([$r('app.color.muted')])
              } else {
                SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([$r('app.color.muted')])
              }
            }.width('100%')
          }.width('100%').height(48).padding({ left: 16, right: 16 }).backgroundColor(Color.Transparent)
            .borderRadius(0).id('settings_ai_details')
            .onClick(() => expandSection(this.getUIContext(), () => this.detailsOpen = !this.detailsOpen))
          if (this.detailsOpen) {
            Divider().color($r('app.color.hairline'))
            this.field('模型服务', this.data.readiness?.aiConfiguration === undefined ? '请查看服务摘要' :
              this.data.readiness.aiConfiguration.provider.configured ? '已配置' : '待配置')
            this.field('日志生成', this.data.readiness?.features.aiWriting.configured ? '已配置' : '待配置')
            this.field('重点标注', this.data.readiness?.features.aiHighlighting.configured ? '已配置' : '待配置')
            this.field('随记提取', this.data.readiness?.features.aiNoteExtraction.configured ? '已配置' : '待配置')
            this.field('领域整理', this.data.readiness?.features.aiTaxonomy.configured ? '已配置' : '待配置')
            this.field('知识问答', this.data.readiness?.features.rag.configured ? '已配置' : '待配置')
            Text('模板和检索服务由工作台部署者维护。').width('100%').fontSize(12).lineHeight(18)
              .fontColor($r('app.color.muted')).padding({ left: 16, right: 16, bottom: 12 })
            Divider().color($r('app.color.hairline'))
            this.field('服务地址', this.data.summary.endpointDisplay || (this.data.summary.hasEndpoint ? '已设置' : '尚未设置'))
            this.field('配置来源', this.data.summary.source === 'instance' ? '工作台配置' : '部署配置')
            this.field('配置修订', this.data.summary.revision === null ? '部署配置' : String(this.data.summary.revision))
            this.field('上下文容量', this.data.summary.contextWindowTokens || '默认')
            this.field('推理方式', this.data.summary.thinking || '跟随服务')
            this.field('工具调用验证标记', this.data.summary.toolCallingVerified ? '已设置' : '未设置')
            this.field('回答校验标记', this.data.summary.statusVerificationEnabled ? '已设置' : '未设置')
          }
        }.width('100%').backgroundColor($r('app.color.surface_soft')).borderRadius(12).clip(true)
          .border({ width: 1, color: $r('app.color.hairline') })
      } else {
        Text(this.data.support === 'legacy' ? '当前服务器未提供应用内模型设置摘要，已有 AI 功能仍按原配置使用。' :
          this.data.support === 'unsupported' ? '当前客户端无法读取这项设置，请更新客户端。已有工作台功能不受影响。' :
          '暂时无法读取模型配置，请联系工作台部署者检查。')
          .fontSize(14).lineHeight(22).fontColor($r('app.color.muted')).width('100%')
      }
      if (!this.data.loading) {
        ToolbarAction({ label: this.data.error ? '重试' : '重新读取', showIcon: false, segmented: true,
          onAction: () => this.data.load(true) }).id('settings_ai_reload')
      }
    }.width('100%').alignItems(HorizontalAlign.Start).id('settings_ai_status')
  }
}
