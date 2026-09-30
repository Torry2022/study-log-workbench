import { BackToTopControl } from '../../common/ui/BackToTopControl';
import { EmptyState, InlineStatus, LoadFailure } from '../../common/ui/FeedbackStates';
import { ModulePageHeader } from '../../common/ui/WorkspaceChrome';
import { KeyCode } from '@kit.InputKit';
import { workspaceKey, textNavigationKey } from '../../common/ui/WorkspaceKeys';
import { WORKSPACE_TIPS } from '../../common/ui/WorkspaceTips';
import { LoadingHintAnchor, LoadingHintPlacement } from '../../common/ui/LoadingHintAnchor';
import { ContentLoadingState } from '../../common/ui/ContentLoadingState';
import { MarkdownReader } from '../../common/ui/MarkdownReader';
import { apiClient } from '../../common/network/ApiClient';
import { WorkspaceBreakpoint, READING_MAX_WIDTH } from '../../common/AppConfig';
import { FrameAction } from '../../common/ui/FrameAction';
import { RagChatMessage, RagCitation, RagSessionSummary } from './QaModels';
import { QaSessionController } from './QaSessionController';

interface QaRenderMessage {
  role: string;
  content: string;
  failure?: string;
  attemptId?: string;
}

@Component
export struct QaPage {
  @Prop @Watch('topRequested') topRevision: number = 0;

  private topRequested(): void {
    if (this.topRevision > 0) this.scrollToTopRequestRevision++;
  }
  @Prop @Watch('workspaceLayoutChanged') workspaceLayoutRevision: number = 0;
  onWorkspaceLayoutReady: () => void = () => {};
  onBeforeSessionChange: () => Promise<void> = async () => {};
  onLoadingHintChange: (placement: LoadingHintPlacement) => void = () => {};
  onSessionReady: () => void = () => {};
  onWorkspaceKey: (event: KeyEvent) => boolean = () => false;

  private workspaceLayoutChanged(): void {
    if (this.data.messages.length === 0) this.onWorkspaceLayoutReady();
  }
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop themePreference: string = 'system';
  @Prop workspaceActive: boolean = true;
  @Prop configured: boolean = false;
  @Prop navigationSessionId: string = '';
  @Prop @Watch('navigationRequestChanged') navigationRequestRevision: number = 0;
  @Prop @Watch('discardRequested') discardRevision: number = 0;
  @Prop @Watch('questionFocusRequestChanged') questionFocusRevision: number = 0;
  onSessionsChange: (sessions: RagSessionSummary[]) => void = () => {};
  onSessionsError: (message: string) => void = () => {};
  onActiveSessionChange: (id: string) => void = () => {};
  onBusyChange: (busy: boolean) => void = () => {};
  onDraftChange: (dirty: boolean) => void = () => {};
  onPendingChange: (pending: boolean) => void = () => {};
  onCitation: (date: string, heading: string, headingIndex: number) => void = () => {};
  onScrollStateChange: (scrolled: boolean) => void = () => {};
  onOpenLog: () => void = () => {};
  @State private data: QaSessionController = new QaSessionController(apiClient, {
    onSessionsChange: (sessions: RagSessionSummary[]) => this.onSessionsChange(sessions),
    onSessionsError: (message: string) => this.onSessionsError(message),
    onActiveSessionChange: (id: string) => this.onActiveSessionChange(id),
    onBusyChange: (busy: boolean) => {
      if (busy) this.onDraftChange(false);
      this.onBusyChange(busy);
    },
    onPendingChange: (pending: boolean) => this.onPendingChange(pending),
    onSessionReady: () => this.onSessionReady(),
    onBeforeSessionChange: () => this.onBeforeSessionChange(),
    resetComposerScroll: () => this.resetComposerScroll(),
    beforeSend: () => this.getUIContext().getFocusController().clearFocus(),
    showComposer: () => this.setComposerHidden(false),
    afterFrame: (action: () => void) => this.getUIContext().postFrameCallback(new FrameAction(action))
  });
  @State private composerHidden: boolean = false;
  @State private composerHeight: number = 132;
  @State private contentViewportWidth: number = 0;
  @State private readerScrollOffset: number = 0;
  @State private readerScrollProgress: number = 0;
  @State private scrollToTopRequestRevision: number = 0;
  @State private questionFocused: boolean = false;
  private composingQuestion: boolean = false;
  private questionController: TextAreaController = new TextAreaController();
  private questionSelectionStart: number = 0;
  private questionSelectionEnd: number = 0;
  @State private topDividerOffset: number = 0;
  private lastScrollY: number = 0;
  private scrollTravel: number = 0;
  private scrollDirection: number = 0;

  private isLargeWorkspace(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  aboutToAppear(): void { this.data.activate(); }

  private focusQuestion(): void {
    this.questionFocused = true;
    this.setComposerHidden(false);
  }

  private blurQuestion(): void {
    this.questionFocused = false;
  }

  aboutToDisappear(): void { this.data.dispose(); this.blurQuestion(); }

  private navigationRequestChanged(): void {
    if (this.navigationRequestRevision <= 0) return;
    this.data.question = '';
    this.onDraftChange(false);
    this.onPendingChange(false);
    if (this.navigationSessionId) this.data.openSession(this.navigationSessionId);
    else this.data.newSession();
  }

  private discardRequested(): void {
    this.onDraftChange(false);
    this.data.newSession();
  }

  private questionFocusRequestChanged(): void {
    if (this.questionFocusRevision <= 0) return;
    const focusRevision = this.questionFocusRevision;
    const sessionRevision = this.data.sessionRequestRevision;
    setTimeout(() => {
      if (this.data.pageDisposed || !this.workspaceActive || focusRevision !== this.questionFocusRevision ||
        sessionRevision !== this.data.sessionRequestRevision) return;
      focusControl.requestFocus('qa_question_input');
    }, 20);
  }

  private scheduleQuestionCaret(position: number): void {
    const revision = this.data.sessionRequestRevision;
    const question = this.data.question;
    setTimeout(() => {
      if (this.data.pageDisposed || !this.workspaceActive || revision !== this.data.sessionRequestRevision || question !== this.data.question) return;
      this.questionController.caretPosition(position);
    }, 0);
  }

  private editFailedQuestion(id: string): void {
    const attempt = this.data.failedAttempt;
    if (!attempt || attempt.answerId !== id || this.data.sending) return;
    const restore = (): void => {
      if (this.data.failedAttempt !== attempt || this.data.sending) return;
      this.data.question = attempt.request.question;
      this.data.editingFailedId = id;
      this.data.answerMode = attempt.request.mode || 'logs_only';
      this.setComposerHidden(false);
      this.getUIContext().getFocusController().requestFocus('qa_question_input');
    };
    if (this.data.question.trim() && this.data.question !== attempt.request.question) {
      AlertDialog.show({ message: '输入框已有其他草稿，要替换为失败的问题吗？',
        primaryButton: { value: '保留草稿', action: () => {} },
        secondaryButton: { value: '替换草稿', action: restore } });
    } else restore();
  }

  private resetComposerScroll(): void {
    this.lastScrollY = 0;
    this.scrollTravel = 0;
    this.scrollDirection = 0;
    this.readerScrollOffset = 0;
    this.readerScrollProgress = 0;
    this.topDividerOffset = 0;
    this.onScrollStateChange(false);
    this.questionFocused = false;
    this.setComposerHidden(false);
  }

  private setComposerHidden(hidden: boolean): void {
    if (this.composerHidden === hidden) return;
    this.composerHidden = hidden;
  }

  private handleReaderScroll(yOffset: number): void {
    this.readerScrollOffset = Math.max(0, yOffset);
    this.onScrollStateChange(this.topDividerOffset > 0 && this.readerScrollOffset >= this.topDividerOffset - 0.5);
    if (this.readerScrollOffset <= 8) {
      this.lastScrollY = yOffset;
      this.scrollTravel = 0;
      this.scrollDirection = 0;
      this.setComposerHidden(false);
      return;
    }
    if (this.data.question.trim() || this.data.sending) {
      this.setComposerHidden(false);
      this.lastScrollY = yOffset;
      this.scrollTravel = 0;
      return;
    }
    const delta = yOffset - this.lastScrollY;
    this.lastScrollY = yOffset;
    if (Math.abs(delta) < 2) return;
    const nextDirection = delta > 0 ? 1 : -1;
    if (nextDirection !== this.scrollDirection) {
      this.scrollDirection = nextDirection;
      this.scrollTravel = 0;
    }
    this.scrollTravel += Math.abs(delta);
    if (this.scrollTravel < 48) return;
    this.setComposerHidden(nextDirection > 0);
    this.scrollTravel = 0;
  }

  private backToTopVisible(): boolean {
    return this.data.messages.length > 0 && this.readerScrollOffset > 8 && !this.questionFocused && !this.data.sending;
  }

  @Builder
  private qaBackToTopButton() {
    Stack() {
      BackToTopControl({
        visible: this.backToTopVisible(),
        progress: this.readerScrollProgress,
        scrollOffset: this.readerScrollOffset,
        onBackToTop: () => {
          this.setComposerHidden(false);
          this.scrollToTopRequestRevision += 1;
        }
      })
    }
    .width(48)
    .height(48)
    .margin({ right: this.isLargeWorkspace() ? 24 : 14, bottom: this.isLargeWorkspace() ? 24 : 14 })
    .translate({ y: this.isLargeWorkspace() || this.composerHidden ? 0 : -120 })
    .animation({ duration: 140, curve: Curve.Ease })
    .zIndex(4)
  }

  private conversationPayload(): string {
    const messages: QaRenderMessage[] = this.data.messages.map((message: RagChatMessage): QaRenderMessage => ({
      role: message.role,
      content: message.role === 'user' ? message.content : this.answerMarkdown(message) || this.data.statusText,
      failure: this.data.failedAttempt?.answerId === message.id ? this.data.errorMessage : '',
      attemptId: this.data.failedAttempt?.answerId === message.id ? message.id : ''
    }));
    return JSON.stringify(messages);
  }

  private answerMarkdown(message: RagChatMessage): string {
    let content = message.content;
    (message.citations || []).forEach((citation: RagCitation) => {
      if (!citation.date) return;
      const headingIndex = citation.headingIndex === undefined || citation.headingIndex === null ? -1 : citation.headingIndex;
      const token = `{{study-log-citation:${encodeURIComponent(citation.sourceId)}|${encodeURIComponent(citation.date)}|${headingIndex}|${encodeURIComponent(citation.heading || '')}}}`;
      content = content.split(`[${citation.sourceId}]`).join(token);
    });
    return content;
  }

  private composerHorizontalInset(): number {
    if (this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT) return 16;
    if (!this.isLargeWorkspace()) return 24;
    return Math.max(24, 96 - Math.max(0, (this.contentViewportWidth - READING_MAX_WIDTH) / 2));
  }

  build() {
    Column() {
      if (this.isLargeWorkspace()) {
        ModulePageHeader({ title: '知识问答',
          headerId: 'desktop_page_qa', onOpenLog: this.onOpenLog })
      }
      Stack({ alignContent: Alignment.BottomEnd }) {
      Row() {
        Column() {
          Stack({ alignContent: Alignment.BottomEnd }) {
            LoadingHintAnchor({ loading: this.data.messages.length > 0 &&
              (this.data.sessionLoading || this.data.pendingSessionKey.length > 0),
              onChange: this.onLoadingHintChange }).hitTestBehavior(HitTestMode.None)
            if (this.data.sessionLoading && this.data.messages.length === 0) {
              ContentLoadingState({ text: '正在加载会话…' }).padding({ bottom: this.composerHeight })
            } else if (this.data.failedSessionId && this.data.messages.length === 0) {
              Column() {
                LoadFailure({ title: '会话读取失败', message: this.data.errorMessage,
                  onRetry: () => this.data.openSession(this.data.failedSessionId) })
              }.width('100%').height('100%').padding({ bottom: this.composerHeight })
            } else if (this.data.messages.length === 0) {
              Column() {
                EmptyState({ symbol: $r('sys.symbol.message'), title: '从日志中提问', description: '例如：最近一个月主要学习了哪些方向？' })
              }
              .width('100%')
              .height('100%')
              .padding({ bottom: this.composerHeight })
            } else {
              MarkdownReader({
                onWorkspaceKey: (event: KeyEvent) => this.onWorkspaceKey(event),
                viewportRequestRevision: this.workspaceLayoutRevision,
                onViewportReady: this.onWorkspaceLayoutReady,
                onRenderReady: this.onWorkspaceLayoutReady,
                content: this.conversationPayload(),
                onQaAttemptAction: (id: string, action: string) => {
                  const attempt = this.data.failedAttempt;
                  if (!attempt || attempt.answerId !== id || this.data.sending) return;
                  if (action === 'retry') this.data.runAttempt(attempt);
                  else if (action === 'edit') this.editFailedQuestion(id);
                },
                documentKey: this.data.sessionDocumentKey,
                onRenderFailed: (documentKey: string) => {
                  if (documentKey !== this.data.pendingSessionKey) return;
                  this.data.pendingSessionKey = '';
                  this.data.failedSessionId = this.data.sessionId;
                  this.data.errorMessage = '会话内容渲染失败，请重试';
                  this.onSessionReady();
                },
                onContentRendered: (_content: string, documentKey: string) => {
                  if (!this.data.pendingSessionKey || documentKey !== this.data.pendingSessionKey) return;
                  this.data.pendingSessionKey = '';
                  this.onSessionReady();
                },
                contentMode: 'qa',
                fillAvailableWidth: true,
                followEnd: this.data.sending,
                showBackToTop: false,
                trackScrollProgress: true,
                scrollToTopRequestRevision: this.scrollToTopRequestRevision,
                themePreference: this.themePreference,
                onScrollPosition: (yOffset: number) => this.handleReaderScroll(yOffset),
                onScrollProgress: (progress: number) => this.readerScrollProgress = progress,
                onTopDividerPosition: (yOffset: number) => {
                  this.topDividerOffset = yOffset;
                  this.onScrollStateChange(yOffset > 0 && this.readerScrollOffset >= yOffset - 0.5);
                },
                onCitationLink: (date: string, heading: string, headingIndex: number) =>
                  this.onCitation(date, heading, headingIndex),
              })
                .width('100%')
                .height('100%')
                .padding({ bottom: this.composerHeight })
            }

            Column({ space: 6 }) {
              InlineStatus({ text: this.data.noticeMessage, error: false })
              InlineStatus({ text: this.data.failedAttempt || (this.data.failedSessionId && this.data.messages.length === 0) ? '' : this.data.errorMessage,
                error: true, retry: this.data.failedSessionId.length > 0 && !this.data.sending,
                onRetry: () => this.data.openSession(this.data.failedSessionId) })
              Column({ space: 8 }) {
                TextArea({ text: this.data.question, controller: this.questionController, placeholder: '询问学习日志中的内容' })
                  .width('100%').constraintSize({ minHeight: 42, maxHeight: 126 }).fontSize(14)
                  .padding({ left: 2, right: 2, top: 10, bottom: 10 })
                  .enterKeyType(EnterKeyType.NEW_LINE)
                  .key('qa_question_input').id('qa_question_input')
                  .monopolizeEvents(true)
                  .backgroundColor(Color.Transparent).border({ width: 0 }).borderRadius(0)
                  .enabled(!this.data.sending)
                  .onFocus(() => this.focusQuestion())
                  .onBlur(() => this.blurQuestion())
                  .onTextSelectionChange((start: number, end: number) => {
                    this.questionSelectionStart = start;
                    this.questionSelectionEnd = end;
                  })
                  .onChange((value: string, preview?: PreviewText) => {
                    this.composingQuestion = !!preview?.value;
                    this.data.question = value;
                    this.onDraftChange(!!value.trim());
                    if (value.trim()) this.setComposerHidden(false);
                  })
                  .onKeyPreIme((event: KeyEvent) => {
                    if (this.composingQuestion) return false;
                    if (workspaceKey(event, KeyCode.KEYCODE_ENTER, false, true)) {
                      const start = this.questionSelectionStart;
                      this.data.question = this.data.question.slice(0, start) + '\n' + this.data.question.slice(this.questionSelectionEnd);
                      this.scheduleQuestionCaret(start + 1);
                      return true;
                    }
                    if (workspaceKey(event, KeyCode.KEYCODE_ENTER)) { if (this.configured) this.data.send(); return true; }
                    return false;
                  })
                  .onKeyEvent((event: KeyEvent) => textNavigationKey(event))

                if (!this.configured) {
                  Text('当前实例尚未配置问答模型，仍可查看已有历史。')
                    .fontSize(11).fontColor($r('app.color.muted')).width('100%')
                }

                Row({ space: 8 }) {
                  Row({ space: 0 }) {
                    Button('仅依据日志', { type: ButtonType.Normal }).height(34).fontSize(12).fontWeight(FontWeight.Bold)
                      .padding({ left: 9, right: 9 }).borderRadius(4)
                      .clip(true)
                      .fontColor(this.data.answerMode === 'logs_only' ? $r('app.color.ink') : $r('app.color.muted'))
                      .backgroundColor(this.data.answerMode === 'logs_only' ? $r('app.color.canvas') : Color.Transparent)
                      .onClick(() => this.data.answerMode = 'logs_only')
                    Button('日志 + 通用知识', { type: ButtonType.Normal }).height(34).fontSize(12).fontWeight(FontWeight.Bold)
                      .padding({ left: 9, right: 9 }).borderRadius(4)
                      .clip(true)
                      .fontColor(this.data.answerMode === 'logs_and_general' ? $r('app.color.ink') : $r('app.color.muted'))
                      .backgroundColor(this.data.answerMode === 'logs_and_general' ? $r('app.color.canvas') : Color.Transparent)
                      .onClick(() => this.data.answerMode = 'logs_and_general')
                  }.height(42).padding(3).backgroundColor($r('app.color.surface_soft'))
                  .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(6).clip(true)
                  Blank()
                  if (this.data.sending && this.data.statusText) {
                    Text(this.data.statusText).fontSize(11).fontColor($r('app.color.muted')).maxLines(1)
                  }
                  Button({ type: ButtonType.Normal }) {
                    if (this.data.sending) Rect().width(13).height(13).fill(Color.White).radius(2)
                    else Image($r('app.media.send')).width(17).height(17).objectFit(ImageFit.Contain)
                  }
                  .width(42).height(42).padding(0).borderRadius(6).clip(true)
                  .id('qa_send')
                  .backgroundColor($r('app.color.primary'))
                  .fontColor(Color.White)
                  .opacity(this.data.sending && (this.data.receivedDone || !!this.data.pendingWrite) ||
                    !this.data.sending && (this.data.sessionLoading || this.data.question.trim().length === 0) ? 0.58 : 1)
                  .enabled(this.data.sending ? !this.data.receivedDone && !this.data.pendingWrite :
                    this.configured && !this.data.sessionLoading && this.data.question.trim().length > 0)
                  .accessibilityText(this.data.sending ? (this.data.receivedDone || !!this.data.pendingWrite ?
                    '正在保存回答' : '停止生成') : '发送问题')
                  .bindTips(this.data.sending ? (this.data.receivedDone || !!this.data.pendingWrite ?
                    '正在保存回答' : '停止生成') : '发送问题', WORKSPACE_TIPS)
                  .onClick(() => this.data.sending ? this.data.stop() : this.data.send())
                }
                .width('100%')
                .alignItems(VerticalAlign.Center)
              }
              .width('100%')
              .padding(10)
              .backgroundColor($r('app.color.canvas'))
              .border({ width: 0.5, color: $r('app.color.hairline_soft') })
              .borderRadius(12)
              .shadow({
                radius: this.getUIContext().vp2px(32),
                color: $r('app.color.popover_shadow'),
                offsetY: this.getUIContext().vp2px(12)
              })
            }
            .width('100%')
            .padding({ left: this.composerHorizontalInset(), right: this.composerHorizontalInset(), bottom: 10 })
            .opacity(this.composerHidden ? 0 : 1)
            .onAreaChange((_old, area) => this.composerHeight = Number(area.height))
            .translate({ y: this.composerHidden ? 150 : 0 })
            .hitTestBehavior(this.composerHidden ? HitTestMode.None : HitTestMode.Default)
            .animation({ duration: 140, curve: Curve.Ease })
            if (!this.isLargeWorkspace()) this.qaBackToTopButton()
          }
          .layoutWeight(1)
          .width('100%')
        }
        .width('100%').constraintSize({ maxWidth: READING_MAX_WIDTH })
        .height('100%').backgroundColor($r('app.color.canvas'))
      }
      .height('100%').width('100%').justifyContent(FlexAlign.Center)
        if (this.isLargeWorkspace()) this.qaBackToTopButton()
      }.layoutWeight(1).width('100%')
        .onAreaChange((_old, area) => this.contentViewportWidth = Number(area.width))
    }
    .width('100%').height('100%')
    .backgroundColor($r('app.color.canvas'))
  }
}
