import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { StudyNoteFacet } from '../NoteModels';
import { WORKSPACE_TIPS } from '../../../common/ui/WorkspaceTips';
import { InteractiveSurface, animateHover } from '../../../common/ui/InteractiveSurface';
import { NavigationRowStyle, NavigationLabelStyle, NavigationCountStyle } from '../../../common/ui/NavigationRowStyle';

@Component
export struct NotesNavigation {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop filtersOnly: boolean = false;
  @Prop noteEditorBusy: boolean = false;
  @Prop noteYearFilter: string = 'all';
  @Prop noteTagFilter: string = 'all';
  @Prop noteCount: number = 0;
  @Prop noteYears: StudyNoteFacet[] = [];
  @Prop noteTags: StudyNoteFacet[] = [];
  @State private hoveredNavigation: string = '';
  onNew: () => void = () => {};
  onYear: (year: string) => void = () => {};
  onTag: (tag: string) => void = () => {};

  private isLargeWorkspace(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  build() {
    List({ space: 12 }) {
      if (!this.filtersOnly) {
      ListItem() {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 7 }) {
            SymbolGlyph($r('sys.symbol.plus')).fontSize(15).fontColor([$r('app.color.ink')])
            Text('新建随记').fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          }.justifyContent(FlexAlign.Center)
        }
        .width('100%').height(40).padding(0).backgroundColor($r('app.color.canvas'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
        .onClick(() => this.onNew())
        .id('notes_sidebar_new')
        .enabled(!this.noteEditorBusy)
        .bindTips(this.noteEditorBusy ? '正在提取或保存，请稍候' : undefined, WORKSPACE_TIPS)
      }
      }
      ListItem() {
        Row() {
          Row({ space: 7 }) {
            SymbolGlyph($r('sys.symbol.calendar')).fontSize(15).fontColor([$r('app.color.primary_active')])
            Text('年份').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted'))
          }.layoutWeight(1)
        }.width('100%').height(30).alignItems(VerticalAlign.Center)
      }
      ListItem() {
        Column({ space: this.isLargeWorkspace() ? 4 : 3 }) {
          Button({ type: ButtonType.Normal }) {
            Row() {
              Text('全部').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.body')).layoutWeight(1)
                .attributeModifier(new NavigationLabelStyle(this.noteYearFilter === 'all', this.isLargeWorkspace()))
              Text(this.noteCount.toString()).fontSize(11).fontColor($r('app.color.muted_soft'))
                .attributeModifier(new NavigationCountStyle(this.isLargeWorkspace()))
            }.width('100%')
          }
          .width('100%').height(36).padding({ left: 10, right: 10 })
          .attributeModifier(new InteractiveSurface(this.noteYearFilter === 'all' ? $r('app.color.surface_card') : Color.Transparent, this.hoveredNavigation === 'note-year-all', this.noteYearFilter === 'all'))
          .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredNavigation = hover ? 'note-year-all' : ''))
          .borderRadius(8).clip(true)
          .onClick(() => this.onYear('all'))
          .attributeModifier(new NavigationRowStyle(this.isLargeWorkspace()))
          ForEach(this.noteYears, (year: StudyNoteFacet) => {
            Button({ type: ButtonType.Normal }) {
              Row() {
                Text(year.value).fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.body')).layoutWeight(1)
                  .attributeModifier(new NavigationLabelStyle(this.noteYearFilter === year.value, this.isLargeWorkspace()))
                Text(year.count.toString()).fontSize(11).fontColor($r('app.color.muted_soft'))
                  .attributeModifier(new NavigationCountStyle(this.isLargeWorkspace()))
              }.width('100%')
            }
            .width('100%').height(36).padding({ left: 10, right: 10 })
            .attributeModifier(new InteractiveSurface(this.noteYearFilter === year.value ? $r('app.color.surface_card') : Color.Transparent, this.hoveredNavigation === `note-year-${year.value}`, this.noteYearFilter === year.value))
            .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredNavigation = hover ? `note-year-${year.value}` : ''))
            .borderRadius(8).clip(true)
            .onClick(() => this.onYear(year.value))
            .attributeModifier(new NavigationRowStyle(this.isLargeWorkspace()))
          }, (year: StudyNoteFacet) => year.value)
        }.width('100%')
      }
      ListItem() {
        Row({ space: 7 }) {
          Image($r('app.media.sidebar_tag')).width(15).height(15).objectFit(ImageFit.Contain)
          Text('标签').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted'))
        }.width('100%')
      }
      ListItem() {
        Flex({ wrap: FlexWrap.Wrap }) {
          Button({ type: ButtonType.Normal }) {
            Text('全部标签').fontSize(12).fontColor($r('app.color.body'))
          }
          .height(28).padding({ left: 9, right: 9 }).margin({ right: 7, bottom: 7 })
          .attributeModifier(new InteractiveSurface(this.noteTagFilter === 'all' ? $r('app.color.primary_tint') : $r('app.color.surface_card'), this.hoveredNavigation === 'note-tag-all', this.noteTagFilter === 'all'))
          .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredNavigation = hover ? 'note-tag-all' : ''))
          .border({ width: 1, color: this.noteTagFilter === 'all' ? $r('app.color.primary') : Color.Transparent })
          .borderRadius(14).clip(true)
          .onClick(() => this.onTag('all'))
          ForEach(this.noteTags, (tag: StudyNoteFacet) => {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 6 }) {
                Text(tag.value).fontSize(12).fontColor($r('app.color.body'))
                Text(tag.count.toString()).fontSize(11).fontColor($r('app.color.muted'))
              }
            }
            .height(28).padding({ left: 9, right: 9 }).margin({ right: 7, bottom: 7 })
            .attributeModifier(new InteractiveSurface(this.noteTagFilter === tag.value ? $r('app.color.primary_tint') : $r('app.color.surface_card'), this.hoveredNavigation === `note-tag-${tag.value}`, this.noteTagFilter === tag.value))
            .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredNavigation = hover ? `note-tag-${tag.value}` : ''))
            .border({ width: 1, color: this.noteTagFilter === tag.value ? $r('app.color.primary') : Color.Transparent })
            .borderRadius(14).clip(true)
            .onClick(() => this.onTag(tag.value))
          }, (tag: StudyNoteFacet) => tag.value)
        }
        .width('100%')
      }
    }
    .layoutWeight(1).width('100%').padding({ left: 14, right: 14, top: 14, bottom: 28 })
    .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
  }
}
