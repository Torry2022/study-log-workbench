import { NavigationRowStyle, NavigationLabelStyle, NavigationCountStyle } from '../../../common/ui/NavigationRowStyle';
import { InteractiveSurface, animateHover } from '../../../common/ui/InteractiveSurface';
import { appFeedback, FeedbackTone } from '../../../common/ui/AppFeedback';
import { InlineStatus } from '../../../common/ui/FeedbackStates';
import { WORKSPACE_TIPS } from '../../../common/ui/WorkspaceTips';
import { iconTint } from '../../../common/ui/IconTint';
import { expandSection } from '../../../common/ui/WorkspaceMotion';
import { FavoriteGroup, FavoriteHeading } from '../FavoriteModels';
import { FavoritesController } from '../FavoritesController';

@Component
export struct FavoritesNavigation {
  @State private hoveredGroup: string = '';
  @ObjectLink data: FavoritesController;
  private viewRevision: number = 0;
  aboutToDisappear(): void { this.viewRevision += 1; }
  @Prop wide: boolean = false;
  onRetry: () => void = () => {};
  @State private monthsExpanded: boolean = false;
  @State private creatingGroup: boolean = false;
  @State private groupDraftName: string = '';
  @State private groupMenuId: string = '';
  @State private groupRenameId: string = '';
  @State private groupRenameName: string = '';

  private async createGroup(): Promise<void> {
    const revision = this.viewRevision;
    const name = this.groupDraftName;
    if (await this.data.createGroup(name) && revision === this.viewRevision && name === this.groupDraftName) {
      this.groupDraftName = '';
      this.creatingGroup = false;
    }
  }

  private openGroupMenu(group: FavoriteGroup): void {
    if (this.groupMenuId === group.id) {
      this.groupMenuId = '';
      this.groupRenameId = '';
      return;
    }
    this.groupMenuId = group.id;
    this.groupRenameId = '';
    this.groupRenameName = this.currentGroup(group.id)?.name || group.name;
  }

  private startGroupRename(group: FavoriteGroup): void {
    this.groupRenameId = group.id;
    this.groupRenameName = this.currentGroup(group.id)?.name || group.name;
  }

  private currentGroup(id: string): FavoriteGroup | undefined {
    return this.data.groups.find((item: FavoriteGroup) => item.id === id);
  }

  private async renameGroup(group: FavoriteGroup): Promise<void> {
    const revision = this.viewRevision;
    if (await this.data.renameGroup(group.id, this.groupRenameName) && revision === this.viewRevision) {
      if (this.groupMenuId === group.id) { this.groupMenuId = ''; this.groupRenameId = ''; }
      this.showToast('已重命名收藏分组');
    }
  }

  private confirmDeleteGroup(group: FavoriteGroup): void {
    if (this.data.groupActionBusy) return;
    const current = this.currentGroup(group.id);
    if (!current) return;
    const revision = this.viewRevision;
    const generation = this.data.generation();
    AlertDialog.show({
      message: `删除分组“${current.name}”吗？收藏内容不会被删除。`,
      primaryButton: { value: '保留', action: () => {} },
      secondaryButton: {
        value: '删除',
        fontColor: $r('app.color.error'),
        action: () => {
          if (revision === this.viewRevision && generation === this.data.generation()) this.deleteGroup(group);
        }
      }
    });
  }

  private async deleteGroup(group: FavoriteGroup): Promise<void> {
    const revision = this.viewRevision;
    if (await this.data.deleteGroup(group.id) && revision === this.viewRevision) {
      if (this.groupMenuId === group.id) { this.groupMenuId = ''; this.groupRenameId = ''; }
      this.showToast('已删除收藏分组');
    }
  }

  private showToast(message: string, tone: FeedbackTone = 'success'): void {
    appFeedback.show(message, tone);
  }

  private groupCount(id: string): number { return this.data.groupCount(id); }

  private selectGroup(id: string): void { this.data.selectGroup(id); }

  private groupFavorites(id: string = this.data.selectedGroup): FavoriteHeading[] { return this.data.groupFavorites(id); }

  private months(): string[] { return this.data.months(); }

  private visibleMonths(): string[] {
    const months = this.months();
    if (this.monthsExpanded) return months;
    return months.filter((month: string, index: number) => index < 6 || month === this.data.selectedMonth);
  }

  @Builder
  private groupMenu(group: FavoriteGroup) {
    Column({ space: 8 }) {
      if (this.groupRenameId === group.id) {
        Text('重命名分组').width('100%').fontSize(12).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.muted'))
        TextInput({ text: this.groupRenameName, placeholder: '新的分组名称' })
          .id('favorite_group_rename_name')
          .width('100%').height(38).fontSize(13).backgroundColor($r('app.color.surface_soft'))
          .monopolizeEvents(true)
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
          .onChange((value: string) => this.groupRenameName = value)
          .onSubmit(() => this.renameGroup(group))
        Row({ space: 8 }) {
          Button('取消', { type: ButtonType.Normal })
            .layoutWeight(1).height(36).fontSize(12)
            .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(7)
            .onClick(() => this.groupRenameId = '')
          Button(this.data.groupActionBusy ? '保存中' : '保存', { type: ButtonType.Normal })
            .id('favorite_group_rename_save')
            .layoutWeight(1).height(36).fontSize(12).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.on_primary')).backgroundColor($r('app.color.primary'))
            .borderRadius(7).enabled(!this.data.groupActionBusy && this.groupRenameName.trim().length > 0)
            .onClick(() => this.renameGroup(group))
        }.width('100%')
      } else {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 7 }) {
            SymbolGlyph($r('sys.symbol.square_and_pencil')).fontSize(15).fontColor([$r('app.color.body')])
            Text('重命名').fontSize(13).fontColor($r('app.color.body'))
          }.width('100%')
        }
        .width('100%').height(38).padding({ left: 10, right: 10 })
        .backgroundColor(Color.Transparent).borderRadius(7)
        .onClick(() => this.startGroupRename(group))
        Button({ type: ButtonType.Normal }) {
          Row({ space: 7 }) {
            Image($r('app.media.trash_2')).width(15).height(15).colorFilter(iconTint($r('app.color.error')))
            Text('删除分组').fontSize(13).fontColor($r('app.color.error'))
          }.width('100%')
        }
        .width('100%').height(38).padding({ left: 10, right: 10 })
        .backgroundColor($r('app.color.error_surface')).borderRadius(7)
        .onClick(() => this.confirmDeleteGroup(group))
      }
    }
    .width('100%').padding(8).alignItems(HorizontalAlign.Start)
  }


  @Builder
  private customGroupRow(group: FavoriteGroup) {
    Row() {
      FavoriteFilterRow({
        wide: this.wide, rowId: `favorite_group_${group.id}`, flat: true, label: group.name, count: this.groupCount(group.id),
        selected: this.data.selectedGroup === group.id, onAction: () => this.selectGroup(group.id)
      }).layoutWeight(1)
      Button({ type: ButtonType.Normal }) {
        Image($r('app.media.more_horizontal')).width(15).height(15)
          .colorFilter(iconTint($r('app.color.muted')))
      }.id(`favorite_group_menu_${group.id}`).width(30).height(38).padding(0)
        .backgroundColor(Color.Transparent).borderRadius(8)
        .accessibilityText(`管理分组 ${group.name}`).bindTips(`管理分组 ${group.name}`, WORKSPACE_TIPS)
        .onClick(() => this.openGroupMenu(group))
        .bindPopup(this.groupMenuId === group.id, {
          builder: () => { this.groupMenu(group) }, placement: Placement.BottomRight,
          popupColor: $r('app.color.canvas'), enableArrow: false, autoCancel: true,
          targetSpace: 4, width: 244, radius: 12, backgroundBlurStyle: BlurStyle.NONE,
          shadow: { radius: 12, color: $r('app.color.popover_shadow'), offsetY: 4 },
          onStateChange: (event) => {
            if (!event.isVisible && this.groupMenuId === group.id) {
              this.groupMenuId = '';
              this.groupRenameId = '';
            }
          }
        })
    }.width('100%').borderRadius(8)
      .attributeModifier(new InteractiveSurface(this.data.selectedGroup === group.id ? $r('app.color.surface_card') : Color.Transparent,
        this.hoveredGroup === group.id, this.data.selectedGroup === group.id))
      .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredGroup = hover ? group.id : ''))
  }

  build() {
    Scroll() {
      Column({ space: 4 }) {
        Row() {
          Text('收藏分组').layoutWeight(1).fontSize(12).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.muted'))
          Button({ type: ButtonType.Normal }) {
            Image($r('app.media.rail_plus')).width(15).height(15).colorFilter(iconTint($r('app.color.muted')))
          }.id('favorite_group_new').width(30).height(30).padding(0).borderRadius(8)
            .backgroundColor(Color.Transparent).accessibilityText('新建收藏分组')
            .bindTips('新建收藏分组', WORKSPACE_TIPS).enabled(!this.data.loading && !this.data.loadFailed)
            .onClick(() => this.creatingGroup = !this.creatingGroup)
        }.width('100%').padding({ left: this.wide ? 0 : 10 })
        if (this.data.loading && this.data.favorites.length === 0) {
          LoadingProgress().width(24).height(24).color($r('app.color.primary')).margin(8)
        } else if (this.data.loadFailed) {
          InlineStatus({ text: '收藏读取失败', error: true, retry: true, onRetry: this.onRetry })
        }
        InlineStatus({ text: this.data.groupError, error: true })
        if (this.creatingGroup) {
          Column({ space: 8 }) {
            TextInput({ text: this.groupDraftName, placeholder: '分组名称' })
              .id('favorite_group_name').height(38).fontSize(13)
              .backgroundColor($r('app.color.canvas')).borderRadius(8)
              .border({ width: 1, color: $r('app.color.hairline') })
              .onChange((value: string) => this.groupDraftName = value).onSubmit(() => this.createGroup())
            Row({ space: 8 }) {
              Button('取消', { type: ButtonType.Normal }).layoutWeight(1).height(34).fontSize(12)
                .fontColor($r('app.color.body')).backgroundColor($r('app.color.canvas')).borderRadius(8)
                .onClick(() => this.creatingGroup = false)
              Button(this.data.groupSaving ? '创建中' : '创建', { type: ButtonType.Normal })
                .id('favorite_group_create').layoutWeight(1).height(34).fontSize(12)
                .fontColor($r('app.color.on_primary')).backgroundColor($r('app.color.primary')).borderRadius(8)
                .enabled(!this.data.groupSaving && this.groupDraftName.trim().length > 0)
                .onClick(() => this.createGroup())
            }.width('100%')
          }.width('100%').padding({ left: 10, right: 10, bottom: 8 })
        }
        Row() {
          FavoriteFilterRow({
            wide: this.wide, rowId: 'favorite_group_all', flat: true, label: '全部收藏', count: this.groupCount('all'),
            selected: this.data.selectedGroup === 'all', onAction: () => this.selectGroup('all')
          }).layoutWeight(1)
          Blank().width(30)
        }.width('100%').borderRadius(8)
          .attributeModifier(new InteractiveSurface(this.data.selectedGroup === 'all' ? $r('app.color.surface_card') : Color.Transparent,
            this.hoveredGroup === 'all', this.data.selectedGroup === 'all'))
          .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredGroup = hover ? 'all' : ''))
          .onClick(() => this.selectGroup('all'))
        Row() {
          FavoriteFilterRow({
            wide: this.wide, rowId: 'favorite_group_ungrouped', flat: true, label: '未分组', count: this.groupCount('ungrouped'),
            selected: this.data.selectedGroup === 'ungrouped', onAction: () => this.selectGroup('ungrouped')
          }).layoutWeight(1)
          Blank().width(30)
        }.width('100%').borderRadius(8)
          .attributeModifier(new InteractiveSurface(this.data.selectedGroup === 'ungrouped' ? $r('app.color.surface_card') : Color.Transparent,
            this.hoveredGroup === 'ungrouped', this.data.selectedGroup === 'ungrouped'))
          .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredGroup = hover ? 'ungrouped' : ''))
          .onClick(() => this.selectGroup('ungrouped'))
        ForEach(this.data.groups, (group: FavoriteGroup) => { this.customGroupRow(group) },
          (group: FavoriteGroup) => `${group.id}:${group.name}`)
        if (this.wide) {
          Row() {
            Text('日志月份').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted'))
          }.width('100%').height(30).margin({ top: 16 })
        } else {
          Text('日志月份').width('100%').fontSize(12).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.muted')).padding({ left: 10, top: 20, bottom: 8 })
        }
        FavoriteFilterRow({
          wide: this.wide, rowId: 'favorite_month_all', label: '全部月份', count: this.groupFavorites().length,
          selected: this.data.selectedMonth === 'all', onAction: () => this.data.selectMonth('all')
        })
        ForEach(this.visibleMonths(), (month: string) => {
          FavoriteFilterRow({
            wide: this.wide, rowId: `favorite_month_${month}`, label: month,
            count: this.groupFavorites().filter((item: FavoriteHeading) => item.month === month).length,
            selected: this.data.selectedMonth === month, onAction: () => this.data.selectMonth(month)
          })
        }, (month: string) => month)
        if (this.months().length > this.visibleMonths().length || this.monthsExpanded) {
          Text(this.monthsExpanded ? '收起月份' : `展开其余 ${this.months().length - this.visibleMonths().length} 个月份`)
            .width('100%').height(30).padding({ left: 10 }).fontSize(12).fontColor($r('app.color.muted'))
            .onClick(() => expandSection(this.getUIContext(), () => this.monthsExpanded = !this.monthsExpanded))
        }
      }.width('100%').padding({ left: this.wide ? 14 : 12, right: this.wide ? 14 : 12, top: this.wide ? 14 : 12, bottom: 24 })
        .alignItems(HorizontalAlign.Start)
    }.id('favorites_navigation').width('100%').layoutWeight(1).align(Alignment.TopStart)
      .scrollBar(BarState.Auto).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
  }
}


@Component
struct FavoriteFilterRow {
  @State private hovered: boolean = false;
  @Prop rowId: string = '';
  @Prop flat: boolean = false;
  @Prop wide: boolean = false;
  @Prop label: string = '';
  @Prop count: number = 0;
  @Prop selected: boolean = false;
  onAction: () => void = () => {};

  build() {
    Row({ space: 8 }) {
      Text(this.label).layoutWeight(1).fontSize(14).fontColor($r('app.color.ink'))
        .fontWeight(this.selected ? FontWeight.Medium : FontWeight.Regular)
        .attributeModifier(new NavigationLabelStyle(this.selected, this.wide))
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(this.count.toString()).id(`${this.rowId}_count`).width(32).textAlign(TextAlign.End).fontSize(11)
        .fontColor($r('app.color.muted_soft'))
        .attributeModifier(new NavigationCountStyle(this.wide))
    }.id(this.rowId).height(38).width('100%').padding({ left: 10, right: 10 })
      .backgroundColor(this.selected ? $r('app.color.surface_card') : Color.Transparent).borderRadius(8)
      .attributeModifier(new InteractiveSurface(!this.flat && this.selected ? $r('app.color.surface_card') : Color.Transparent, !this.flat && this.hovered, this.selected))
      .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hovered = hover))
      .attributeModifier(new NavigationRowStyle(this.wide))
      .accessibilityText(this.label).accessibilitySelected(this.selected).onClick(() => this.onAction())
  }
}
