import { ToolbarAction } from '../../../common/ui/ToolbarAction';
import { SegmentIndicator } from '../../../common/ui/SegmentIndicator';
import { InteractiveSurface, animateHover } from '../../../common/ui/InteractiveSurface';
import { iconTint } from '../../../common/ui/IconTint';
import { KeyCode } from '@kit.InputKit';

@Component
export struct LogAiPanel {
  @Link mode: string;
  @Prop instruction: string = '';
  @Prop material: string = '';
  @Prop output: string = '';
  onInstruction: (value: string) => void = () => {};
  onMaterial: (value: string) => void = () => {};
  onOutput: (value: string) => void = () => {};
  @Prop busy: boolean = false;
  @Prop importing: boolean = false;
  @Prop ready: boolean = false;
  @Prop generateConfigured: boolean = false;
  @Prop highlightConfigured: boolean = false;
  @Prop canHighlight: boolean = false;
  @Prop canApply: boolean = false;
  @Prop message: string = '';
  @Prop desktop: boolean = false;
  @State private panelWidth: number = 380;
  @State private hovered: string = '';
  onClose: () => void = () => {};
  onImport: () => void = () => {};
  onGenerate: () => void = () => {};
  onHighlight: () => void = () => {};
  onApply: () => void = () => {};

  @Builder
  private tab(mode: string, label: string, icon: Resource) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 6 }) {
        if (!this.desktop || this.panelWidth >= 260) {
          Image(icon).width(15).height(15).colorFilter(iconTint(
            this.mode === mode ? $r('app.color.primary') : $r('app.color.muted')))
        }
        Text(label).fontSize(13).fontWeight(FontWeight.Medium)
          .fontColor(this.mode === mode ? $r('app.color.ink') : $r('app.color.muted'))
      }
    }.layoutWeight(1).height(38).padding(0).borderRadius(6).clip(true)
      .attributeModifier(new InteractiveSurface(Color.Transparent, this.hovered === mode, this.mode === mode))
      .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hovered = hover ? mode : ''))
      .onClick(() => this.mode = mode).id(`log_ai_tab_${mode}`)
  }

  @Builder
  private label(value: string) {
    Text(value).fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted')).width('100%')
  }

  @Builder
  private action(label: string, icon: Resource, enabled: boolean, action: () => void, primary: boolean = true) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        Image(icon).width(15).height(15).colorFilter(iconTint(primary ? $r('app.color.on_primary') : $r('app.color.body')))
        Text(label).fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(primary ? $r('app.color.on_primary') : $r('app.color.body'))
      }
    }.width('100%').height(40).padding(0)
      .backgroundColor(primary ? $r('app.color.primary') : $r('app.color.surface_soft'))
      .border({ width: primary ? 0 : 1, color: $r('app.color.hairline') })
      .borderRadius(8).clip(true)
      .enabled(enabled).onClick(action)
  }

  build() {
    Column() {
      Row({ space: 8 }) {
        Stack() {
          SegmentIndicator({ selected: this.mode === 'generate' ? 0 : 1, inset: 2 })
          Row() {
            this.tab('generate', 'AI生成', $r('app.media.wand_sparkles'))
            this.tab('highlight', '重点标注', $r('app.media.edit_3'))
          }.width('100%').height('100%').padding(2)
        }.layoutWeight(1).height(42).backgroundColor($r('app.color.surface_soft'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
        ToolbarAction({ label: this.desktop ? '收起右侧栏' : '关闭 AI 工具', showLabel: false,
          useSymbol: true, symbol: this.desktop ? $r('sys.symbol.chevron_forward') : $r('sys.symbol.xmark'),
          segmented: true, controlHeight: 42, iconWidth: 38, onAction: this.onClose }).id('log_ai_close_button')
      }.width('100%').height(this.desktop ? 64 : undefined)
        .padding({ left: 14, right: 14, top: this.desktop ? 0 : 14, bottom: this.desktop ? 0 : 14 })
        .alignItems(VerticalAlign.Center).id('log_ai_header')
        .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
      Scroll() {
        Column({ space: 12 }) {
          if (this.mode === 'generate') {
            this.label('补充要求')
            TextArea({ text: this.instruction, placeholder: '例如：简写、突出项目实践、保留术语' })
              .width('100%').height(64).padding({ left: 12, right: 12, top: 10, bottom: 10 })
              .fontSize(14).lineHeight(21).fontColor($r('app.color.body')).placeholderColor($r('app.color.muted'))
              .backgroundColor($r('app.color.surface_soft')).borderRadius(8)
              .border({ width: 1, color: $r('app.color.hairline') })
              .onChange((value: string) => this.onInstruction(value)).id('log_ai_instruction')
            Row({ space: 8 }) {
              Text('学习材料').layoutWeight(1).fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted'))
              ToolbarAction({ label: this.importing ? '导入中' : '导入文件', icon: $r('app.media.upload'), iconSize: 14,
                controlHeight: 30, available: !this.importing && !this.busy, onAction: this.onImport }).id('log_ai_import')
            }.width('100%')
            TextArea({ text: this.material, placeholder: '粘贴笔记、代码片段、课程内容或项目进展' })
              .width('100%').height(210).padding(12).fontFamily('JetBrains Mono')
              .fontSize(13).lineHeight(21).fontColor($r('app.color.body')).placeholderColor($r('app.color.muted'))
              .backgroundColor($r('app.color.surface_soft')).borderRadius(8)
              .border({ width: 1, color: $r('app.color.hairline') })
              .onChange((value: string) => this.onMaterial(value)).id('log_ai_material')
            this.action(this.busy ? '生成中' : '生成日志草稿', $r('app.media.wand_sparkles'),
              this.ready && this.generateConfigured && !this.busy && !this.importing &&
                !!(this.material.trim() || this.instruction.trim()), this.onGenerate)
            this.label('生成草稿')
            TextArea({ text: this.output, placeholder: this.busy ? '正在生成，请稍候…' : '生成的草稿将在这里显示' })
              .width('100%').height(260).padding(12).fontFamily('JetBrains Mono')
              .fontSize(13).lineHeight(21).fontColor($r('app.color.body')).placeholderColor($r('app.color.muted'))
              .backgroundColor($r('app.color.surface_soft')).borderRadius(8)
              .border({ width: 1, color: $r('app.color.hairline') }).enabled(!this.busy)
              .onChange((value: string) => this.onOutput(value)).id('log_ai_output')
            this.action('确认写入', $r('app.media.check'), !this.busy && this.canApply,
              this.onApply, false)
          } else {
            Column({ space: 8 }) {
              Text('AI 文本增强').fontSize(11).fontColor($r('app.color.primary'))
              Text('为当前日块标注重点').fontSize(18).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
              Text('从技术含义判断核心概念、关键机制、参数指标和结论，只插入 Markdown 加粗标记，不改写原文。')
                .fontSize(13).lineHeight(21).fontColor($r('app.color.muted'))
            }.width('100%').padding(14).alignItems(HorizontalAlign.Start)
              .backgroundColor($r('app.color.surface_soft')).borderRadius(8)
              .border({ width: 1, color: $r('app.color.hairline') })
            this.action(this.busy ? '标注中' : '标注重点', $r('app.media.edit_3'),
              this.ready && this.highlightConfigured && !this.busy && this.canHighlight, this.onHighlight)
            Text('标注结果会先进入差异查看，确认后只替换当前编辑草稿，不会自动保存到 Markdown 文件。')
              .width('100%').fontSize(12).lineHeight(19).fontColor($r('app.color.muted'))
          }
          if (this.message) {
            Text(this.message).fontSize(12).lineHeight(19).fontColor($r('app.color.muted')).width('100%')
          }
        }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
      }.width('100%').layoutWeight(1).scrollBar(BarState.Auto).align(Alignment.TopStart).id('log_ai_scroll')
    }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
      .onAreaChange((_oldArea, area) => this.panelWidth = Number(area.width))
      .border({ width: { left: this.desktop ? 1 : 0 }, color: $r('app.color.hairline') })
      .onKeyEvent((event: KeyEvent) => {
        if (event.type === KeyType.Down && event.keyCode === KeyCode.KEYCODE_ESCAPE) {
          event.stopPropagation(); this.onClose();
        }
      })
  }
}
