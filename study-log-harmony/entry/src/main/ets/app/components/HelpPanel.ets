import { AppModalScrim } from '../../common/ui/AppModalScrim';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { workspaceCodeFamily, workspaceSerifFamily } from '../../common/ui/Typography';
import { iconTint } from '../../common/ui/IconTint';
import { WORKSPACE_TIPS } from '../../common/ui/WorkspaceTips';

@Component
export struct HelpPanel {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  onClose: () => void = () => {};

  private isLargeWorkspace(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  @Builder
  private helpAction(title: string, description: string) {
    Column({ space: 4 }) {
      Text(title).width('100%').fontSize(13).fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.body_strong'))
      Text(description).width('100%').fontSize(12).lineHeight(19).fontColor($r('app.color.muted'))
    }
    .width('49%').constraintSize({ minHeight: 82 }).padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .margin({ bottom: 8 })
    .alignItems(HorizontalAlign.Start).backgroundColor($r('app.color.surface_soft'))
    .border({ width: 1, color: $r('app.color.hairline_soft') }).borderRadius(8)
  }

  @Builder
  private helpLinkExample(code: string, description: string) {
    Row({ space: 10 }) {
      Text(code).layoutWeight(1).padding({ left: 7, right: 7, top: 5, bottom: 5 })
        .fontFamily(workspaceCodeFamily(this.workspaceBreakpoint)).fontSize(11).fontColor($r('app.color.body_strong'))
        .backgroundColor($r('app.color.canvas')).borderRadius(4).maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(description).fontSize(11).fontColor($r('app.color.muted')).maxLines(1)
    }.width('100%')
  }

  @Builder
  private helpShortcut(keys: string, action: string, note: string = '') {
    Row({ space: 10 }) {
      Text(keys).width(118).constraintSize({ minHeight: 24 }).padding({ left: 7, right: 7, top: 4, bottom: 4 })
        .fontFamily(workspaceCodeFamily(this.workspaceBreakpoint)).fontSize(10).fontColor($r('app.color.body_strong'))
        .backgroundColor($r('app.color.surface_soft'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(4).maxLines(1)
      Column({ space: 1 }) {
        Text(action).width('100%').fontSize(11).fontColor($r('app.color.body'))
        if (note) Text(note).width('100%').fontSize(10).fontColor($r('app.color.muted_soft'))
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }
    .width('100%').constraintSize({ minHeight: 34 }).padding({ top: 4, bottom: 4 })
    .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
  }

  @Builder
  private globalHelpShortcuts() {
    Column() {
      Text('全局').width('100%').fontSize(12).fontWeight(FontWeight.Bold).fontColor($r('app.color.muted'))
        .margin({ bottom: 4 })
      this.helpShortcut('Ctrl + Shift + F', '聚焦顶部搜索')
      this.helpShortcut('Ctrl + G', '跳转日志日期', '编辑器内用于下一个匹配项')
      this.helpShortcut('Ctrl + Alt + N', '选择新建日期')
      this.helpShortcut('Ctrl + Alt + Q', '新建知识问答')
      this.helpShortcut('F1', '打开使用帮助')
      this.helpShortcut('F6 / Shift + F6', '切换工作区焦点')
      this.helpShortcut('Alt / F10', '聚焦 PC 菜单栏', '方向键选择，Enter 执行')
      this.helpShortcut('Esc', '关闭最上层浮层', '没有浮层时退出阅读模式')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private readingHelpShortcuts() {
    Column() {
      Text('搜索与阅读').width('100%').fontSize(12).fontWeight(FontWeight.Bold).fontColor($r('app.color.muted'))
        .margin({ bottom: 4 })
      this.helpShortcut('↑ / ↓ · Enter', '选择并打开搜索结果')
      this.helpShortcut('Alt + ← / →', '上一篇 / 下一篇日志', '浏览模式，输入框外')
      this.helpShortcut('Alt + ↑', '返回当前阅读区顶部', '输入框外')
      this.helpShortcut('Ctrl + S', '保存当前日志或随记')
      this.helpShortcut('Ctrl + F', '打开查找与替换', '源码或分屏模式')
      this.helpShortcut('F3 / Shift + F3', '下一个 / 上一个匹配项')
      this.helpShortcut('Ctrl + G / Ctrl + Shift + G', '下一个 / 上一个匹配项', '编辑器或查找面板内')
      this.helpShortcut('Ctrl + Z / Ctrl + Shift + Z', '撤销 / 重做', '编辑器内')
      this.helpShortcut('Ctrl + B / I / `', '加粗 / 斜体 / 行内代码', '日志编辑器内')
      this.helpShortcut('Ctrl + K / Ctrl + Shift + K', '插入链接 / 内部链接', '日志编辑器内')
      this.helpShortcut('Ctrl + Alt + 3', '切换三级标题', '日志编辑器内')
      this.helpShortcut('Tab / Shift + Tab', '缩进 / 取消缩进', '日志编辑器内')
      this.helpShortcut('Ctrl + Alt + G', '跳转行号', '日志编辑器内')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private qaHelpShortcuts() {
    Column() {
      Text('知识问答').width('100%').fontSize(12).fontWeight(FontWeight.Bold).fontColor($r('app.color.muted'))
        .margin({ bottom: 4 })
      this.helpShortcut('Enter', '发送问题')
      this.helpShortcut('Shift + Enter', '输入换行', '中文输入法确认候选时不发送')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private helpDialogHeader() {
    Row({ space: 12 }) {
      Row() {
        Image($r('app.media.circle_help')).width(20).height(20).colorFilter(iconTint($r('app.color.primary')))
      }.width(38).height(38).justifyContent(FlexAlign.Center)
        .backgroundColor($r('app.color.surface_soft'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
      Column({ space: 2 }) {
        Text('使用帮助').fontFamily(workspaceSerifFamily(this.workspaceBreakpoint)).fontSize(28).fontColor($r('app.color.ink'))
        Text('常用操作与快捷键').fontSize(11).fontColor($r('app.color.muted'))
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Button({ type: ButtonType.Normal }) {
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([$r('app.color.ink')])
      }.width(36).height(36).padding(0)
        .backgroundColor($r('app.color.surface_soft'))
        .border({ width: 1, color: $r('app.color.hairline') })
        .borderRadius(8).clip(true)
        .key('help_close_button').accessibilityText('关闭帮助').bindTips('关闭帮助', WORKSPACE_TIPS).onClick(() => this.onClose())
    }
    .width('100%').height(68).padding({ left: 20, right: 20 })
    .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
  }

  @Builder
  private desktopHelpDialog() {
    Column() {
      this.helpDialogHeader()
      Scroll() {
        Column({ space: 18 }) {
          Column({ space: 9 }) {
            Text('常用操作').width('100%').fontSize(14).fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.ink'))
            Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
              this.helpAction('日块与源文件', '左侧按日块操作，保存时只写回该日块，月度或年度 Markdown 源文件仍保持完整。')
              this.helpAction('阅读与编辑', '浏览、源码、分栏会延续当前内容；离开未保存的日志前会先请求确认。')
              this.helpAction('搜索与定位', '顶部搜索用于全文检索；左栏标题搜索只在当前月份内定位日块；日期按钮可直接跳转。')
              this.helpAction('收藏与问答', '收藏日志小节后可分组管理；知识问答的来源条目可回到对应日志。')
              this.helpAction('备份恢复', '备份入口只恢复当前日块的历史内容，恢复前会保留当前版本，不会覆盖整份源文件。')
            }.width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start)

          Row({ space: 18 }) {
            Row({ space: 10 }) {
              SymbolGlyph($r('sys.symbol.link')).fontSize(18).fontColor([$r('app.color.primary')])
              Column({ space: 3 }) {
                Text('内部链接').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
                Text('在源码区按以下格式填写，可跳转到指定日块或小节。')
                  .fontSize(11).lineHeight(18).fontColor($r('app.color.muted'))
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            }.layoutWeight(1).alignItems(VerticalAlign.Top)
            Column({ space: 6 }) {
              this.helpLinkExample('[[2026-06-01]]', '跳转到指定日块')
              this.helpLinkExample('[[2026-06-01#Coding Agent]]', '跳转到指定小节')
              this.helpLinkExample('[[2026-06-01#Coding Agent|阅读笔记]]', '自定义显示文字')
            }.layoutWeight(1)
          }
          .width('100%').padding(14).alignItems(VerticalAlign.Top)
          .backgroundColor($r('app.color.primary_tint'))
          .border({ width: 1, color: $r('app.color.wiki_selected_border') }).borderRadius(8)

          Column({ space: 9 }) {
            Text('快捷键').width('100%').fontSize(14).fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.ink'))
            Row({ space: 18 }) {
              Column({ space: 16 }) {
                this.globalHelpShortcuts()
              }.layoutWeight(1)
              Column({ space: 16 }) {
                this.readingHelpShortcuts()
                this.qaHelpShortcuts()
              }.layoutWeight(1)
            }.width('100%').alignItems(VerticalAlign.Top)
          }.width('100%').alignItems(HorizontalAlign.Start)
        }.width('100%').padding(20).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Auto).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
    }
    .width('76%').height('84%').constraintSize({ maxWidth: 980, maxHeight: 780 })
    .backgroundColor($r('app.color.canvas'))
    .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(12)
    .shadow({ radius: 22, color: $r('app.color.popover_shadow'), offsetY: 8 })
  }

  @Builder
  private compactHelpDialog() {
    Column({ space: 12 }) {
      Row() {
        Text('使用帮助').fontFamily(workspaceSerifFamily(this.workspaceBreakpoint)).fontSize(24)
          .fontColor($r('app.color.ink')).layoutWeight(1)
        Button({ type: ButtonType.Normal }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([$r('app.color.ink')])
        }.width(36).height(36).padding(0).borderRadius(8).clip(true)
          .backgroundColor($r('app.color.surface_soft')).key('help_close_button')
          .accessibilityText('关闭帮助').bindTips('关闭帮助', WORKSPACE_TIPS).onClick(() => this.onClose())
      }.width('100%')
      Text('从屏幕左侧内缘向右滑，或点左上角按钮打开日期导航。日志或随记有未保存修改时，离开前会提示确认。可在随记页选择材料，提取候选后逐条审阅。')
        .width('100%').fontSize(14).lineHeight(23).fontColor($r('app.color.body'))
      Button('知道了').width('100%').height(42).fontSize(14).fontWeight(FontWeight.Medium).borderRadius(8)
        .fontColor($r('app.color.on_primary')).backgroundColor($r('app.color.primary'))
        .onClick(() => this.onClose())
    }.width('88%').padding(18).backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(10)
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      AppModalScrim({ onDismiss: this.onClose })
      if (this.isLargeWorkspace()) this.desktopHelpDialog()
      else this.compactHelpDialog()
    }.width('100%').height('100%')
  }
}
