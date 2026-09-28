import { FavoritesController } from '../../favorites/FavoritesController';
import { FavoriteGroup, FavoriteHeading } from '../../favorites/FavoriteModels';
import { AppModalScrim } from '../../../common/ui/AppModalScrim';
import { WORKSPACE_TIPS } from '../../../common/ui/WorkspaceTips';

@Component
export struct LogFavoriteGroupPanel {
  @ObjectLink data: FavoritesController;
  @Prop favoriteId: string = '';
  @Prop wide: boolean = false;
  @State private draftName: string = '';
  onClose: () => void = () => {};
  onOpenFavorites: () => void = () => {};
  onRemove: (favorite: FavoriteHeading) => void = () => {};

  private favorite(): FavoriteHeading | undefined {
    return this.data.favorites.find((item: FavoriteHeading) => item.id === this.favoriteId);
  }

  private async createAndJoinGroup(): Promise<void> {
    const favorite = this.favorite();
    if (!favorite || !this.draftName.trim()) return;
    const previousGroup = this.data.selectedGroup;
    const groupId = await this.data.createGroup(this.draftName);
    this.data.selectGroup(previousGroup);
    if (!groupId || !this.favorite() || this.favoriteId !== favorite.id) return;
    this.draftName = '';
    await this.data.updateGroup(favorite.id, groupId, true);
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      AppModalScrim()
      Column({ space: 16 }) {
        Row({ space: 12 }) {
          Text('选择分组').fontSize(28).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
            .layoutWeight(1)
          Button({ type: ButtonType.Normal }) {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([$r('app.color.muted')])
          }
          .width(34).height(34).padding(0).backgroundColor($r('app.color.surface_soft'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
          .accessibilityText('关闭选择分组').bindTips('关闭选择分组', WORKSPACE_TIPS).onClick(() => this.onClose())
        }.width('100%').alignItems(VerticalAlign.Top)

        if (this.data.groups.length > 0) {
          List({ space: 8 }) {
            ForEach(this.data.groups, (group: FavoriteGroup) => {
              ListItem() {
                Row({ space: 12 }) {
                  Column({ space: 3 }) {
                    Text(group.name).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
                    Text(`${this.data.groupCount(group.id)} 条收藏`)
                      .fontSize(11).fontColor($r('app.color.muted'))
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                  Checkbox({ name: group.id, group: 'outline-favorite-groups' })
                    .select(this.favorite()?.groupIds.includes(group.id) || false)
                    .selectedColor($r('app.color.primary'))
                    .enabled(!this.data.groupUpdating)
                    .onChange((selected: boolean) => this.data.updateGroup(this.favoriteId, group.id, selected))
                }
                .width('100%').height(54).padding({ left: 12, right: 12 })
                .backgroundColor($r('app.color.surface_soft'))
                .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
              }
            }, (group: FavoriteGroup) => group.id)
          }
          .width('100%').height(Math.min(248, this.data.groups.length * 62))
          .scrollBar(BarState.Auto).edgeEffect(EdgeEffect.None)
        } else {
          Text('还没有自定义分组，可先创建一个。').width('100%').height(64)
            .textAlign(TextAlign.Center).fontSize(12).fontColor($r('app.color.muted'))
        }

        Row({ space: 10 }) {
          TextInput({ text: this.draftName, placeholder: '新建分组名称' })
            .layoutWeight(1).height(40).padding({ left: 12, right: 12 })
            .fontSize(13).fontColor($r('app.color.body')).placeholderColor($r('app.color.muted_soft'))
            .backgroundColor($r('app.color.surface_soft'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
            .onChange((value: string) => this.draftName = value)
            .onSubmit(() => this.createAndJoinGroup())
          Button('创建并加入', { type: ButtonType.Normal }).height(40).padding({ left: 12, right: 12 })
            .fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.body'))
            .backgroundColor($r('app.color.canvas'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
            .enabled(!!this.draftName.trim() && !this.data.groupSaving)
            .onClick(() => this.createAndJoinGroup())
        }.width('100%')

        Row({ space: 8 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 6 }) {
              SymbolGlyph($r('sys.symbol.star')).fontSize(14).fontColor([$r('app.color.ink')])
              Text('收藏中心').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
            }
          }
          .height(38).padding({ left: 12, right: 12 }).backgroundColor($r('app.color.canvas'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
          .onClick(() => this.onOpenFavorites())
          Blank().layoutWeight(1)
          Button('取消收藏', { type: ButtonType.Normal }).height(38).padding({ left: 12, right: 12 })
            .fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.error'))
            .backgroundColor($r('app.color.canvas'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
            .enabled(!this.data.groupUpdating && !this.data.groupSaving)
            .onClick(() => {
              const favorite = this.favorite();
              if (favorite) this.onRemove(favorite);
            })
          Button('完成', { type: ButtonType.Normal }).height(38).padding({ left: 14, right: 14 })
            .fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.on_primary'))
            .backgroundColor($r('app.color.primary')).borderRadius(8).clip(true)
            .enabled(!this.data.groupUpdating && !this.data.groupSaving)
            .onClick(() => this.onClose())
        }.width('100%').alignItems(VerticalAlign.Center)
      }
      .width(this.wide ? 560 : '90%')
      .id('log_favorite_group_panel')
      .constraintSize({ maxWidth: 560, maxHeight: '86%' })
      .padding(22).alignItems(HorizontalAlign.Start)
      .backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(12).clip(true)
      .shadow({ radius: 22, color: $r('app.color.popover_shadow'), offsetY: 8 })
    }
    .width('100%').height('100%')
    .backgroundColor(Color.Transparent)
  }

}
