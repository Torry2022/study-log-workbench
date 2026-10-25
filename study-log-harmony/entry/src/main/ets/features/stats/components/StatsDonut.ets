import { DomainCount } from '../StatsModels';
import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { workspaceLatinSerifFamily } from '../../../common/ui/Typography';

interface DomainSegment {
  domain: DomainCount;
  start: number;
  end: number;
  index: number;
}

@Component
export struct StatsDonut {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop domains: DomainCount[] = [];
  @Prop total: number = 0;
  @Prop chartSize: number = 264;
  @State private activeIndex: number = -1;
  onDomain: (domain: string) => void = () => {};

  private segments(): DomainSegment[] {
    let cursor = 0;
    const total = this.domains.reduce((sum: number, domain: DomainCount): number => sum + domain.count, 0);
    return this.domains.map((domain: DomainCount, index: number): DomainSegment => {
      const start = cursor;
      cursor += total > 0 ? domain.count / total : 0;
      return { domain: domain, start: start, end: cursor, index: index };
    });
  }

  private color(index: number): Resource {
    if (index % 3 === 1) return $r('app.color.accent_teal');
    if (index % 3 === 2) return $r('app.color.accent_amber');
    return $r('app.color.primary');
  }

  private arc(start: number, end: number): string {
    const a = (start * 360 - 90) * Math.PI / 180;
    const b = (end * 360 - 90) * Math.PI / 180;
    const x = 60 + 40 * Math.cos(a), y = 60 + 40 * Math.sin(a);
    if (end - start >= 0.999999) return 'M 60 20 A 40 40 0 1 1 60 100 A 40 40 0 1 1 60 20';
    return `M ${x} ${y} A 40 40 0 ${end - start > 0.5 ? 1 : 0} 1 ${60 + 40 * Math.cos(b)} ${60 + 40 * Math.sin(b)}`;
  }

  private segmentAt(x: number, y: number): number {
    const dx = x * 120 / this.chartSize - 60, dy = y * 120 / this.chartSize - 60;
    const radius = Math.sqrt(dx * dx + dy * dy);
    if (radius < 30 || radius > 50) return -1;
    const fraction = ((Math.atan2(dy, dx) / Math.PI * 180 + 450) % 360) / 360;
    return this.segments().findIndex((segment: DomainSegment) => fraction >= segment.start && fraction < segment.end);
  }

  private activeDescription(): string {
    const domain = this.domains[this.activeIndex];
    return domain ? `${domain.domain} · ${domain.count} 个 · ${domain.percentage.toFixed(1)}% · ${domain.activeDays} 天` : '';
  }

  build() {
    Column({ space: 8 }) {
      Stack({ alignContent: Alignment.Center }) {
        Shape() {
          Path().commands('M 60 20 A 40 40 0 1 1 60 100 A 40 40 0 1 1 60 20')
            .stroke($r('app.color.surface_card')).strokeWidth(20).fill(Color.Transparent)
          ForEach(this.segments(), (segment: DomainSegment) => {
            Path().commands(this.arc(segment.start, segment.end))
              .stroke(this.color(segment.index)).strokeWidth(20).fill(Color.Transparent)
          }, (segment: DomainSegment) => segment.domain.domain)
        }.viewPort({ x: 0, y: 0, width: 120, height: 120 }).width(this.chartSize).height(this.chartSize)
          .hitTestBehavior(HitTestMode.None)
        Column({ space: 2 }) {
          Text(this.total.toString()).fontFamily(workspaceLatinSerifFamily(this.workspaceBreakpoint))
            .fontSize(38).fontColor($r('app.color.ink'))
          Text('日志小节').fontSize(12).fontColor($r('app.color.muted'))
        }.hitTestBehavior(HitTestMode.None)
      }.width(this.chartSize).height(this.chartSize).id('stats_domain_chart')
        .onMouse((event: MouseEvent) => this.activeIndex = this.segmentAt(event.x, event.y))
        .onHover((hover: boolean) => { if (!hover) this.activeIndex = -1; })
        .onClick((event: ClickEvent) => {
          const index = this.segmentAt(event.x, event.y);
          if (index >= 0) { this.activeIndex = index; this.onDomain(this.domains[index].domain); }
        })
      Text(this.activeDescription()).height(20).fontSize(12).fontColor($r('app.color.muted'))
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Center }) {
        ForEach(this.domains, (domain: DomainCount, index: number) => {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 5 }) {
              Circle().width(8).height(8).fill(this.color(index))
              Text(domain.domain).fontSize(12).fontColor($r('app.color.body'))
            }
          }.height(32).padding({ left: 6, right: 6 }).backgroundColor(Color.Transparent).borderRadius(6)
            .onClick(() => { this.activeIndex = index; this.onDomain(domain.domain); })
            .accessibilityText(`${domain.domain}，${domain.count} 个小节，${domain.percentage.toFixed(1)}%`)
        }, (domain: DomainCount) => domain.domain)
      }.width('100%')
    }.width('100%').alignItems(HorizontalAlign.Center)
  }
}
