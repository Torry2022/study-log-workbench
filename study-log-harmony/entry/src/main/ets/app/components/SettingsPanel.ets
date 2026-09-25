import { KeyCode } from '@kit.InputKit';
import { AppModalScrim } from '../../common/ui/AppModalScrim';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { appFeedback } from '../../common/ui/AppFeedback';
import { EDITOR_SIZES, READING_SCALES, workspacePreferences } from '../../common/storage/WorkspacePreferences';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { workspaceSerifFamily } from '../../common/ui/Typography';

@Component
export struct SettingsPanel {
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @StorageProp('pref_readingScale') private readingScale: number = 1;
  @StorageProp('pref_editorSize') private editorSize: number = 14;
  @StorageProp('pref_editorWrap') @Watch('syncSwitches') private editorWrap: boolean = true;
  @StorageProp('pref_rememberSearch') @Watch('syncSwitches') private rememberSearch: boolean = true;
  @State private wrapSwitch: boolean = true;
  @State private historySwitch: boolean = true;
  @State private busy: boolean = false;
  onClose: () => void = () => {};

  aboutToAppear(): void { this.syncSwitches(); }

  private syncSwitches(): void {
    this.wrapSwitch = this.editorWrap;
    this.historySwitch = this.rememberSearch;
  }

  private async save(key: string, value: number | boolean): Promise<void> {
    this.busy = true;
    try { await workspacePreferences.set(key, value); }
    catch (_) { appFeedback.show('本机设置保存失败，请重试', 'error'); }
    finally { this.syncSwitches(); this.busy = false; }
  }

  private changeHistory(enabled: boolean): void {
    if (enabled) { this.save('rememberSearch', true); return; }
    AlertDialog.show({
      title: '关闭搜索历史',
      message: '关闭后不再记录或展示搜索历史，已有历史保留在本机，重新开启后可继续使用。需要删除时，请先在搜索框的“最近搜索”中清除。',
      autoCancel: false,
      primaryButton: { value: '取消', action: () => this.syncSwitches() },
      secondaryButton: { value: '关闭记录', action: () => this.save('rememberSearch', false) },
      cancel: () => this.syncSwitches()
    });
  }

  private reset(): void {
    AlertDialog.show({
      title: '恢复默认设置', message: '仅恢复本窗口的阅读、编辑和搜索选项，不清除登录、搜索历史或业务数据，也不重置主题与收藏布局。',
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '恢复默认', action: async () => {
        this.busy = true;
        try { await workspacePreferences.resetSettings(); }
        catch (_) { appFeedback.show('恢复默认设置失败，请重试', 'error'); }
        finally { this.busy = false; }
      } }
    });
  }

  @Builder
  private label(title: string, detail: string) {
    Column({ space: 4 }) {
      Text(title).fontSize(14).fontColor($r('app.color.ink'))
      Text(detail).fontSize(12).lineHeight(18).fontColor($r('app.color.muted'))
    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      AppModalScrim({ onDismiss: this.onClose })
      Column() {
        Row() {
          Text('设置').fontFamily(workspaceSerifFamily(this.breakpoint)).fontSize(28)
            .fontColor($r('app.color.ink')).layoutWeight(1)
          ToolbarAction({ label: '关闭设置', showLabel: false, useSymbol: true,
            symbol: $r('sys.symbol.xmark'), controlHeight: 36, iconWidth: 36,
            onAction: this.onClose }).id('settings_close')
        }.width('100%').padding(16).flexShrink(0).border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
        Scroll() {
          Column({ space: 16 }) {
            Text('阅读与编辑').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted')).width('100%')
            Row({ space: 16 }) {
              this.label('正文字号', '按比例调整阅读正文和标题，不改变导航与按钮。')
              Select([{ value: '较小 · 90%' }, { value: '标准 · 100%' }, { value: '较大 · 110%' }, { value: '很大 · 120%' }])
                .selected(READING_SCALES.indexOf(this.readingScale))
                .value(['较小 · 90%', '标准 · 100%', '较大 · 110%', '很大 · 120%'][READING_SCALES.indexOf(this.readingScale)])
                .font({ size: 13 }).fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
                .width(152).id('settings_reading_size').onSelect((index: number) => this.save('readingScale', READING_SCALES[index]))
            }.width('100%')
            Row({ space: 16 }) {
              this.label('源码字号', '仅调整日志源码编辑器。')
              Select(EDITOR_SIZES.map((size: number): SelectOption => ({ value: `${size} px` })))
                .selected(EDITOR_SIZES.indexOf(this.editorSize)).value(`${this.editorSize} px`)
                .font({ size: 13 }).fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
                .width(152).id('settings_editor_size').onSelect((index: number) => this.save('editorSize', EDITOR_SIZES[index]))
            }.width('100%')
            Row({ space: 16 }) {
              this.label('源码自动换行', '关闭后，长行可横向滚动。')
              Toggle({ type: ToggleType.Switch, isOn: this.wrapSwitch }).selectedColor($r('app.color.primary'))
                .id('settings_editor_wrap').onChange((value: boolean) => {
                  this.wrapSwitch = value;
                  if (value !== this.editorWrap) this.save('editorWrap', value);
                })
            }.width('100%')
            Divider().color($r('app.color.hairline'))
            Text('搜索').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted')).width('100%')
            Row({ space: 16 }) {
              this.label('记住搜索历史', '仅保存在本机，最多记录最近 8 条。')
              Toggle({ type: ToggleType.Switch, isOn: this.historySwitch }).selectedColor($r('app.color.primary'))
                .id('settings_search_history').onChange((value: boolean) => {
                  this.historySwitch = value;
                  if (value !== this.rememberSearch) this.changeHistory(value);
                })
            }.width('100%').id('settings_history_row')
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start).enabled(!this.busy)
        }.width('100%').flexShrink(1).align(Alignment.TopStart).scrollBar(BarState.Auto)
        Row({ space: 12 }) {
          Text('设置自动保存，仅对本机生效。').layoutWeight(1).fontSize(12).fontColor($r('app.color.muted'))
          ToolbarAction({ label: '恢复默认', showIcon: false, available: !this.busy, onAction: () => this.reset() })
            .id('settings_reset')
        }.width('100%').padding(16).flexShrink(0).id('settings_footer')
          .border({ width: { top: 1 }, color: $r('app.color.hairline') })
      }.width('90%').constraintSize({ maxWidth: 600, maxHeight: '82%' })
        .backgroundColor($r('app.color.canvas')).borderRadius(12)
        .border({ width: 1, color: $r('app.color.hairline') })
        .shadow({ radius: 22, color: $r('app.color.popover_shadow'), offsetY: 8 }).onClick(() => {})
    }.width('100%').height('100%').onKeyEvent((event: KeyEvent) => {
      if (event.type === KeyType.Down && event.keyCode === KeyCode.KEYCODE_ESCAPE) {
        event.stopPropagation(); this.onClose();
      }
    }).onAppear(() => setTimeout(() => focusControl.requestFocus('settings_close'), 20))
  }
}
