import { AiSettingsEditor } from '../AiSettingsEditor';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { FormKeyboardContext } from '../../common/ui/FormKeyboardContext';
import { expandSection } from '../../common/ui/WorkspaceMotion';
import { LengthMetrics, SymbolGlyphModifier } from '@kit.ArkUI';
import { workspaceSansFamily, workspaceSerifFamily } from '../../common/ui/Typography';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { SettingsConfirmation } from '../SettingsConfirmation';
import { SettingsConfirmDialog } from './SettingsConfirmDialog';
import { ConnectionAction } from './ConnectionAction';

@Component
export struct AiSettingsForm {
  @ObjectLink editor: AiSettingsEditor;
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @Prop wide: boolean = false;
  scroller: Scroller = new Scroller();
  keyboard: FormKeyboardContext = new FormKeyboardContext(new Scroller(), 'settings_ai_scroll');
  onDone: () => void = () => {};
  onSaved: () => void = () => {};
  @State private details: boolean = false;
  @State private action: string = '';
  @State private password: string = '';
  private passwordTimer: number = -1;
  private leaveConfirmation: SettingsConfirmation = new SettingsConfirmation((): void => this.leaveDialog.open(), (): void => this.leaveDialog.close());
  private leaveDialog: CustomDialogController = new CustomDialogController({
    builder: SettingsConfirmDialog({ confirmation: this.leaveConfirmation }), customStyle: true,
    autoCancel: true, cancel: () => this.leaveConfirmation.settle(false)
  });
  private confirmation: CustomDialogController = new CustomDialogController({
    builder: AiSettingsConfirmation({ password: $password, action: $action, keyAction: this.editor.keyAction,
      onConfirm: () => this.perform(), onCancel: () => this.clearConfirmation() }),
    customStyle: true, autoCancel: true, cancel: () => this.clearConfirmation()
  });

  aboutToDisappear(): void { this.clearConfirmation(); this.keyboard.clear(); this.leaveConfirmation.settle(false); }

  private clearConfirmation(): void {
    clearTimeout(this.passwordTimer); this.passwordTimer = -1; this.password = ''; this.action = ''; this.confirmation.close();
  }

  private confirm(action: string): void {
    if (this.editor.busy) return;
    this.clearConfirmation(); this.action = action;
    this.passwordTimer = setTimeout(() => this.clearConfirmation(), 60000);
    this.confirmation.open();
  }

  private async saveAndReturn(password: string, action: string): Promise<void> {
    const saved = action === 'check' ? await this.editor.checkSave() :
      await this.editor.save(password, action === 'retry', action === 'restore');
    if (saved) this.onSaved();
  }

  private perform(): void {
    const action = this.action, password = this.password;
    this.clearConfirmation();
    if (action === 'save' || action === 'retry' || action === 'restore') void this.saveAndReturn(password, action);
    else if (action === 'preview') void this.editor.previewDeployment(password);
    else if (action === 'models' || action === 'test') void this.editor.probe(action, password);
  }

  private resetForm(): void {
    void this.leaveConfirmation.ask('重新填写', '将清空当前填写，按已读取的最新设置重新填写。', '重新填写', '继续编辑')
      .then((accepted: boolean) => { if (accepted) this.editor.useLatest(); });
  }

  private endEditing(): void {
    if (!this.editor.hasUnsavedChanges()) { this.onDone(); return; }
    void this.leaveConfirmation.ask('结束编辑', this.editor.leaveMessage(), '结束编辑', '继续编辑')
      .then((accepted: boolean) => { if (accepted) this.onDone(); });
  }

  private selectArrow(): SymbolGlyphModifier {
    const modifier = new SymbolGlyphModifier($r('sys.symbol.chevron_down'));
    modifier.fontSize(14); modifier.fontColor([$r('app.color.muted')]);
    return modifier;
  }

  @Builder
  private choice(field: string, options: SelectOption[], selected: number, value: string) {
    Select(options).selected(selected).value(value).controlSize(ControlSize.SMALL)
      .font({ size: 14, weight: FontWeight.Regular, family: workspaceSansFamily(this.breakpoint) })
      .fontColor($r('app.color.body')).backgroundColor($r('app.color.canvas'))
      .menuBackgroundColor($r('app.color.canvas')).optionBgColor($r('app.color.canvas'))
      .optionFont({ size: 14, weight: FontWeight.Regular, family: workspaceSansFamily(this.breakpoint) }).optionFontColor($r('app.color.ink'))
      .selectedOptionBgColor($r('app.color.surface_card')).selectedOptionFontColor($r('app.color.ink'))
      .width('100%').height(44).padding({ left: 12, right: 8 }).borderRadius(8)
      .border({ width: 1, color: $r('app.color.hairline') }).space(8).arrowModifier(this.selectArrow())
      .id('settings_ai_' + field).onSelect((index: number) => {
        if (field === 'provider') this.editor.change(field, index === 0 ? 'deepseek' : 'custom');
        else if (field === 'endpointAction') this.editor.change(field, index === 0 ? 'keep' : 'replace');
        else if (field === 'keyAction') this.editor.change(field, ['keep', 'replace', 'remove'][index]);
        else if (field === 'thinking') this.editor.change(field, ['', 'disabled', 'low'][index]);
        else this.editor.change('model', this.editor.models[index]);
      })
  }

  @Builder
  private label(value: string) {
    Text(value).fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted')).width('100%')
  }

  @Builder
  private input(field: string, value: string, placeholder: string, secret: boolean = false) {
    TextInput({ text: value, placeholder }).id(`settings_ai_${field}`)
      .type(secret ? InputType.Password : InputType.Normal).monopolizeEvents(secret)
      .height(44).fontSize(16).fontColor($r('app.color.ink')).backgroundColor($r('app.color.canvas'))
      .borderRadius(8).border({ width: 1, color: $r('app.color.hairline') })
      .onFocus(() => this.keyboard.focus(this.getUIContext(), `settings_ai_${field}`, 'settings_ai_fields'))
      .onBlur(() => this.keyboard.blur(`settings_ai_${field}`))
      .onChange((text: string) => this.editor.change(field, text))
  }

  build() {
    Column() {
      Scroll(this.scroller) {
        Column({ space: 16 }) {
          if (this.wide) {
            Text('修改 AI 设置').fontFamily(workspaceSerifFamily(this.breakpoint)).fontSize(24)
              .fontColor($r('app.color.ink')).width('100%')
          }
          Column({ space: 12 }) {
            Text('修改当前工作台的 AI 服务。保存后新任务使用新配置，已在执行的任务保持原配置。')
              .fontSize(14).lineHeight(22).fontColor($r('app.color.muted')).width('100%')
            this.label('服务商')
            this.choice('provider', [{ value: 'DeepSeek' }, { value: '自定义服务' }],
              this.editor.provider === 'deepseek' ? 0 : 1, this.editor.provider === 'deepseek' ? 'DeepSeek' : '自定义服务')
            if (this.editor.provider === 'custom') {
              this.label('完整生成接口')
              Text(this.editor.latest?.endpointDisplay || '尚未设置').fontSize(12).fontColor($r('app.color.muted')).width('100%')
              this.choice('endpointAction', [{ value: '保留已设置的完整地址' }, { value: '重新填写完整地址' }],
                this.editor.endpointAction === 'keep' ? 0 : 1, this.editor.endpointAction === 'keep' ? '保留已设置的完整地址' : '重新填写完整地址')
            }
            if (this.editor.endpointAction === 'replace') {
              this.input('endpoint', this.editor.endpoint, 'https://example.com/v1/chat/completions')
              Text('填写服务提供方的完整生成接口，地址范围由工作台部署者设置。')
                .fontSize(12).fontColor($r('app.color.muted')).width('100%')
            }
            this.label('API Key')
            Text(this.editor.latest?.hasKey ? '已设置' : '尚未设置').fontSize(12).fontColor($r('app.color.muted')).width('100%')
            this.choice('keyAction', [{ value: this.editor.latest?.hasKey ? '保留已保存的 Key' : '暂不设置 Key' }, { value: '替换 Key' }, { value: '移除 Key' }],
              this.editor.keyAction === 'keep' ? 0 : this.editor.keyAction === 'replace' ? 1 : 2,
              this.editor.keyAction === 'keep' ? (this.editor.latest?.hasKey ? '保留已保存的 Key' : '暂不设置 Key') : this.editor.keyAction === 'replace' ? '替换 Key' : '移除 Key')
            if (this.editor.keyAction === 'replace') this.input('key', this.editor.key, '输入目标服务的新 API Key', true)
            if (this.editor.keyAction === 'remove') {
              Text('保存后移除密钥，依赖此密钥的 AI 功能将不可用；学习记录仍保留。')
                .fontSize(12).fontColor($r('app.color.muted')).width('100%')
            }
            this.label('模型')
            this.input('model', this.editor.model, '填写模型名称')
            if (this.editor.models.length) {
              this.choice('model_list', this.editor.models.map((model: string): SelectOption => ({ value: model })), -1, '从已读取列表选择')
            }
            Text(this.editor.provider === 'deepseek' ? 'Key 从 DeepSeek 开放平台的 API keys 页面获取；模型可手填或主动读取。' : '模型名称由服务提供方提供；自定义服务保留手动填写。')
              .fontSize(12).fontColor($r('app.color.muted')).width('100%')
            ToolbarAction({ label: this.details ? '收起更多选项' : '更多选项', showIcon: false, segmented: true, controlHeight: 44,
              onAction: () => expandSection(this.getUIContext(), () => this.details = !this.details) })
            if (this.details) {
              this.label('轻量任务模型（空值沿用主模型）')
              this.input('lightModel', this.editor.lightModel, '沿用主模型')
              this.label('上下文容量声明')
              this.input('contextWindowTokens', this.editor.contextWindowTokens, '使用默认')
              Text('非空时填写大于 98304 的整数；留空使用默认。更换服务地址或模型后，请重新确认容量。')
                .fontSize(12).fontColor($r('app.color.muted')).width('100%')
              if (this.editor.thinkingSupported()) {
                this.label('推理方式')
                this.choice('thinking', [{ value: '跟随服务' }, { value: '关闭思考' }, { value: '低强度思考' }],
                  ['', 'disabled', 'low'].indexOf(this.editor.thinking),
                  this.editor.thinking === 'disabled' ? '关闭思考' : this.editor.thinking === 'low' ? '低强度思考' : '跟随服务')
              }
              ToolbarAction({ label: '核对部署配置', showIcon: false, onAction: () => this.confirm('preview') })
            }
          }.id('settings_ai_fields').width('100%').padding(16).alignItems(HorizontalAlign.Start)
            .backgroundColor($r('app.color.surface_soft')).borderRadius(12)
            .border({ width: 1, color: $r('app.color.hairline') })
            .enabled(this.editor.writable && !this.editor.busy && !this.editor.pending && !this.action)
            .onAreaChange(() => this.keyboard.reveal(this.getUIContext()))
          if (this.editor.preview) {
            Text(`部署配置：${this.editor.preview.provider === 'deepseek' ? 'DeepSeek' : '自定义服务'}\n服务地址：${this.editor.preview.endpointDisplay || '未设置地址'}\n模型：${this.editor.preview.model || '未设置'}；密钥：${this.editor.preview.hasKey ? '已设置' : '未设置'}`)
              .fontSize(13).lineHeight(20).fontColor($r('app.color.ink')).width('100%')
            ToolbarAction({ label: '恢复此部署配置', showIcon: false, available: !this.editor.busy && !this.editor.pending,
              onAction: () => this.confirm('restore') })
          }
          if (this.editor.error) Text(this.editor.error).id('settings_ai_write_error').fontSize(13).fontColor($r('app.color.error')).width('100%')
          if (this.editor.message) Text(this.editor.message).id('settings_ai_write_status').fontSize(13).fontColor($r('app.color.muted')).width('100%')
          if (this.editor.probeStatus) Text(this.editor.probeStatus).fontSize(13).fontColor($r('app.color.muted')).width('100%')
          if (this.editor.busy) LoadingProgress().width(20).height(20).color($r('app.color.primary'))
          if (this.editor.checking) ToolbarAction({ label: '停止等待检查', showIcon: false, onAction: () => this.editor.cancelProbe() })
          if (this.editor.pending) {
            ToolbarAction({ label: '核对保存结果', showIcon: false, busy: this.editor.busy, onAction: () => { void this.saveAndReturn('', 'check'); } })
            if (this.editor.canRetry()) ToolbarAction({ label: '重试原保存', showIcon: false, available: !this.editor.busy, onAction: () => this.confirm('retry') })
          }
          if (!this.action) {
            Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(8), cross: LengthMetrics.vp(8) } }) {
              ToolbarAction({ label: '读取模型', showIcon: false, available: this.editor.writable && this.editor.provider === 'deepseek' && !this.editor.busy && !this.editor.pending,
                onAction: () => this.confirm('models') }).id('settings_ai_models')
              ToolbarAction({ label: '尝试生成', showIcon: false, available: this.editor.writable && !this.editor.busy && !this.editor.pending,
                onAction: () => this.confirm('test') }).id('settings_ai_test')
              if (this.details || this.editor.error || this.editor.message || this.editor.pending) {
                ToolbarAction({ label: '读取最新设置', showIcon: false, available: !this.editor.busy, onAction: () => this.editor.reviewLatest() })
                ToolbarAction({ label: '按最新设置重新填写', showIcon: false, available: !this.editor.busy,
                  onAction: () => this.resetForm() })
              }
            }.width('100%')
          }
        }.width('100%').constraintSize({ maxWidth: 600 })
          .padding({ left: this.wide ? 32 : 16, right: this.wide ? 32 : 16, top: 20, bottom: 24 })
          .alignItems(HorizontalAlign.Start)
      }.id('settings_ai_scroll').layoutWeight(1).width('100%').align(Alignment.Top).scrollBar(BarState.Auto)
        .onAreaChange(() => this.keyboard.reveal(this.getUIContext()))
      Row({ space: 8 }) {
        ConnectionAction({ label: '取消', available: !this.editor.busy,
          onAction: () => this.endEditing() }).id('settings_ai_cancel')
        ConnectionAction({ label: '保存设置', primary: true, available: this.editor.writable && !this.editor.busy && !this.editor.pending,
          onAction: () => this.confirm('save') }).id('settings_ai_save')
      }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 8 })
        .justifyContent(FlexAlign.End).border({ width: { top: 1 }, color: $r('app.color.hairline') })
    }.width('100%')
  }
}

@CustomDialog
struct AiSettingsConfirmation {
  controller?: CustomDialogController;
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @Link password: string;
  @Link action: string;
  keyAction: string = 'keep';
  onConfirm: () => void = () => {};
  onCancel: () => void = () => {};
  private scroller: Scroller = new Scroller();
  private keyboard: FormKeyboardContext = new FormKeyboardContext(this.scroller, 'settings_ai_confirmation_scroll');

  aboutToDisappear(): void { this.password = ''; this.keyboard.clear(); }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('确认操作').fontFamily(workspaceSansFamily(this.breakpoint)).fontSize(18).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
        ToolbarAction({ label: '取消操作', showLabel: false, segmented: true, useSymbol: true,
          symbol: $r('sys.symbol.xmark'), controlHeight: 44, iconWidth: 44, onAction: this.onCancel })
      }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 12 })
      Scroll(this.scroller) {
        Column({ space: 16 }) {
          Text(this.action === 'test' ? '尝试生成将使用服务商额度；再次输入工作台访问密码后执行。' :
            this.action === 'restore' ? '恢复将替换当前工作台的 AI 配置，请再次输入访问密码确认。' :
            this.action === 'save' && this.keyAction === 'remove' ? '确认移除 API Key：再次输入工作台访问密码后保存。' :
            '请再次输入工作台访问密码以确认本次操作。')
            .fontSize(14).lineHeight(22).fontColor($r('app.color.muted')).width('100%')
          TextInput({ text: this.password, placeholder: '工作台访问密码' }).type(InputType.Password).monopolizeEvents(true)
            .height(48).fontSize(16).fontColor($r('app.color.ink')).backgroundColor($r('app.color.canvas'))
            .borderRadius(8).border({ width: 1, color: $r('app.color.hairline') }).id('settings_ai_password')
            .onChange((value: string) => this.password = value)
            .onFocus(() => this.keyboard.focus(this.getUIContext(), 'settings_ai_password', 'settings_ai_confirmation'))
            .onBlur(() => this.keyboard.blur('settings_ai_password'))
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.End,
            space: { main: LengthMetrics.vp(12), cross: LengthMetrics.vp(8) } }) {
            ConnectionAction({ label: '取消', onAction: this.onCancel }).id('settings_ai_confirm_cancel')
            ConnectionAction({ label: '确认操作', primary: true,
              available: !!this.password, onAction: this.onConfirm }).id('settings_ai_confirm_submit')
          }.width('100%')
        }.width('100%').padding(16).id('settings_ai_confirmation')
      }.id('settings_ai_confirmation_scroll').width('100%').height(LayoutPolicy.wrapContent)
        .constraintSize({ maxHeight: 320 }).scrollBar(BarState.Auto)
        .onAreaChange(() => this.keyboard.reveal(this.getUIContext()))
    }.width('92%').height(LayoutPolicy.wrapContent).constraintSize({ maxWidth: 440, maxHeight: '84%' })
      .backgroundColor($r('app.color.canvas')).borderRadius(12)
      .border({ width: 1, color: $r('app.color.hairline') })
  }
}
