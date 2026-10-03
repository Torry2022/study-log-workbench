import { WORKSPACE_TIPS } from '../../common/ui/WorkspaceTips';
import { workspacePreferences } from '../../common/storage/WorkspacePreferences';
import { appFeedback } from '../../common/ui/AppFeedback';
import { SegmentIndicator } from '../../common/ui/SegmentIndicator';
import { toolbarActionWidth } from '../../common/ui/ToolbarLayout';
import { MODULE_HEADER_LEFT_INSET } from '../../common/ui/WorkspaceChrome';
import { iconTint } from '../../common/ui/IconTint';
import { LengthMetrics } from '@kit.ArkUI';
import { ActionPanelHeader, ModulePageTitle, ModuleLogButton } from '../../common/ui/WorkspaceChrome';
import { AppDropdown, SearchField } from '../../common/ui/FormControls';
import { BackToTopControl } from '../../common/ui/BackToTopControl';
import { EmptyState, InlineStatus, LoadFailure } from '../../common/ui/FeedbackStates';
import { WorkspaceBreakpoint, COLLECTION_MAX_WIDTH } from '../../common/AppConfig';
import { workspaceLatinSerifFamily, workspaceSansFamily } from '../../common/ui/Typography';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';
import { ResultChangeGate } from '../../common/ui/WorkspaceMotion';
import { ResultSurfaceController, ResultSurfaceCover } from '../../common/ui/ResultSurface';
import { ContentLoadingState } from '../../common/ui/ContentLoadingState';
import { LoadingHintAnchor, LoadingHintPlacement } from '../../common/ui/LoadingHintAnchor';
import { FavoriteGroup, FavoriteHeading } from './FavoriteModels';
import { FavoritesController } from './FavoritesController';

@Component
export struct FavoritesPage {
  @Prop @Watch('topRequested') topRevision: number = 0;

  private topRequested(): void { if (this.topRevision > 0) this.scrollToTop(); }
  @State private hoveredItem: string = '';
  @State private hoveredAction: string = '';
  @State private toolbarLabels: boolean = false;
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @StorageProp('desktopWindowChrome') private desktopWindowChrome: boolean = false;
  @Prop @Watch('viewModeChanged') viewMode: string = 'list';
  @State private renderedViewMode: string = 'list';
  @State private resultSurface: ResultSurfaceController = new ResultSurfaceController();
  @Prop searchRevision: number = 0;
  @Prop @Watch('refreshRevisionChanged') refreshRevision: number = 0;
  onViewModeChange: (mode: string) => void = () => {};
  onOpenFavorite: (favorite: FavoriteHeading) => void = () => {};
  onScrollStateChange: (scrolled: boolean) => void = () => {};
  onOpenLog: () => void = () => {};
  onLoadingHintChange: (placement: LoadingHintPlacement) => void = () => {};
  @ObjectLink @Watch('applyFilter') data: FavoritesController;
  @State private visible: FavoriteHeading[] = [];
  @StorageProp('pref_favoritesSort') @Watch('applyFilter') private sortMode: string = 'log_date';
  @StorageProp('pref_readingScale') private readingScale: number = 1;
  @State private renderedSortMode: string = 'log_date';
  @State private headingOnly: boolean = false;
  @State private caseSensitive: boolean = false;
  @State private query: string = '';
  @State private groupEditorOpen: boolean = false;
  @State private groupEditorFavoriteId: string = '';
  @State private scrollOffset: number = 0;
  @State private scrollProgress: number = 0;
  @State private viewportHeight: number = 0;
  @State private viewportWidth: number = 0;
  @State private headerWidth: number = 0;
  private pageScroller: Scroller = new Scroller();
  private resultChanges: ResultChangeGate = new ResultChangeGate();
  private topToolsHeight: number = 0;

  private isLargeWorkspace(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  private gridItemWidth(): string {
    if (this.viewportWidth >= 1050) return '32.5%';
    return '48.7%';
  }

  aboutToAppear(): void { this.renderedViewMode = this.viewMode; this.load(); }

  private viewModeChanged(): void { this.applyFilter(); }

  private refreshRevisionChanged(): void {
    if (this.refreshRevision > 0) this.load();
  }


  private async load(): Promise<void> { await this.data.load(); }

  private applyFilter(): void {
    const visible = this.data.filtered({ query: this.query, headingOnly: this.headingOnly,
      caseSensitive: this.caseSensitive, sortMode: this.sortMode });
    if (this.data.loading) {
      this.resultSurface.clear();
      this.visible = visible;
      this.renderedSortMode = this.sortMode;
      this.renderedViewMode = this.viewMode;
      this.resultChanges.reset(this.resultKey());
    }
    else this.revealResultChange(visible);
    if (visible.map((item: FavoriteHeading) => item.id).join('|') ===
      this.visible.map((item: FavoriteHeading) => item.id).join('|')) this.visible = visible;
  }

  private resultKey(): string {
    return `${this.viewMode}:${this.sortMode}:${this.visible.map((item: FavoriteHeading) => item.id).join('|')}`;
  }

  private revealResultChange(visible: FavoriteHeading[] = this.visible): void {
    const mode = this.viewMode;
    const sort = this.sortMode;
    const key = `${mode}:${sort}:${visible.map((item: FavoriteHeading) => item.id).join('|')}`;
    this.resultChanges.update(key, (isCurrent: () => boolean) => {
      this.resultSurface.replace(this.getUIContext(), 'favorites_result_surface', () => {
        this.visible = visible;
        this.renderedViewMode = mode;
        this.renderedSortMode = sort;
        this.pageScroller.scrollTo({ xOffset: 0, yOffset: 0 });
        this.scrollOffset = 0;
        this.scrollProgress = 0;
        this.onScrollStateChange(false);
      }, isCurrent);
    });
  }

  aboutToDisappear(): void {
    this.data.dispose();
    this.resultChanges.reset('');
    this.resultSurface.clear();
  }

  private async remove(id: string): Promise<void> { await this.data.remove(id); }

  private groupEditorFavorite(): FavoriteHeading | null {
    return this.data.favorites.find((item: FavoriteHeading) => item.id === this.groupEditorFavoriteId) || null;
  }

  private openGroupEditor(item: FavoriteHeading): void {
    this.groupEditorFavoriteId = item.id;
    this.groupEditorOpen = true;
  }

  private groupSelected(groupId: string): boolean {
    const favorite = this.groupEditorFavorite();
    return favorite ? favorite.groupIds.includes(groupId) : false;
  }

  private async updateFavoriteGroup(groupId: string, selected: boolean): Promise<void> {
    await this.data.updateGroup(this.groupEditorFavoriteId, groupId, selected);
  }

  private groupCount(id: string): number { return this.data.groupCount(id); }

  private resultCountText(): string {
    return `${this.visible.length} 条收藏`;
  }

  private emptyGroup(): boolean {
    return this.data.selectedGroup !== 'all' && this.groupCount(this.data.selectedGroup) === 0;
  }

  private showAllFavorites(): void {
    this.query = '';
    this.data.resetFilters();
    this.applyFilter();
  }

  @Builder
  private favoriteActions(item: FavoriteHeading) {
    Row({ space: 6 }) {
      Button('分组', { type: ButtonType.Normal })
        .id(`favorite_assign_${item.id}`)
        .width(52).height(26).padding(0).fontSize(12).fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.muted')).backgroundColor($r('app.color.surface_soft'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(6).clip(true)
        .attributeModifier(new InteractiveSurface($r('app.color.surface_soft'), this.hoveredAction === `assign-${item.id}`))
        .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredAction = hover ? `assign-${item.id}` : ''))
        .monopolizeEvents(true).onClick(() => this.openGroupEditor(item))
      Button({ type: ButtonType.Normal }) {
        Image($r('app.media.x')).width(13).height(13).colorFilter(iconTint($r('app.color.muted_soft')))
      }
      .width(26).height(26).padding(0).borderRadius(6).clip(true)
      .backgroundColor(Color.Transparent)
      .monopolizeEvents(true)
      .attributeModifier(new InteractiveSurface(Color.Transparent, this.hoveredAction === `remove-${item.id}`))
      .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredAction = hover ? `remove-${item.id}` : ''))
      .onClick(() => this.remove(item.id))
      .accessibilityText('取消收藏').bindTips('取消收藏', WORKSPACE_TIPS)
    }
  }

  @Builder
  private favoriteGroups(item: FavoriteHeading) {
    Flex({ wrap: FlexWrap.Wrap }) {
      if (item.groupIds.length > 0) {
        ForEach(item.groupIds, (groupId: string) => {
          Text(this.groupName(groupId)).fontSize(11).fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .padding({ left: 8, right: 8, top: 3, bottom: 3 })
            .margin({ right: 6 })
            .backgroundColor($r('app.color.primary_tint')).borderRadius(10)
        }, (groupId: string) => groupId)
      } else {
        Text('未分组').fontSize(11).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted'))
          .padding({ left: 8, right: 8, top: 3, bottom: 3 })
          .margin({ right: 6 })
          .backgroundColor($r('app.color.surface_soft')).borderRadius(10)
      }
    }
  }

  @Builder
  private favoriteItem(item: FavoriteHeading) {
    Column({ space: 8 }) {
      if (this.isLargeWorkspace() && this.renderedViewMode === 'list') {
        Row({ space: 12 }) {
          Column({ space: 3 }) {
            Text(item.date).fontSize(12).fontColor($r('app.color.muted'))
            if (this.renderedSortMode === 'saved_date') {
              Text(`收藏于 ${this.savedTime(item.createdAt)}`).fontSize(11)
                .fontColor($r('app.color.muted_soft'))
            }
          }.width(86).alignItems(HorizontalAlign.Start)
          Column({ space: 3 }) {
            Text(item.headingText).fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(14 * this.readingScale)
              .id(`favorite_title_${item.id}`)
              .copyOption(CopyOptions.LocalDevice)
              .onClick(() => this.onOpenFavorite(item))
              .fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
            Text(item.sectionPreview || '原小节当前无法读取')
              .copyOption(CopyOptions.LocalDevice)
              .onClick(() => this.onOpenFavorite(item))
              .fontSize(12 * this.readingScale).lineHeight(18 * this.readingScale).fontColor($r('app.color.muted'))
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          if (item.groupIds.length > 0) {
            Text(item.groupIds.map((id: string) => this.groupName(id)).join(' · '))
              .fontSize(11).fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              .constraintSize({ maxWidth: 160 }).padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .backgroundColor($r('app.color.primary_tint')).borderRadius(10)
              .bindTips(item.groupIds.map((id: string) => this.groupName(id)).join('、'), WORKSPACE_TIPS)
          }
          this.favoriteActions(item)
        }.width('100%').constraintSize({ minHeight: 46 }).alignItems(VerticalAlign.Center)
      } else {
        Row({ space: 8 }) {
          Column({ space: 3 }) {
            Text(item.headingText).fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(14 * this.readingScale)
              .id(`favorite_title_${item.id}`)
              .copyOption(CopyOptions.LocalDevice)
              .onClick(() => this.onOpenFavorite(item))
              .fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.renderedSortMode === 'saved_date' ?
              `日志 ${item.date} · 收藏于 ${this.savedTime(item.createdAt)}` : item.date)
              .fontSize(12).fontColor($r('app.color.muted'))
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          this.favoriteActions(item)
        }.width('100%').alignItems(VerticalAlign.Top)
        Text(item.sectionPreview || '原小节当前无法读取')
          .copyOption(CopyOptions.LocalDevice)
          .onClick(() => this.onOpenFavorite(item))
          .fontSize(12 * this.readingScale).lineHeight(18 * this.readingScale).fontColor(item.exists ? $r('app.color.body') : $r('app.color.muted'))
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        this.favoriteGroups(item)
      }
    }
    .width('100%').padding(12)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.canvas'))
    .border({ width: 1, color: $r('app.color.hairline') })
    .borderRadius(8)
    .id(`favorite_item_${item.id}`)
    .attributeModifier(new InteractiveSurface($r('app.color.canvas'), this.hoveredItem === item.id))
    .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredItem = hover ? item.id : ''))
    .onClick(() => this.onOpenFavorite(item))
  }

  @Builder
  private groupEditorSheet() {
    Column({ space: 12 }) {
      ActionPanelHeader({
        title: '选择分组',
        showDragBar: !this.desktopWindowChrome && this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT,
        closeLabel: '关闭选择分组',
        onClose: () => this.groupEditorOpen = false
      })
      if (this.data.groups.length === 0) {
        Text('还没有自定义分组，可关闭面板后先新建一个。')
          .width('100%').height(88).textAlign(TextAlign.Center)
          .fontSize(13).fontColor($r('app.color.muted'))
      } else {
        List({ space: 8 }) {
          ForEach(this.data.groups, (group: FavoriteGroup) => {
            ListItem() {
              Row({ space: 12 }) {
                Column({ space: 3 }) {
                  Text(group.name).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
                  Text(`${this.groupCount(group.id)} 条收藏`).fontSize(11).fontColor($r('app.color.muted'))
                }.alignItems(HorizontalAlign.Start).layoutWeight(1)
                Checkbox({ name: group.id, group: 'favorite-groups' })
                  .select(this.groupSelected(group.id))
                  .selectedColor($r('app.color.primary'))
                  .enabled(!this.data.groupUpdating)
                  .onChange((selected: boolean) => this.updateFavoriteGroup(group.id, selected))
              }
              .width('100%').height(54).padding({ left: 12, right: 12 })
              .backgroundColor($r('app.color.surface_soft'))
              .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
            }
          }, (group: FavoriteGroup) => group.id)
        }
        .width('100%')
        .height(Math.min(310, this.data.groups.length * 62))
      }
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 8, bottom: 18 })
    .backgroundColor($r('app.color.canvas'))
  }

  private groupName(id: string): string {
    const group = this.data.groups.find((item: FavoriteGroup) => item.id === id);
    return group ? group.name : '未分组';
  }

  private handlePageScroll(): void {
    this.scrollOffset = Math.max(0, this.pageScroller.currentOffset().yOffset);
    this.onScrollStateChange(this.topToolsHeight > 0 && this.scrollOffset >= this.topToolsHeight - 0.5);
    const contentHeight = this.pageScroller.getItemRect(0).height;
    const scrollableHeight = Math.max(1, contentHeight - this.viewportHeight);
    this.scrollProgress = Math.min(1, Math.max(0, this.scrollOffset / scrollableHeight));
  }

  private scrollToTop(): void {
    this.pageScroller.scrollTo({
      xOffset: 0,
      yOffset: 0,
      animation: { duration: 220, curve: Curve.EaseOut }
    });
  }

  @Builder
  private viewToggle() {
    Stack() {
    SegmentIndicator({ selected: this.viewMode === 'grid' ? 1 : 0, inset: 3 })
    Row() {
      ToolbarAction({
        label: '列表', icon: $r('app.media.layout_list'), iconSize: 16,
        iconWidth: 34, controlHeight: 38,
        segmented: true, showLabel: this.toolbarLabels, active: this.viewMode === 'list',
        onAction: () => this.onViewModeChange('list')
      }).id('favorites_view_list').accessibilityText('列表视图').bindTips('列表视图', WORKSPACE_TIPS)
      ToolbarAction({
        label: '卡片', icon: $r('app.media.grid_2x2'), iconSize: 15,
        iconWidth: 34, controlHeight: 38,
        segmented: true, showLabel: this.toolbarLabels, active: this.viewMode === 'grid',
        onAction: () => this.onViewModeChange('grid')
      }).id('favorites_view_grid').accessibilityText('卡片视图').bindTips('卡片视图', WORKSPACE_TIPS)
    }
    .height(38).padding(2)
    }
    .width(2 * (this.toolbarLabels ? toolbarActionWidth('列表') : 34) + 6).height(38)
    .backgroundColor($r('app.color.surface_soft'))
    .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
  }


  private savedTime(value: string): string {
    const date = new Date(value);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
  }

  private filterText(): string {
    const labels: string[] = [];
    if (this.data.selectedGroup !== 'all') labels.push(this.groupName(this.data.selectedGroup));
    if (this.query.trim()) labels.push(this.query.trim());
    return labels.join(' · ');
  }

  @Builder
  private searchField() {
    SearchField({
      value: this.query,
      placeholder: this.headingOnly ? '搜索收藏小节标题' : '搜索收藏标题或内容',
      focusKey: 'favorites_search', focusRevision: this.searchRevision,
      showHeadingToggle: true, headingOnly: this.headingOnly,
      showCaseToggle: true, caseSensitive: this.caseSensitive,
      onChange: (value: string) => { this.query = value; this.applyFilter(); },
      onSubmit: () => this.applyFilter(),
      onHeadingToggle: () => { this.headingOnly = !this.headingOnly; this.applyFilter(); },
      onCaseToggle: () => { this.caseSensitive = !this.caseSensitive; this.applyFilter(); }
    })
  }

  @Builder
  private sortDropdown(controlWidth: Length = 190) {
    AppDropdown({
      options: ['日志日期：最新优先', '收藏时间：最新优先'],
      selectedIndex: this.sortMode === 'log_date' ? 0 : 1,
      value: this.sortMode === 'log_date' ? '日志日期：最新优先' : '收藏时间：最新优先',
      icon: $r('app.media.arrow_up_down'), accessibilityLabel: '选择收藏排序方式',
      onSelect: (index: number) => {
        workspacePreferences.set('favoritesSort', index === 0 ? 'log_date' : 'saved_date')
          .catch(() => appFeedback.show('收藏排序方式保存失败', 'error'));
      }
    }).id('favorites_sort').width(controlWidth).height(38)
  }

  @Builder
  private pageBody() {
    Stack({ alignContent: Alignment.BottomEnd }) {
    Row() {
    Scroll(this.pageScroller) {
      Column() {
        Column() {
          if (!this.isLargeWorkspace()) {
            Column({ space: 8 }) {
              this.searchField()
              Row({ space: 8 }) {
                Row() {
                  this.sortDropdown('100%')
                }.layoutWeight(1)
                this.viewToggle()
              }.width('100%')
            }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 8 })
          }
          Row({ space: 8 }) {
            Text(this.resultCountText()).id('favorites_result_count').fontSize(12).fontColor($r('app.color.muted'))
              .visibility(this.visible.length > 0 ? Visibility.Visible : Visibility.Hidden)
            Text(this.filterText()).id('favorites_filter_summary').layoutWeight(1).fontSize(12).fontColor($r('app.color.muted'))
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          }.width('100%').height(40).padding({ left: 16, right: 16 })
        }.width('100%')
          .onAreaChange((_oldValue, newValue) => {
            this.topToolsHeight = Number(newValue.height);
            this.onScrollStateChange(this.scrollOffset >= this.topToolsHeight - 0.5);
          })

        InlineStatus({ text: this.data.loadFailed && this.visible.length === 0 ? '' : this.data.errorMessage, error: true,
          retry: this.data.loadFailed && !this.data.loading, onRetry: () => this.load() })
        if (this.data.loading && this.data.favorites.length === 0) {
          ContentLoadingState({ text: '正在加载收藏…' })
            .height(Math.max(180, this.viewportHeight - this.topToolsHeight))
        } else if (this.data.loadFailed && this.visible.length === 0) {
          Column() {
            LoadFailure({ title: '收藏读取失败', message: this.data.errorMessage, onRetry: () => this.load() })
          }.width('100%').height(360)
        } else if (this.visible.length === 0) {
          Column({ space: 12 }) {
            EmptyState({ embedded: true,
              symbol: $r('sys.symbol.star'),
              title: this.emptyGroup() ? '此分组暂无收藏' : this.data.favorites.length > 0 ? '没有符合条件的收藏' : '暂无收藏',
              description: this.emptyGroup() ? '可在全部收藏中，通过“分组”将已有收藏加入这里' :
                this.data.favorites.length > 0 ? '换一个关键词或筛选条件再试试' : '在日志大纲中收藏重要小节'
            })
            if (this.emptyGroup()) {
              Button('查看全部收藏', { type: ButtonType.Normal }).height(36).padding({ left: 20, right: 20 })
                .fontSize(14).backgroundColor($r('app.color.surface_soft')).fontColor($r('app.color.body'))
                .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
                .onClick(() => this.showAllFavorites())
            }
          }.width('100%').height(360).padding(32).justifyContent(FlexAlign.Center)
        } else if (this.renderedViewMode === 'grid') {
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
            ForEach(this.visible, (item: FavoriteHeading) => {
              Column() {
                this.favoriteItem(item)
              }.width(this.gridItemWidth()).margin({ bottom: 8 })
            }, (item: FavoriteHeading) => item.id)
          }.width('100%').padding({ left: 12, right: 12, top: 12, bottom: 32 })
        } else {
          Column({ space: 8 }) {
          ForEach(this.visible, (item: FavoriteHeading, index: number) => {
            Column({ space: 8 }) {
              if (this.renderedSortMode === 'log_date' &&
                (index === 0 || this.visible[index - 1].date.slice(0, 7) !== item.date.slice(0, 7))) {
                Row() {
                  Text(item.date.slice(0, 7)).fontFamily(workspaceLatinSerifFamily(this.workspaceBreakpoint))
                    .id(`favorite_section_${item.date.slice(0, 7)}`)
                    .fontSize(24).fontColor($r('app.color.ink'))
                  Blank()
                  Text(this.visible.filter((candidate: FavoriteHeading) => candidate.date.startsWith(item.date.slice(0, 7))).length.toString())
                    .fontSize(11).fontColor($r('app.color.muted'))
                }.width('100%').padding({ top: index === 0 ? 0 : 10 })
              }
              this.favoriteItem(item)
            }
          }, (item: FavoriteHeading) => item.id)
          }.width('100%').padding({ left: 12, right: 12, top: 12, bottom: 32 })
        }
      }.width('100%')
    }.width('100%').constraintSize({ maxWidth: COLLECTION_MAX_WIDTH }).height('100%').align(Alignment.TopStart)
    .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
    .backgroundColor($r('app.color.canvas'))
    .onAreaChange((_oldValue, newValue) => {
      this.viewportHeight = Number(newValue.height);
      this.viewportWidth = Number(newValue.width);
    })
    .onScroll(() => this.handlePageScroll())
    .bindSheet($$this.groupEditorOpen, this.groupEditorSheet(), {
      preferType: !this.desktopWindowChrome && this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? SheetType.BOTTOM : SheetType.CENTER,
      height: SheetSize.FIT_CONTENT,
      dragBar: false,
      showClose: false,
      maskColor: $r('app.color.scrim'),
      radius: LengthMetrics.vp(12)
    })
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
    ResultSurfaceCover({ controller: this.resultSurface })
    Row() {
      if (this.data.loading && this.data.favorites.length > 0) {
        LoadingHintAnchor({ loading: true, onChange: this.onLoadingHintChange })
      }
    }.width('100%').height('100%').justifyContent(FlexAlign.Center).hitTestBehavior(HitTestMode.None)
    BackToTopControl({
      visible: this.scrollOffset > 8 && !this.groupEditorOpen,
      progress: this.scrollProgress,
      scrollOffset: this.scrollOffset,
      onBackToTop: () => this.scrollToTop()
    })
      .margin({ right: this.isLargeWorkspace() ? 24 : 14, bottom: this.isLargeWorkspace() ? 24 : 14 })
      .zIndex(1)
    }.width('100%').height('100%').id('favorites_result_surface')
  }

  build() {
    Column() {
      if (this.isLargeWorkspace()) {
        Row({ space: 12 }) {
          ModulePageTitle({ title: '收藏中心' }).layoutWeight(1)
          Row() { this.searchField() }.width(this.headerWidth >= 1100 ? 320 : 250)
          this.sortDropdown()
          this.viewToggle()
          ModuleLogButton({ onOpenLog: this.onOpenLog })
        }.id('desktop_page_favorites').width('100%').height(64).padding({ left: MODULE_HEADER_LEFT_INSET, right: 16 })
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
          .onAreaChange((_oldArea, area) => {
            this.headerWidth = Number(area.width);
            this.toolbarLabels = this.headerWidth >= 1000;
          })
      }
      Row() {
        this.pageBody()
      }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
    }.width('100%').height('100%')
  }
}
