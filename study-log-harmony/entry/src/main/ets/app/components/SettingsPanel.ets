import { KeyCode } from '@kit.InputKit';
import { AppModalScrim } from '../../common/ui/AppModalScrim';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { appFeedback } from '../../common/ui/AppFeedback';
import { EDITOR_SIZES, READING_SCALES, workspacePreferences } from '../../common/storage/WorkspacePreferences';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { workspaceSansFamily, workspaceSerifFamily } from '../../common/ui/Typography';
import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';
import { AiSettingsStatus } from './AiSettingsStatus';
import { AiSettingsController } from '../AiSettingsController';
import { apiClient } from '../../common/network/ApiClient';
import { activeInstance } from '../../common/network/InstanceConfig';
import { bundleManager } from '@kit.AbilityKit';
import { FrameAction } from '../../common/ui/FrameAction';
import { AiSettingsEditor } from '../AiSettingsEditor';
import { AiSettingsSummary } from '../AiSettingsSummary';
import { AiSettingsForm } from './AiSettingsForm';
import { instanceStore } from '../../common/storage/InstanceStore';
import { FormKeyboardContext } from '../../common/ui/FormKeyboardContext';
import { SymbolGlyphModifier } from '@kit.ArkUI';
import { iconTint } from '../../common/ui/IconTint';
import { ConnectionController } from '../ConnectionController';
import { ConnectionFields } from './ConnectionPanel';
import { ConnectionAction } from './ConnectionAction';
import { AppLogo } from '../../common/ui/AppLogo';
import { SettingsConfirmation } from '../SettingsConfirmation';
import { SettingsConfirmDialog } from './SettingsConfirmDialog';
import { revealResults, secondaryPageTransition } from '../../common/ui/WorkspaceMotion';

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
  @State private section: string = 'menu';
  @State private sectionOpacity: number = 1;
  @State private hoveredSection: string = '';
  @State private panelWidth: number = 0;
  @State private version: string = '';
  @State private availableHeight: number = 640;
  @State private ai: AiSettingsController = new AiSettingsController(apiClient, () => activeInstance.capabilities,
    (summary: AiSettingsSummary) => { void this.restoreAiPending(summary); });
  @State private aiEditor: AiSettingsEditor = new AiSettingsEditor(apiClient, instanceStore);
  @State private aiDetailsOpen: boolean = false;
  @StorageLink('themePreference') private themePreference: string = 'system';
  @Prop connected: boolean = true;
  @Prop disconnecting: boolean = false;
  @Prop changingConnection: boolean = false;
  @ObjectLink connection: ConnectionController;
  onCancelConnection: () => void = () => {};
  initialSection: string = 'menu';
  onConnect: () => void = () => {};
  onDisconnect: () => void = () => {};
  onTheme: (value: string) => void = () => {};
  onBackHandler: (back: () => void) => void = () => {};
  onClose: () => void = () => {};
  onAiSaved: () => void = () => {};
  private aiLoaded: boolean = false;
  private focusRevision: number = 0;
  private scroller: Scroller = new Scroller();
  private keyboard: FormKeyboardContext = new FormKeyboardContext(this.scroller, 'settings_scroll');
  private connectionScroller: Scroller = new Scroller();
  private connectionKeyboard: FormKeyboardContext = new FormKeyboardContext(this.connectionScroller, 'settings_connection_scroll');
  private editScroller: Scroller = new Scroller();
  private editKeyboard: FormKeyboardContext = new FormKeyboardContext(this.editScroller, 'settings_ai_scroll');
  private confirmation: SettingsConfirmation = new SettingsConfirmation((): void => this.confirmationDialog.open(), (): void => this.confirmationDialog.close());
  private confirmationDialog: CustomDialogController = new CustomDialogController({
    builder: SettingsConfirmDialog({ confirmation: this.confirmation }), customStyle: true,
    autoCancel: true, cancel: () => this.confirmation.settle(false)
  });

  private async restoreAiPending(summary: AiSettingsSummary): Promise<void> {
    const revision = this.focusRevision, binding = apiClient.getConnectionBinding(), namespace = activeInstance.namespace;
    try {
      const raw = await instanceStore.readAiSettingsPending(namespace);
      if (raw && revision === this.focusRevision && binding === apiClient.getConnectionBinding() && !this.aiEditor.editing) {
        await this.aiEditor.open(summary);
      }
    } catch (_) { if (revision === this.focusRevision) appFeedback.show('本机设置结果记录读取失败，请重试', 'error'); }
  }

  aboutToAppear(): void {
    this.syncSwitches();
    this.section = this.initialSection;
    if (this.connected && this.section === 'ai') { this.aiLoaded = true; this.ai.load(true); }
    this.onBackHandler(() => this.requestBack());
    try { this.version = bundleManager.getBundleInfoForSelfSync(0).versionName; }
    catch (_) { this.version = '暂不可获取'; }
    const revision = ++this.focusRevision;
    this.getUIContext().postFrameCallback(new FrameAction(() => {
      if (revision === this.focusRevision) focusControl.requestFocus('settings_close_focus');
    }));
  }

  aboutToDisappear(): void { this.focusRevision++; this.ai.dispose(); this.aiEditor.dispose(); this.keyboard.clear(); this.connectionKeyboard.clear(); this.editKeyboard.clear(); this.confirmation.settle(false); this.onBackHandler(() => {}); }

  private wide(): boolean { return this.panelWidth >= 840; }

  private currentSection(): string {
    if (this.changingConnection) return 'records';
    if (!this.connected && (this.section === 'records' || this.section === 'ai')) return 'reading';
    return this.section === 'menu' && this.wide() ? (this.connected ? 'records' : 'reading') : this.section;
  }

  private sections(): string[] { return this.connected ? ['records', 'ai', 'reading', 'about'] : ['reading', 'about']; }

  private sectionLabel(section: string): string {
    return section === 'records' ? '工作台连接' : section === 'ai' ? 'AI 服务' : section === 'reading' ? '外观与阅读' : '关于';
  }

  private sectionDescription(section: string): string {
    if (section === 'records') return '地址、服务器版本和连接管理';
    if (section === 'ai') return '模型设置与功能状态';
    if (section === 'reading') return '主题、字号和显示偏好';
    return '应用版本';
  }

  private selectSection(section: string): void {
    if (!this.sections().includes(section)) return;
    if (this.changingConnection) return;
    if (this.aiEditor.editing && section !== 'ai') {
      this.requestClose(() => { this.aiEditor.dispose(); this.selectSection(section); });
      return;
    }
    const changed = this.currentSection() !== section;
    this.section = section;
    this.scroller.scrollTo({ xOffset: 0, yOffset: 0 });
    if (changed && this.wide()) {
      revealResults(this.getUIContext(), (opacity: number) => this.sectionOpacity = opacity,
        () => this.section === section);
    }
    if (section === 'ai' && !this.aiLoaded) { this.aiLoaded = true; this.ai.load(true); }
  }

  private requestBack(): void {
    if (this.disconnecting) return;
    if (this.changingConnection) { this.onCancelConnection(); return; }
    if (this.currentSection() === 'ai' && this.aiEditor.editing) {
      this.requestClose(() => this.finishAiEditing());
      return;
    }
    if (!this.wide() && this.currentSection() !== 'menu') { this.section = 'menu'; return; }
    this.requestClose();
  }

  private requestClose(action: () => void = this.onClose): void {
    if (this.disconnecting) return;
    if (this.changingConnection) {
      if (this.connection.committing) return;
      this.onCancelConnection(); action(); return;
    }
    if (!this.aiEditor.hasUnsavedChanges()) { action(); return; }
    void this.confirmation.ask('结束编辑', this.aiEditor.leaveMessage(), '结束编辑', '继续编辑')
      .then((accepted: boolean) => { if (accepted) action(); });
  }

  private finishAiEditing(): void {
    this.aiEditor.dispose();
    this.ai.load(true);
  }

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
    void this.confirmation.ask('关闭搜索历史', '关闭后暂停记录和展示搜索历史，已有历史保留在本机。', '关闭记录')
      .then((accepted: boolean) => { if (accepted) this.save('rememberSearch', false); else this.syncSwitches(); });
  }

  private reset(): void {
    void this.confirmation.ask('恢复默认设置', '将正文字号、源码显示和搜索偏好恢复为默认值。', '恢复默认')
      .then(async (accepted: boolean) => {
        if (!accepted) return;
        this.busy = true;
        try { await workspacePreferences.resetSettings(); }
        catch (_) { appFeedback.show('恢复默认设置失败，请重试', 'error'); }
        finally { this.busy = false; }
      });
  }

  private sectionIcon(section: string): Resource {
    if (section === 'records') return $r('app.media.link_2');
    if (section === 'ai') return $r('app.media.sparkles');
    if (section === 'reading') return $r('app.media.sliders_horizontal');
    return $r('app.media.info');
  }

  private dialogHeight(): number { return Math.min(640, this.availableHeight * 0.9); }

  private selectArrow(): SymbolGlyphModifier {
    const modifier = new SymbolGlyphModifier($r('sys.symbol.chevron_down'));
    modifier.fontSize(14);
    modifier.fontColor([$r('app.color.muted')]);
    return modifier;
  }

  @Builder
  private sectionButton(section: string, label: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Image(this.sectionIcon(section)).width(18).height(18)
          .colorFilter(iconTint(!this.wide() || this.currentSection() === section ? $r('app.color.primary_active') : $r('app.color.muted')))
          .flexShrink(0)
        if (this.wide()) {
          Text(label).fontFamily(workspaceSansFamily(this.breakpoint)).fontSize(14)
            .layoutWeight(1).textAlign(TextAlign.Start)
            .fontColor(this.currentSection() === section ? $r('app.color.primary_active') : $r('app.color.ink'))
        } else {
          Column({ space: 4 }) {
            Text(label).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).width('100%')
            Text(this.sectionDescription(section)).fontSize(13).lineHeight(18).fontColor($r('app.color.muted')).width('100%')
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }
        if (!this.wide()) SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([$r('app.color.muted')])
      }.width('100%').justifyContent(FlexAlign.Start)
    }.width('100%').constraintSize({ minHeight: this.wide() ? 44 : 76 })
      .padding({ left: 16, right: 16, top: this.wide() ? 0 : 12, bottom: this.wide() ? 0 : 12 })
      .border({ width: this.wide() ? 0 : 1, color: $r('app.color.hairline') }).borderRadius(this.wide() ? 8 : 12).clip(true)
      .attributeModifier(new InteractiveSurface(this.currentSection() === section ? $r('app.color.surface_card') :
        this.wide() ? Color.Transparent : $r('app.color.surface_soft'),
        this.hoveredSection === section, this.currentSection() === section))
      .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredSection = hover ? section : ''))
      .accessibilityText(label).id('settings_section_' + section)
      .onClick(() => this.selectSection(section))
  }

  @Builder
  private groupTitle(title: string) {
    Text(title).fontSize(12).lineHeight(18).fontColor($r('app.color.muted')).width('100%').padding({ left: 4 })
  }

  @Builder
  private settingsMenu() {
    Column({ space: 12 }) {
      ForEach(this.sections(), (section: string) => this.sectionButton(section, this.sectionLabel(section)))
    }.width('100%')
  }

  @Builder
  private preferenceChoice(label: string, detail: string, options: SelectOption[], selected: number, value: string, key: string) {
    Row({ space: 12 }) {
      Column({ space: 4 }) {
        Text(label).fontFamily(workspaceSansFamily(this.breakpoint)).fontSize(14)
          .fontColor($r('app.color.ink')).width('100%')
        Text(detail).fontSize(12).lineHeight(17).fontColor($r('app.color.muted')).width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Select(options).selected(selected).value(value).controlSize(ControlSize.SMALL)
        .font({ size: 14, weight: FontWeight.Regular, family: workspaceSansFamily(this.breakpoint) })
        .fontColor($r('app.color.body')).backgroundColor($r('app.color.canvas'))
        .menuBackgroundColor($r('app.color.canvas')).optionBgColor($r('app.color.canvas'))
        .optionFont({ size: 14, weight: FontWeight.Regular, family: workspaceSansFamily(this.breakpoint) }).optionFontColor($r('app.color.ink'))
        .selectedOptionBgColor($r('app.color.surface_card')).selectedOptionFontColor($r('app.color.ink'))
        .width(this.wide() ? 144 : 112).height(44).flexShrink(0).padding({ left: 12, right: 8 }).borderRadius(8)
        .border({ width: 1, color: $r('app.color.hairline') }).space(8).arrowModifier(this.selectArrow())
        .id('settings_' + key).onSelect((index: number) => {
          if (key === 'theme') this.onTheme(['system', 'light', 'dark'][index]);
          else if (key === 'reading_size') this.save('readingScale', READING_SCALES[index]);
          else this.save('editorSize', EDITOR_SIZES[index]);
        })
    }.width('100%').padding({ top: 4, bottom: 4 })
  }

  @Builder
  private recordsContent() {
    Column({ space: 16 }) {
      Column() {
        Row({ space: 12 }) {
          Image(this.sectionIcon('records')).width(20).height(20).colorFilter(iconTint($r('app.color.primary_active')))
          Column({ space: 6 }) {
            Text('工作台地址').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).width('100%')
            Text(activeInstance.origin).fontSize(13).lineHeight(20).fontColor($r('app.color.muted'))
              .width('100%').wordBreak(WordBreak.BREAK_ALL).copyOption(CopyOptions.LocalDevice)
          }.layoutWeight(1)
          Text('已连接').fontSize(12).fontColor($r('app.color.muted')).flexShrink(0)
        }.width('100%').padding(16)
        Divider().color($r('app.color.hairline'))
        Row({ space: 12 }) {
          Text('服务器版本').fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1)
          Text(activeInstance.capabilities?.serverVersion || '未提供').fontSize(13).fontColor($r('app.color.muted'))
        }.width('100%').constraintSize({ minHeight: 48 }).padding({ left: 16, right: 16 })
        Divider().color($r('app.color.hairline'))
        this.actionRow('更换连接', 'settings_change_connection', () => this.onConnect())
      }.width('100%').backgroundColor($r('app.color.surface_soft')).borderRadius(12).clip(true)
        .border({ width: 1, color: $r('app.color.hairline') })
      Row({ space: 16 }) {
        Column() { this.label('断开连接', '再次连接需输入访问密码，本机草稿会保留。') }.layoutWeight(1)
        ConnectionAction({ label: '断开', busy: this.disconnecting,
          onAction: () => this.onDisconnect() }).id('settings_disconnect')
      }.width('100%').padding(16).backgroundColor($r('app.color.surface_soft')).borderRadius(12)
        .border({ width: 1, color: $r('app.color.hairline') })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private actionRow(label: string, id: string, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Text(label).fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1).textAlign(TextAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([$r('app.color.muted')])
      }.width('100%')
    }.width('100%').height(48).padding({ left: 16, right: 16 }).backgroundColor(Color.Transparent)
      .borderRadius(0).id(id).onClick(action)
  }

  @Builder
  private themeRow(label: string, value: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Column({ space: 4 }) {
          Row().width(22).height(3).borderRadius(2)
            .backgroundColor(value === 'dark' ? '#d7c9b9' : '#594e44')
          Row().width(15).height(3).borderRadius(2).backgroundColor('#cc785c')
        }.width(52).height(34).justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Start)
          .padding({ left: 10 }).borderRadius(6).border({ width: 1, color: $r('app.color.hairline') })
          .backgroundColor(value === 'dark' ? '#292521' : value === 'light' ? '#faf9f5' : $r('app.color.canvas'))
        Text(label).fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1).textAlign(TextAlign.Start)
        if (this.themePreference === value) SymbolGlyph($r('sys.symbol.checkmark')).fontSize(16)
          .fontColor([$r('app.color.primary_active')])
      }.width('100%')
    }.width('100%').height(60).padding({ left: 16, right: 16 }).borderRadius(0)
      .backgroundColor(this.themePreference === value ? $r('app.color.surface_card') : Color.Transparent)
      .accessibilitySelected(this.themePreference === value).onClick(() => this.onTheme(value))
  }

  @Builder
  private readingContent() {
    Column({ space: 12 }) {
      this.groupTitle('主题')
      Column() {
        this.themeRow('跟随系统', 'system')
        Divider().color($r('app.color.hairline'))
        this.themeRow('浅色', 'light')
        Divider().color($r('app.color.hairline'))
        this.themeRow('深色', 'dark')
      }.width('100%').backgroundColor($r('app.color.surface_soft')).borderRadius(12).clip(true)
        .border({ width: 1, color: $r('app.color.hairline') })
      this.groupTitle('阅读与编辑')
      Column({ space: 4 }) {
        this.preferenceChoice('正文字号', '调整阅读正文和标题的大小。',
          [{ value: '较小（90%）' }, { value: '标准（100%）' }, { value: '较大（110%）' }, { value: '很大（120%）' }],
          READING_SCALES.indexOf(this.readingScale), ['90%', '100%', '110%', '120%'][READING_SCALES.indexOf(this.readingScale)], 'reading_size')
        this.preferenceChoice('源码字号', '仅调整日志源码编辑器。',
          EDITOR_SIZES.map((size: number): SelectOption => ({ value: size + ' px' })),
          EDITOR_SIZES.indexOf(this.editorSize), this.editorSize + ' px', 'editor_size')
        Row({ space: 16 }) {
          Column() { this.label('源码自动换行', '关闭后，长行可横向滚动。') }.layoutWeight(1)
          Toggle({ type: ToggleType.Switch, isOn: this.wrapSwitch }).selectedColor($r('app.color.primary'))
            .id('settings_editor_wrap').onChange((value: boolean) => {
              this.wrapSwitch = value;
              if (value !== this.editorWrap) this.save('editorWrap', value);
            })
        }.width('100%').constraintSize({ minHeight: 44 })
      }.width('100%').padding(16).backgroundColor($r('app.color.surface_soft')).borderRadius(12)
        .border({ width: 1, color: $r('app.color.hairline') })
      this.groupTitle('搜索')
      Column({ space: 8 }) {
        Row({ space: 16 }) {
          Column() { this.label('记住搜索历史', '仅保存在本机，最多记录最近8条。') }.layoutWeight(1)
          Toggle({ type: ToggleType.Switch, isOn: this.historySwitch }).selectedColor($r('app.color.primary'))
            .id('settings_search_history').onChange((value: boolean) => {
              this.historySwitch = value;
              if (value !== this.rememberSearch) this.changeHistory(value);
            })
        }.width('100%').constraintSize({ minHeight: 44 }).id('settings_history_row')
      }.width('100%').padding(16).backgroundColor($r('app.color.surface_soft')).borderRadius(12)
        .border({ width: 1, color: $r('app.color.hairline') })
      Row({ space: 12 }) {
        Text('设置自动保存，仅对本机生效。').layoutWeight(1).fontSize(12).lineHeight(18).fontColor($r('app.color.muted'))
        ConnectionAction({ label: '恢复默认', available: !this.busy, onAction: () => this.reset() })
          .id('settings_reset')
      }.width('100%').padding({ top: 16 }).id('settings_footer')
        .border({ width: { top: 1 }, color: $r('app.color.hairline') })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private aboutContent() {
    Column({ space: 16 }) {
      Row({ space: 12 }) {
        AppLogo({ iconSize: 40, cornerRadius: 8 })
        Column() { this.label('学习日志工作台', 'HarmonyOS 客户端') }.layoutWeight(1)
      }.width('100%').padding({ top: 4, bottom: 4 })
      Column() {
        Row({ space: 12 }) {
          Text('应用版本').fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1)
          Text(this.version).fontSize(13).fontColor($r('app.color.muted'))
        }.width('100%').height(52).padding({ left: 16, right: 16 })
      }.width('100%').backgroundColor($r('app.color.surface_soft')).borderRadius(12).clip(true)
        .border({ width: 1, color: $r('app.color.hairline') })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private label(title: string, detail: string) {
    Column({ space: 4 }) {
      Text(title).fontSize(14).fontColor($r('app.color.ink'))
      Text(detail).fontSize(12).lineHeight(18).wordBreak(WordBreak.BREAK_ALL).fontColor($r('app.color.muted'))
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.breakpoint === WorkspaceBreakpoint.COMPACT) {
        Row().width('100%').height('100%').backgroundColor($r('app.color.canvas'))
          .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      } else {
        AppModalScrim({ onDismiss: () => this.requestClose() })
      }
      Column() {
        Row({ space: this.wide() ? 12 : 4 }) {
          if (!this.wide()) {
            ToolbarAction({ label: '返回上一页', showLabel: false, useSymbol: true, segmented: true,
              symbol: $r('sys.symbol.chevron_left'), symbolSize: 23, controlHeight: 48, iconWidth: 44,
              onAction: () => this.requestBack() }).id('settings_back').flexShrink(0)
          }
          Text(this.wide() || this.currentSection() === 'menu' ? '设置' :
            this.changingConnection ? '更换连接' : this.currentSection() === 'ai' && this.aiEditor.editing ? '修改 AI 设置' :
              this.sectionLabel(this.currentSection()))
            .fontFamily(workspaceSansFamily(this.breakpoint)).fontSize(this.wide() ? 18 : 16).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.ink')).layoutWeight(1).maxLines(2)
          ToolbarAction({ label: '关闭设置', focusKey: 'settings_close_focus', showLabel: false, useSymbol: true,
            segmented: true, symbol: $r('sys.symbol.xmark'), controlHeight: 48, iconWidth: 44,
            onAction: () => this.requestClose() }).id('settings_close').flexShrink(0)
        }.id('settings_header').width('100%').height(56).padding({ left: this.wide() ? 16 : 8,
          right: 16 }).flexShrink(0)
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
        Row() {
          Column({ space: 8 }) {
            ForEach(this.sections(), (section: string) => this.sectionButton(section, this.sectionLabel(section)))
          }.width(190).height('100%').padding(12).backgroundColor($r('app.color.surface_soft'))
            .border({ width: { right: 1 }, color: $r('app.color.hairline') })
            .visibility(this.wide() ? Visibility.Visible : Visibility.None)
          Stack({ alignContent: Alignment.TopStart }) {
            if (this.currentSection() === 'menu') {
              Scroll() {
                Column() { this.settingsMenu() }.width('100%').constraintSize({ maxWidth: 600 })
                  .padding({ left: 16, right: 16, top: 20, bottom: 24 })
              }.width('100%').height('100%').align(Alignment.Top).scrollBar(BarState.Auto)
            } else if (this.changingConnection && !this.wide()) {
              ConnectionFields({ controller: this.connection, keyboard: this.connectionKeyboard,
                scroller: this.connectionScroller, compact: true, onClose: this.onCancelConnection })
                .width('100%').height('100%').zIndex(2).transition(secondaryPageTransition())
            } else if (this.currentSection() === 'ai' && this.aiEditor.editing) {
              AiSettingsForm({ editor: this.aiEditor, keyboard: this.editKeyboard, scroller: this.editScroller,
                wide: this.wide(), onDone: () => this.finishAiEditing(),
                onSaved: () => { this.finishAiEditing(); this.onAiSaved(); } })
                .width('100%').height('100%').zIndex(2)
                .transition(this.wide() ? TransitionEffect.IDENTITY : secondaryPageTransition())
            } else Scroll(this.scroller) {
              Column({ space: 16 }) {
                if (this.wide()) {
                  Text(this.changingConnection ? '更换连接' : this.sectionLabel(this.currentSection())).fontFamily(workspaceSerifFamily(this.breakpoint))
                    .fontSize(24).fontWeight(FontWeight.Regular).fontColor($r('app.color.ink')).width('100%')
                }
                if (this.changingConnection) {
                  ConnectionFields({ controller: this.connection, keyboard: this.keyboard,
                    onClose: this.onCancelConnection, compact: !this.wide() })
                } else if (this.currentSection() === 'records') this.recordsContent()
                else if (this.currentSection() === 'ai') {
                  AiSettingsStatus({ data: this.ai, detailsOpen: $aiDetailsOpen,
                    onEdit: () => { if (this.ai.summary) void this.aiEditor.open(this.ai.summary); } })
                } else if (this.currentSection() === 'about') this.aboutContent()
                else this.readingContent()
              }.width('100%').constraintSize({ maxWidth: 600 })
                .padding({ left: this.wide() ? 32 : 16, right: this.wide() ? 32 : 16, top: 20, bottom: 24 })
                .alignItems(HorizontalAlign.Start).enabled(!this.busy && !this.disconnecting)
            }.id('settings_scroll').width('100%').height('100%').align(Alignment.Top).scrollBar(BarState.Auto)
              .backgroundColor($r('app.color.canvas')).zIndex(1)
              .transition(this.wide() ? TransitionEffect.IDENTITY : secondaryPageTransition())
              .onAreaChange(() => this.keyboard.reveal(this.getUIContext()))
          }.layoutWeight(1).height('100%').clip(true).opacity(this.wide() ? this.sectionOpacity : 1)
        }.width('100%').layoutWeight(1).alignItems(VerticalAlign.Top)
      }.width(this.breakpoint === WorkspaceBreakpoint.COMPACT ? '100%' : '94%')
        .height(this.breakpoint === WorkspaceBreakpoint.COMPACT ? '100%' : this.dialogHeight())
        .constraintSize({ maxWidth: 920 }).clip(true)
        .onAreaChange((_old: Area, area: Area) => this.panelWidth = Number(area.width))
        .backgroundColor($r('app.color.canvas')).borderRadius(this.breakpoint === WorkspaceBreakpoint.COMPACT ? 0 : 12)
        .border({ width: this.breakpoint === WorkspaceBreakpoint.COMPACT ? 0 : 1, color: $r('app.color.hairline') })
        .shadow({ radius: this.breakpoint === WorkspaceBreakpoint.COMPACT ? 0 : 22, color: $r('app.color.popover_shadow'), offsetY: 8 }).onClick(() => {})
    }.width('100%').height('100%')
      .onAreaChange((_old: Area, area: Area) => this.availableHeight = Number(area.height))
      .onKeyEvent((event: KeyEvent) => {
        if (event.type === KeyType.Down && event.keyCode === KeyCode.KEYCODE_ESCAPE) {
          event.stopPropagation(); this.requestBack();
        }
      })
  }
}
