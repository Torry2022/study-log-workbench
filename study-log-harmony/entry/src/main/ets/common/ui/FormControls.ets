import { InteractiveSurface, animateHover } from './InteractiveSurface';
import { textNavigationKey, workspaceKey } from './WorkspaceKeys';
import { KeyCode } from '@kit.InputKit';
import { WorkspaceBreakpoint } from '../AppConfig';
import { WORKSPACE_TIPS } from './WorkspaceTips';
import { workspaceCodeFamily, workspaceSansFamily } from './Typography';
import { iconTint } from './IconTint';

@Component
export struct SearchField {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop value: string = '';
  @Prop placeholder: string = '';
  @Prop focusKey: string = '';
  @Prop @Watch('focusRevisionChanged') focusRevision: number = 0;
  @Prop compact: boolean = false;
  @Prop placeholderFontSize: number = 0;
  @Prop showSubmit: boolean = true;
  @Prop loading: boolean = false;
  @Prop showHeadingToggle: boolean = false;
  @Prop headingOnly: boolean = false;
  @Prop showCaseToggle: boolean = false;
  @Prop caseSensitive: boolean = false;
  onChange: (value: string) => void = () => {};
  onSubmit: () => void = () => {};
  onClear: () => void = () => {};
  onHeadingToggle: () => void = () => {};
  onCaseToggle: () => void = () => {};
  onSearchKey: (event: KeyEvent) => boolean = () => false;
  onFocusChange: (focused: boolean) => void = () => {};
  private composing: boolean = false;
  @State private focused: boolean = false;
  @State private customCaretVisible: boolean = true;
  private caretTimer: number = -1;

  private focusRevisionChanged(): void {
    if (!this.focusKey || this.focusRevision <= 0) return;
    setTimeout(() => focusControl.requestFocus(this.focusKey), 20);
  }

  private startCaretBlink(): void {
    this.stopCaretBlink();
    this.customCaretVisible = true;
    this.caretTimer = setInterval(() => {
      this.customCaretVisible = !this.customCaretVisible;
    }, 500);
  }

  private stopCaretBlink(): void {
    if (this.caretTimer < 0) return;
    clearInterval(this.caretTimer);
    this.caretTimer = -1;
  }

  aboutToDisappear(): void {
    this.stopCaretBlink();
  }

  build() {
    Row({ space: 8 }) {
      Image($r('app.media.search'))
        .width(16)
        .height(16)
        .objectFit(ImageFit.Contain)
        .opacity(this.focused ? 1 : 0.68)
      Stack({ alignContent: Alignment.Start }) {
        if (!this.value) {
          Text(this.placeholder)
            .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
            .fontSize(this.placeholderFontSize > 0 ? this.placeholderFontSize : (this.compact ? 13 : 14))
            .fontColor($r('app.color.muted_soft'))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .hitTestBehavior(HitTestMode.None)
        }
        TextInput({ text: this.value })
          .key(this.focusKey)
          .monopolizeEvents(true)
          .width('100%')
          .height(this.compact ? 36 : 40)
          .padding(0)
          .caretStyle({
            width: '2px',
            color: this.value ? $r('sys.color.ohos_id_color_emphasize') : Color.Transparent
          })
          .fontSize(this.compact ? 13 : 14)
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontColor($r('app.color.ink'))
          .backgroundColor(Color.Transparent)
          .onChange((value: string, preview?: PreviewText) => {
            this.composing = !!preview?.value;
            this.onChange(value);
          })
          .onKeyPreIme((event: KeyEvent) => !this.composing && this.onSearchKey(event))
          .onKeyEvent((event: KeyEvent) => textNavigationKey(event) || workspaceKey(event, KeyCode.KEYCODE_F, true))
          .onSubmit(() => { if (!this.composing) this.onSubmit(); })
          .onFocus(() => {
            this.focused = true;
            this.onFocusChange(true);
            this.startCaretBlink();
          })
          .onBlur(() => {
            this.focused = false;
            this.onFocusChange(false);
            this.stopCaretBlink();
          })
        if (this.focused && !this.value) {
          Row()
            .width(2)
            .height(this.compact ? 20 : 22)
            .backgroundColor($r('sys.color.ohos_id_color_emphasize'))
            .opacity(this.customCaretVisible ? 1 : 0)
            .hitTestBehavior(HitTestMode.None)
        }
      }
        .layoutWeight(1)
        .constraintSize({ minWidth: 0 })
        .height(this.compact ? 36 : 40)
      if (this.showHeadingToggle || this.showCaseToggle || this.showSubmit) {
        Row({ space: 5 }) {
          if (this.showHeadingToggle) {
            Row() {
              Text('H3')
                .fontFamily(workspaceCodeFamily(this.workspaceBreakpoint))
                .fontSize(10)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.headingOnly ? $r('app.color.primary_active') : $r('app.color.muted'))
            }
              .width(28).height(28).justifyContent(FlexAlign.Center)
              .backgroundColor(this.headingOnly ? $r('app.color.search_toggle_active_background') : $r('app.color.canvas'))
              .border({ width: 1, color: this.headingOnly ? $r('app.color.search_toggle_active_border') : $r('app.color.hairline') })
              .borderRadius(6).clip(true)
              .accessibilityText(this.headingOnly ? '当前仅搜索小节标题' : '仅搜索小节标题').bindTips(this.headingOnly ? '当前仅搜索小节标题' : '仅搜索小节标题', WORKSPACE_TIPS)
              .onClick(this.onHeadingToggle)
          }
          if (this.showCaseToggle) {
            Row() {
              Text('Aa')
                .fontFamily(workspaceCodeFamily(this.workspaceBreakpoint))
                .fontSize(10)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.caseSensitive ? $r('app.color.primary_active') : $r('app.color.muted'))
            }
              .width(28).height(28).justifyContent(FlexAlign.Center)
              .backgroundColor(this.caseSensitive ? $r('app.color.search_toggle_active_background') : $r('app.color.canvas'))
              .border({ width: 1, color: this.caseSensitive ? $r('app.color.search_toggle_active_border') : $r('app.color.hairline') })
              .borderRadius(6).clip(true)
              .accessibilityText(this.caseSensitive ? '当前区分大小写' : '区分大小写').bindTips(this.caseSensitive ? '当前区分大小写' : '区分大小写', WORKSPACE_TIPS)
              .onClick(this.onCaseToggle)
          }
          if (this.showSubmit) {
            Button({ type: ButtonType.Normal }) {
              if (this.loading) {
                LoadingProgress().width(15).height(15).color($r('app.color.primary_active'))
              } else {
                Image($r('app.media.search')).width(14).height(14).objectFit(ImageFit.Contain)
                  .colorFilter(iconTint(this.value.trim().length > 0 ? $r('app.color.primary_active') : $r('app.color.muted_soft')))
              }
            }
            .width(28)
            .height(28)
            .padding(0)
            .border({ width: 1, color: $r('app.color.hairline') })
            .borderRadius(8)
            .clip(true)
            .backgroundColor($r('app.color.canvas'))
            .enabled(this.value.trim().length > 0 && !this.loading)
            .opacity(this.value.trim().length > 0 && !this.loading ? 1 : 0.72)
            .accessibilityText('搜索').bindTips('搜索', WORKSPACE_TIPS)
            .onClick(this.onSubmit)
          }
        }
      }
      if (this.value.length > 0) {
        Button({ type: ButtonType.Normal }) {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(13)
            .fontColor([$r('app.color.muted')])
        }
        .width(26).height(26).padding(0)
        .backgroundColor(Color.Transparent).borderRadius(13).clip(true)
        .accessibilityText('清空搜索').bindTips('清空搜索', WORKSPACE_TIPS)
        .onClick(() => {
          this.onChange('');
          this.onClear();
        })
      }
    }
    .width('100%')
    .height(this.compact ? 38 : 42)
    .padding({ left: this.compact ? 10 : 12, right: 6 })
    .backgroundColor(this.compact ? $r('app.color.canvas') : $r('app.color.surface_soft'))
    .border({ width: 1, color: this.focused ? $r('app.color.primary') : $r('app.color.hairline') })
    .borderRadius(8)
  }
}

@Component
export struct AppDropdown {
  @State private hoveredOption: number = -1;
  @State private hoveredControl: boolean = false;
  @Prop options: string[] = [];
  @Prop selectedIndex: number = 0;
  @Prop value: string = '';
  @Prop icon: Resource = $r('app.media.calendar_days');
  @Prop accessibilityLabel: string = '选择选项';
  onSelect: (index: number, value: string) => void = () => {};
  @State private open: boolean = false;
  @State private popupWidth: number = 160;

  private popupHeight(): number {
    return Math.min(Math.max(this.options.length, 1), 6) * 42 + 8;
  }

  private choose(index: number, value: string): void {
    this.open = false;
    this.onSelect(index, value);
  }

  @Builder
  private popupContent() {
    Scroll() {
      Column() {
        ForEach(this.options, (option: string, index: number) => {
          Button({ type: ButtonType.Normal, stateEffect: false }) {
            Row() {
              Text(option)
                .fontSize(13)
                .fontWeight(index === this.selectedIndex ? FontWeight.Medium : FontWeight.Regular)
                .fontColor(index === this.selectedIndex ?
                  $r('app.color.primary_active') : $r('app.color.body'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
                .textAlign(TextAlign.Start)
            }
            .width('100%')
          }
          .width('100%')
          .height(42)
          .padding({ left: 12, right: 12 })
          .attributeModifier(new InteractiveSurface(index === this.selectedIndex ? $r('app.color.primary_tint') : Color.Transparent,
            this.hoveredOption === index, index === this.selectedIndex))
          .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredOption = hover ? index : -1))
          .border({
            width: { bottom: index < this.options.length - 1 ? 1 : 0 },
            color: $r('app.color.hairline_soft')
          })
          .borderRadius(index === this.selectedIndex ? 6 : 0)
          .clip(true)
          .accessibilityText(option)
          .onClick(() => this.choose(index, option))
        }, (option: string, index: number) => `${index}-${option}`)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height(this.popupHeight())
    .padding(4)
    .align(Alignment.TopStart)
    .scrollable(ScrollDirection.Vertical)
    .scrollBar(this.options.length > 6 ? BarState.Auto : BarState.Off)
    .edgeEffect(EdgeEffect.None)
  }

  build() {
    Button({ type: ButtonType.Normal, stateEffect: false }) {
      Row({ space: 8 }) {
        Image(this.icon)
          .width(15)
          .height(15)
          .objectFit(ImageFit.Contain)
        Text(this.value)
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.ink'))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
          .textAlign(TextAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_down'))
          .fontSize(13)
          .fontColor([$r('app.color.ink')])
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .height(38)
    .padding({ left: 11, right: 10 })
    .backgroundColor($r('app.color.surface_soft'))
    .border({ width: 1, color: $r('app.color.hairline') })
    .borderRadius(8)
    .clip(true)
    .accessibilityText(this.accessibilityLabel)
    .attributeModifier(new InteractiveSurface($r('app.color.surface_soft'), this.hoveredControl))
    .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredControl = hover))
    .onClick(() => this.open = !this.open)
    .onAreaChange((_oldArea: Area, newArea: Area) => {
      const width = Number(newArea.width);
      if (width > 0) this.popupWidth = width;
    })
    .bindPopup(this.open, {
      builder: this.popupContent,
      placement: Placement.BottomLeft,
      popupColor: $r('app.color.canvas'),
      enableArrow: false,
      autoCancel: true,
      targetSpace: 4,
      width: this.popupWidth,
      radius: 12,
      backgroundBlurStyle: BlurStyle.NONE,
      shadow: {
        radius: 12,
        color: $r('app.color.popover_shadow'),
        offsetY: 4
      },
      onStateChange: (event) => this.open = event.isVisible
    })
  }
}
