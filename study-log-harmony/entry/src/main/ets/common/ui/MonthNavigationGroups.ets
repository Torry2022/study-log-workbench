import { InteractiveSurface, animateHover } from './InteractiveSurface';
import { NavigationRowStyle, NavigationLabelStyle, NavigationCountStyle } from './NavigationRowStyle';

export interface NavigationMonthOption {
  id: string;
  label: string;
  count: number;
}

@Component
export struct MonthNavigationGroups {
  @Prop months: NavigationMonthOption[] = [];
  @Prop selectedMonth: string = '';
  @Prop wide: boolean = false;
  @Prop rowPrefix: string = 'navigation_month';
  @State private hoveredMonth: string = '';
  onMonth: (month: string) => void = () => {};

  private years(): string[] {
    return Array.from(new Set(this.months.map((month: NavigationMonthOption) => month.id.slice(0, 4))))
      .sort((a: string, b: string) => b.localeCompare(a));
  }

  private monthsForYear(year: string): NavigationMonthOption[] {
    return this.months.filter((month: NavigationMonthOption) => month.id.startsWith(`${year}-`))
      .sort((a: NavigationMonthOption, b: NavigationMonthOption) => b.id.localeCompare(a.id));
  }

  private gridHeight(year: string): number {
    const rows = Math.ceil(this.monthsForYear(year).length / (this.wide ? 1 : 2));
    return rows * (this.wide ? 38 : 44) + Math.max(0, rows - 1) * 6;
  }

  build() {
    Column({ space: 14 }) {
      ForEach(this.years(), (year: string) => {
        Column({ space: 6 }) {
          Row({ space: 8 }) {
            Text(year).fontFamily('HarmonyOS Sans SC').fontSize(12).fontWeight(FontWeight.Regular)
              .fontColor($r('app.color.muted_soft'))
            Divider().layoutWeight(1).color($r('app.color.hairline_soft'))
          }.width('100%').height(20).padding({ left: 10, right: 10 })
            .id(`${this.rowPrefix}_year_${year}`)
          Grid() {
            ForEach(this.monthsForYear(year), (month: NavigationMonthOption) => {
              GridItem() {
                Button({ type: ButtonType.Normal }) {
                  Row() {
                    Text(month.label).layoutWeight(1)
                      .attributeModifier(new NavigationLabelStyle(this.selectedMonth === month.id))
                    Text(month.count.toString()).attributeModifier(new NavigationCountStyle())
                  }.width('100%')
                }
                .width('100%').padding(0)
                .attributeModifier(new NavigationRowStyle(this.wide))
                .attributeModifier(new InteractiveSurface(this.selectedMonth === month.id ?
                  $r('app.color.surface_card') : Color.Transparent, this.hoveredMonth === month.id,
                  this.selectedMonth === month.id))
                .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredMonth = hover ? month.id : ''))
                .onClick(() => this.onMonth(month.id))
                .id(`${this.rowPrefix}_${month.id}`).accessibilitySelected(this.selectedMonth === month.id)
              }
            }, (month: NavigationMonthOption) => month.id)
          }.columnsTemplate(this.wide ? '1fr' : '1fr 1fr').columnsGap(8).rowsGap(6)
            .width('100%').height(this.gridHeight(year)).enableScrollInteraction(false)
        }.width('100%')
      }, (year: string) => year)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
