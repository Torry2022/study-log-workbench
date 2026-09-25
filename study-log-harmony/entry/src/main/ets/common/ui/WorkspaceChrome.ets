import { WorkspaceBreakpoint } from '../AppConfig';
import { WORKSPACE_TIPS } from './WorkspaceTips';
import { workspaceSansFamily, workspaceSerifFamily } from './Typography';

export const MODULE_HEADER_LEFT_INSET: number = 24;

@Component
export struct ActionPanelHeader {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop title: string = '';
  @Prop closeLabel: string = '关闭面板';
  @Prop showDragBar: boolean = false;
  onClose: () => void = () => {};

  build() {
    Column() {
      if (this.showDragBar) {
      Row()
        .width(38)
        .height(4)
        .borderRadius(2)
        .backgroundColor($r('app.color.hairline'))
        .margin({ bottom: 10 })
      }
      Row() {
        Text(this.title)
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.ink'))
          .layoutWeight(1)
        Button({ type: ButtonType.Normal }) {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(17)
            .fontColor([$r('app.color.ink')])
        }
        .width(40)
        .height(40)
        .padding(0)
        .backgroundColor($r('app.color.surface_soft'))
        .border({ width: 1, color: $r('app.color.hairline') })
        .borderRadius(8)
        .clip(true)
        .accessibilityText(this.closeLabel).bindTips(this.closeLabel, WORKSPACE_TIPS)
        .onClick(this.onClose)
      }
      .width('100%')
      .height(48)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }
}

@Component
export struct SearchPageHeader {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop title: string = '';
  @Prop backLabel: string = '返回';
  onBack: () => void = () => {};

  build() {
    Row() {
      Button({ type: ButtonType.Normal }) {
        SymbolGlyph($r('sys.symbol.chevron_backward')).fontSize(20).fontColor([$r('app.color.ink')])
      }
      .width(42).height(42).padding(0).borderRadius(8).clip(true)
      .backgroundColor(Color.Transparent).accessibilityText(this.backLabel).bindTips(this.backLabel, WORKSPACE_TIPS).onClick(this.onBack)
      Row() {
        Text(this.title)
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontSize(17)
          .lineHeight(22)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.ink'))
          .textAlign(TextAlign.Center)
      }
      .height(42)
      .alignItems(VerticalAlign.Center)
      .justifyContent(FlexAlign.Center)
      .layoutWeight(1)
      Blank().width(42)
    }
    .width('100%').height(56).padding({ left: 8, right: 8 })
    .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
  }
}

@Component
export struct ModuleLogButton {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  onOpenLog: () => void = () => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 6 }) {
        SymbolGlyph($r('sys.symbol.doc_text'))
          .fontSize(16)
          .fontColor([$r('app.color.body')])
        Text('日志')
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.body'))
      }
    }
    .height(38)
    .padding({ left: 12, right: 12 })
    .backgroundColor($r('app.color.canvas'))
    .border({ width: 1, color: $r('app.color.hairline') })
    .borderRadius(8)
    .clip(true)
    .accessibilityText('返回日志').bindTips('返回日志', WORKSPACE_TIPS)
    .onClick(this.onOpenLog)
  }
}

@Component
export struct ModulePageTitle {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop title: string = '';

  build() {
    Text(this.title).fontFamily(workspaceSerifFamily(this.workspaceBreakpoint))
      .fontSize(28).lineHeight(36).fontWeight(FontWeight.Bold)
      .fontColor($r('app.color.ink')).maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
  }
}

@Component
export struct ModulePageHeader {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop title: string = '';
  @Prop headerId: string = '';
  onOpenLog: () => void = () => {};

  build() {
    Row({ space: 16 }) {
      ModulePageTitle({ title: this.title }).layoutWeight(1)
      ModuleLogButton({ onOpenLog: this.onOpenLog })
    }
    .id(this.headerId)
    .width('100%').height(64).padding({ left: MODULE_HEADER_LEFT_INSET, right: 16 })
    .alignItems(VerticalAlign.Center)
    .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
  }
}

@Component
export struct SectionHeading {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop title: string = '';
  @Prop description: string = '';

  build() {
    Column({ space: 4 }) {
      Text(this.title)
        .width('100%')
        .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.body_strong'))
      if (this.description) {
        Text(this.description)
          .width('100%')
          .fontSize(13)
          .lineHeight(19)
          .fontColor($r('app.color.muted'))
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
