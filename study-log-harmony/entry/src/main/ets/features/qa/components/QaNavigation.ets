import { RagSessionSummary } from '../QaModels';
import { WORKSPACE_TIPS } from '../../../common/ui/WorkspaceTips';
import { InteractiveSurface, animateHover } from '../../../common/ui/InteractiveSurface';
import { InlineStatus } from '../../../common/ui/FeedbackStates';
import { SearchField } from '../../../common/ui/FormControls';

@Component
export struct QaNavigation {
  @Prop qaSessions: RagSessionSummary[] = [];
  @Prop qaSessionQuery: string = '';
  @Prop qaActiveSessionId: string = '';
  @Prop qaBusy: boolean = false;
  @Prop qaNavigationLoading: boolean = false;
  @Prop qaNavigationError: string = '';
  @Prop qaRenameId: string = '';
  @Prop qaRenameTitle: string = '';
  @Prop qaMenuId: string = '';
  @Prop qaSearchRevision: number = 0;
  @Prop qaRailPopover: string = '';
  @Prop moduleFrameHeight: number = 0;
  @State private hoveredNavigation: string = '';
  onQuery: (query: string) => void = () => {};
  onSession: (id: string) => void = () => {};
  onMenu: (id: string) => void = () => {};
  onStartRename: (session: RagSessionSummary) => void = () => {};
  onRenameTitle: (title: string) => void = () => {};
  onCommitRename: () => void = () => {};
  onCancelRename: () => void = () => {};
  onDelete: (session: RagSessionSummary) => void = () => {};
  onRetry: () => void = () => {};

  private filteredQaSessions(): RagSessionSummary[] {
    const query = this.qaSessionQuery.trim().toLowerCase();
    if (!query) return this.qaSessions;
    return this.qaSessions.filter((session: RagSessionSummary) =>
      `${session.title}\n${session.lastQuestion}`.toLowerCase().includes(query)
    );
  }

  private qaSessionsForGroup(label: string): RagSessionSummary[] {
    return this.filteredQaSessions().filter((session: RagSessionSummary) => this.qaSessionGroup(session) === label);
  }

  private qaSessionGroup(session: RagSessionSummary): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const updated = new Date(session.updatedAt);
    const timestamp = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate()).getTime();
    const days = Math.floor((today - timestamp) / 86400000);
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    if (days <= 7) return '近7天';
    return '更早';
  }

  private qaUpdatedLabel(session: RagSessionSummary): string {
    const value = new Date(session.updatedAt);
    const now = new Date();
    const sameDay = value.getFullYear() === now.getFullYear() && value.getMonth() === now.getMonth() &&
      value.getDate() === now.getDate();
    const pad = (number: number): string => number.toString().padStart(2, '0');
    return sameDay ? `${pad(value.getHours())}:${pad(value.getMinutes())}` :
      `${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }

  @Builder
  private qaSessionMenu(session: RagSessionSummary) {
    Column({ space: 2 }) {
      Button({ type: ButtonType.Normal }) {
        Text('重命名').fontSize(12).fontColor($r('app.color.body')).width('100%')
      }.width('100%').height(30).padding({ left: 8, right: 8 }).backgroundColor(Color.Transparent).borderRadius(6)
        .onClick(() => this.onStartRename(session))
      Button({ type: ButtonType.Normal }) {
        Text('删除').fontSize(12).fontColor($r('app.color.error')).width('100%')
      }.width('100%').height(30).padding({ left: 8, right: 8 }).backgroundColor(Color.Transparent).borderRadius(6)
        .onClick(() => { this.onMenu(''); this.onDelete(session); })
    }.width(116).padding(5).backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
  }

  @Builder
  private qaSessionGroupContent(label: string) {
    if (this.qaSessionsForGroup(label).length > 0) {
      ListItem() {
        Text(label).fontSize(12).fontWeight(600).fontColor($r('app.color.muted')).width('100%')
      }.padding({ top: 10, bottom: 2 })
      ForEach(this.qaSessionsForGroup(label), (session: RagSessionSummary) => {
        ListItem() {
          if (this.qaRenameId === session.id) {
            Row({ space: 6 }) {
              TextInput({ text: this.qaRenameTitle, placeholder: '会话标题' })
                .layoutWeight(1).height(38).fontSize(13).backgroundColor($r('app.color.canvas'))
                .border({ width: 1, color: $r('app.color.primary') }).borderRadius(8)
                .monopolizeEvents(true)
                .onChange((value: string) => this.onRenameTitle(value))
                .onSubmit(() => this.onCommitRename())
              Button('保存', { type: ButtonType.Normal }).height(38).padding({ left: 10, right: 10 }).fontSize(12)
                .fontColor($r('app.color.on_primary')).backgroundColor($r('app.color.primary')).borderRadius(8)
                .onClick(() => this.onCommitRename())
              Button({ type: ButtonType.Normal }) {
                SymbolGlyph($r('sys.symbol.xmark')).fontSize(14).fontColor([$r('app.color.muted')])
              }.width(38).height(38).padding(0).backgroundColor(Color.Transparent).borderRadius(6).clip(true)
                .onClick(() => this.onCancelRename())
            }.width('100%')
          } else {
            Column({ space: 5 }) {
              Row() {
                Button({ type: ButtonType.Normal }) {
                  Row({ space: 8 }) {
                    Text(session.title).fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.body'))
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
                    Text(this.qaUpdatedLabel(session)).fontSize(11).fontColor($r('app.color.muted_soft')).flexShrink(0)
                  }.width('100%')
                }
                .id(`qa_session_${session.id}`)
                .accessibilitySelected(this.qaActiveSessionId === session.id)
                .layoutWeight(1).height(38).padding({ left: 8, right: 5 }).backgroundColor(Color.Transparent)
                .borderRadius(8).clip(true)
                .hoverEffect(HoverEffect.None)
                .onClick(() => this.onSession(session.id)).enabled(!this.qaBusy)
                Button({ type: ButtonType.Normal }) {
                  Text('⋯').fontSize(19).fontColor($r('app.color.muted'))
                }
                .width(26).height(26).margin({ right: 2 }).padding(0).backgroundColor(Color.Transparent).borderRadius(6).clip(true)
                .accessibilityText(`管理会话：${session.title}`).bindTips(`管理会话：${session.title}`, WORKSPACE_TIPS)
                .onClick(() => this.onMenu(this.qaMenuId === session.id ? '' : session.id))
                .enabled(!this.qaBusy)
                .bindPopup(this.qaMenuId === session.id, {
                  builder: this.qaSessionMenu(session),
                  placement: Placement.BottomRight,
                  enableArrow: false,
                  popupColor: $r('app.color.canvas'),
                  radius: 8,
                  onStateChange: (event) => {
                    if (!event.isVisible && this.qaMenuId === session.id) this.onMenu('');
                  }
                })
              }.width('100%')
            }
            .width('100%')
            .attributeModifier(new InteractiveSurface(this.qaActiveSessionId === session.id ? $r('app.color.surface_card') : Color.Transparent, this.hoveredNavigation === `qa-${session.id}`, this.qaActiveSessionId === session.id))
            .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredNavigation = hover ? `qa-${session.id}` : ''))
            .border({ width: { left: 2 }, color: this.qaActiveSessionId === session.id ? $r('app.color.primary') : Color.Transparent })
            .borderRadius(8).clip(true)
          }
        }
      }, (session: RagSessionSummary) => `${session.id}:${session.version}`)
    }
  }

  @Builder
  private qaNavigationContent() {
    Column({ space: 10 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 7 }) {
          SymbolGlyph($r('sys.symbol.plus')).fontSize(15).fontColor([$r('app.color.ink')])
          Text('新建问答').fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        }.justifyContent(FlexAlign.Center)
      }
      .width('100%').height(40).padding(0).backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
      .enabled(!this.qaBusy).onClick(() => this.onSession(''))
      SearchField({
        value: this.qaSessionQuery,
        placeholder: '搜索历史问答',
        focusKey: 'qa_session_search',
        focusRevision: this.qaSearchRevision,
        compact: true,
        showSubmit: false,
        onChange: (value: string) => this.onQuery(value),
        onSubmit: () => {}
      })
      List({ space: 4 }) {
        if (this.qaNavigationLoading) {
          ListItem() {
            Row({ space: 8 }) {
              LoadingProgress().width(18).height(18).color($r('app.color.primary'))
              Text('正在加载历史记录').fontSize(12).fontColor($r('app.color.muted'))
            }.width('100%').height(52).justifyContent(FlexAlign.Center)
          }
        } else if (this.qaNavigationError) {
          ListItem() {
            InlineStatus({ text: this.qaNavigationError, error: true, retry: true,
              onRetry: () => this.onRetry() })
          }
        } else if (this.filteredQaSessions().length === 0) {
          ListItem() {
            Text(this.qaSessionQuery ? '未找到匹配会话' : '暂无历史问答')
              .fontSize(12).fontColor($r('app.color.muted')).width('100%').padding(10)
          }
        } else {
          this.qaSessionGroupContent('今天')
          this.qaSessionGroupContent('昨天')
          this.qaSessionGroupContent('近7天')
          this.qaSessionGroupContent('更早')
        }
      }
      .id('qa_history_list').layoutWeight(1).width('100%')
      .scrollBar(BarState.Auto).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
    }
    .layoutWeight(1).width('100%').padding({ left: 14, right: 14, top: 14, bottom: 28 })
  }

  @Builder
  private qaRailPopoverPanel() {
    Column({ space: 10 }) {
      Text(this.qaRailPopover === 'search' ? '搜索历史' : '最近问答')
        .width('100%').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
      if (this.qaRailPopover === 'search') {
        SearchField({
          value: this.qaSessionQuery,
          placeholder: '搜索历史问答',
          focusKey: 'qa_rail_search',
          compact: true,
          showSubmit: false,
          onChange: (value: string) => this.onQuery(value),
          onSubmit: () => {}
        })
      }
      List({ space: 4 }) {
        if (this.qaNavigationLoading) {
          ListItem() {
            Row({ space: 8 }) {
              LoadingProgress().width(18).height(18).color($r('app.color.primary'))
              Text('正在加载历史记录').fontSize(12).fontColor($r('app.color.muted'))
            }.width('100%').height(52).justifyContent(FlexAlign.Center)
          }
        } else if (this.qaNavigationError) {
          ListItem() {
            InlineStatus({ text: this.qaNavigationError, error: true, retry: true,
              onRetry: () => this.onRetry() })
          }
        } else if (this.filteredQaSessions().length === 0) {
          ListItem() {
            Text(this.qaSessionQuery ? '未找到匹配会话' : '暂无历史问答')
              .fontSize(12).fontColor($r('app.color.muted')).width('100%').padding(10)
          }
        } else {
          this.qaSessionGroupContent('今天')
          this.qaSessionGroupContent('昨天')
          this.qaSessionGroupContent('近7天')
          this.qaSessionGroupContent('更早')
        }
      }.layoutWeight(1).width('100%').scrollBar(BarState.Auto).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
    }
    .width(300).height(Math.min(520, Math.max(180, this.moduleFrameHeight - 32))).padding(14)
    .backgroundColor($r('app.color.canvas'))
    .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(10)
    .zIndex(40)
  }

  build() {
    if (this.qaRailPopover) {
      this.qaRailPopoverPanel()
    } else {
      this.qaNavigationContent()
    }
  }
}
