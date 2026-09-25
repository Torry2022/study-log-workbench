import { bundleManager, common } from '@kit.AbilityKit';
import { AppLogo } from '../../common/ui/AppLogo';
import { AppModalScrim } from '../../common/ui/AppModalScrim';
import { util } from '@kit.ArkTS';
import { KeyCode } from '@kit.InputKit';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { workspaceSerifFamily } from '../../common/ui/Typography';

interface BundledLicense {
  value: string;
  path: string;
}

const LICENSES: BundledLicense[] = [
  { value: '编辑器及其依赖', path: 'editor/LICENSES.txt' },
  { value: 'Marked', path: 'markdown/licenses/marked-LICENSE.md' },
  { value: 'DOMPurify', path: 'markdown/licenses/dompurify-LICENSE.txt' },
  { value: 'KaTeX', path: 'markdown/licenses/katex-LICENSE.txt' },
  { value: 'Mermaid', path: 'markdown/licenses/mermaid-LICENSE.txt' },
  { value: 'Lucide 图标', path: 'markdown/licenses/lucide.txt' },
  { value: 'Gelasio 字体', path: 'fonts/OFL-Gelasio.txt' },
  { value: 'JetBrains Mono 字体', path: 'fonts/OFL-JetBrains-Mono.txt' },
  { value: 'Noto Serif CJK 字体', path: 'fonts/OFL-Noto-Serif-CJK.txt' },
  { value: 'Paper Mono 字体', path: 'fonts/OFL-Paper-Mono.txt' },
  { value: '思源宋体', path: 'fonts/OFL-Source-Han-Serif.txt' }
];

@Component
export struct AboutPanel {
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  onClose: () => void = () => {};
  @State private version: string = '';
  @State private licensesOpen: boolean = false;
  @State private licenseIndex: number = 0;
  @State private licenseText: string = '';
  private licenseScroller: Scroller = new Scroller();
  private loadRevision: number = 0;

  aboutToAppear(): void {
    const info = bundleManager.getBundleInfoForSelfSync(0);
    this.version = `版本 ${info.versionName} · 构建号 ${info.versionCode}`;
  }

  aboutToDisappear(): void {
    this.loadRevision++;
  }

  private async loadLicense(index: number): Promise<void> {
    this.licenseIndex = index;
    this.licenseText = '正在读取许可…';
    const revision = ++this.loadRevision;
    this.licenseScroller.scrollTo({ xOffset: 0, yOffset: 0 });
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const content = await context.resourceManager.getRawFileContent(LICENSES[index].path);
      if (revision === this.loadRevision) this.licenseText = new util.TextDecoder('utf-8').decodeToString(content);
    } catch (_) {
      if (revision === this.loadRevision) this.licenseText = '许可读取失败，请重新选择后重试。';
    }
  }

  @Builder
  private header() {
    Row({ space: 12 }) {
      AppLogo({ iconSize: 40, cornerRadius: 8 })
      Text(this.licensesOpen ? '开源许可' : '关于')
        .fontFamily(workspaceSerifFamily(this.breakpoint)).fontSize(28)
        .fontColor($r('app.color.ink')).layoutWeight(1)
      ToolbarAction({ label: '关闭关于', showLabel: false, useSymbol: true,
        symbol: $r('sys.symbol.xmark'), controlHeight: 36, iconWidth: 36,
        onAction: this.onClose }).id('about_close_button')
    }.width('100%').padding(20)
      .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      AppModalScrim({ onDismiss: this.onClose })
      Column() {
        this.header()
        if (this.licensesOpen) {
          Column({ space: 12 }) {
            Select(LICENSES.map((license: BundledLicense): SelectOption => ({ value: license.value })))
              .selected(this.licenseIndex).value(LICENSES[this.licenseIndex].value)
              .font({ size: 14 }).fontColor($r('app.color.body'))
              .backgroundColor($r('app.color.surface_soft')).width('100%')
              .id('about_license_select').onSelect((index: number) => this.loadLicense(index))
            Scroll(this.licenseScroller) {
              Text(this.licenseText).fontSize(13).lineHeight(20).fontColor($r('app.color.body'))
                .copyOption(CopyOptions.LocalDevice).width('100%').id('about_license_text')
            }.width('100%').layoutWeight(1).scrollBar(BarState.Auto)
            Row() {
              ToolbarAction({ label: '返回关于', showIcon: false, onAction: () => {
                this.licensesOpen = false;
                setTimeout(() => focusControl.requestFocus('about_licenses_button'), 20);
              } }).id('about_back_button')
            }.width('100%').justifyContent(FlexAlign.End)
          }.width('100%').layoutWeight(1).padding(20)
        } else {
          Column({ space: 8 }) {
            Text('学习日志工作台').fontSize(18).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
            Text('公开自部署版 · 个人学习与知识管理工作台').fontSize(14).fontColor($r('app.color.muted'))
            Text(this.version).fontSize(13).fontColor($r('app.color.body'))
              .copyOption(CopyOptions.LocalDevice).margin({ top: 8 }).id('about_version')
            Row() {
              ToolbarAction({ label: '开源许可', showIcon: false, onAction: () => {
                this.licensesOpen = true;
                this.loadLicense(0);
                setTimeout(() => focusControl.requestFocus('about_license_select'), 20);
              } }).id('about_licenses_button')
            }.width('100%').justifyContent(FlexAlign.End).margin({ top: 12 })
          }.width('100%').padding(20).alignItems(HorizontalAlign.Start)
        }
      }.width('88%').constraintSize({ maxWidth: this.licensesOpen ? 720 : 460 })
        .height(this.licensesOpen ? '80%' : undefined)
        .backgroundColor($r('app.color.canvas')).borderRadius(12)
        .border({ width: 1, color: $r('app.color.hairline') })
        .shadow({ radius: 22, color: $r('app.color.popover_shadow'), offsetY: 8 })
        .onClick(() => {})
    }.width('100%').height('100%')
      .onKeyEvent((event: KeyEvent) => {
        if (event.type !== KeyType.Down || event.keyCode !== KeyCode.KEYCODE_ESCAPE) return;
        event.stopPropagation();
        this.onClose();
      })
      .onAppear(() => setTimeout(() => focusControl.requestFocus('about_close_button'), 20))
  }
}
