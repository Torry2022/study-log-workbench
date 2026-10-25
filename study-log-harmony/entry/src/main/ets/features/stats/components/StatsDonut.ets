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
  @StorageProp('systemTheme') @Watch('redraw') private systemTheme: string = 'light';
  @Prop @Watch('redraw') domains: DomainCount[] = [];
  @Prop total: number = 0;
  @Prop @Watch('redraw') chartSize: number = 264;
  @State private activeIndex: number = -1;
  private canvas: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private canvasReady: boolean = false;
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

  private redraw(): void {
    if (!this.canvasReady) return;
    const colors = this.getUIContext().getHostContext()!.resourceManager;
    const center = this.chartSize / 2;
    const radius = this.chartSize / 3;
    this.canvas.clearRect(0, 0, this.chartSize, this.chartSize);
    this.canvas.lineWidth = this.chartSize / 6;
    this.canvas.lineCap = 'butt';
    this.canvas.strokeStyle = colors.getColorSync($r('app.color.surface_card').id);
    this.canvas.beginPath();
    this.canvas.arc(center, center, radius, 0, Math.PI * 2);
    this.canvas.stroke();
    this.segments().forEach((segment: DomainSegment) => {
      if (segment.end <= segment.start) return;
      this.canvas.strokeStyle = colors.getColorSync(this.color(segment.index).id);
      this.canvas.beginPath();
      this.canvas.arc(center, center, radius, segment.start * Math.PI * 2 - Math.PI / 2,
        segment.end * Math.PI * 2 - Math.PI / 2);
      this.canvas.stroke();
    });
  }

  private segmentAt(x: number, y: number): number {
    const dx = x * 120 / this.chartSize - 60, dy = y * 120 / this.chartSize - 60;
    const radius = Math.sqrt(dx * dx + dy * dy);
    if (radius < 30 || radius > 50) return -1;
    const fraction = ((Math.atan2(dy, dx) / Math.PI * 180 + 450) % 360) / 360;
    return this.segments().findIndex((segment: DomainSegment) => fraction >= segment.start && fraction < segment.end);
  }

  @Builder
  private domainDetails() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Circle().width(9).height(9).fill(this.color(this.activeIndex))
        Text(this.domains[this.activeIndex]?.domain || '').fontSize(13).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.body_strong')).layoutWeight(1)
      }.width('100%')
      this.detailRow('日志小节', (this.domains[this.activeIndex]?.count || 0).toString())
      this.detailRow('占比', `${(this.domains[this.activeIndex]?.percentage || 0).toFixed(1)}%`)
      this.detailRow('记录天数', (this.domains[this.activeIndex]?.activeDays || 0).toString())
    }.width('100%').padding(12).id('stats_domain_details')
  }

  @Builder
  private detailRow(label: string, value: string) {
    Row() {
      Text(label).fontSize(11).fontColor($r('app.color.muted')).layoutWeight(1)
      Text(value).fontSize(11).fontColor($r('app.color.body')).fontFeature('"tnum" 1')
    }.width('100%')
  }

  build() {
    Column({ space: 8 }) {
      Stack({ alignContent: Alignment.Center }) {
        Canvas(this.canvas).width(this.chartSize).height(this.chartSize)
          .onReady(() => { this.canvasReady = true; this.redraw(); })
          .onAreaChange(() => this.redraw()).hitTestBehavior(HitTestMode.None)
        Column({ space: 2 }) {
          Text(this.total.toString()).fontFamily(workspaceLatinSerifFamily(this.workspaceBreakpoint))
            .fontSize(38).fontColor($r('app.color.ink'))
          Text('日志小节').fontSize(12).fontColor($r('app.color.muted'))
        }.width('100%').height('100%').justifyContent(FlexAlign.Center).hitTestBehavior(HitTestMode.None)
      }.width(this.chartSize).height(this.chartSize).id('stats_domain_chart')
        .onMouse((event: MouseEvent) => this.activeIndex = this.segmentAt(event.x, event.y))
        .onHover((hover: boolean) => { if (!hover) this.activeIndex = -1; })
        .onClick((event: ClickEvent) => {
          const index = this.segmentAt(event.x, event.y);
          if (index >= 0) { this.activeIndex = index; this.onDomain(this.domains[index].domain); }
        })
        .bindPopup(this.activeIndex >= 0 && this.activeIndex < this.domains.length, {
          builder: this.domainDetails(), placement: Placement.Top, width: 200,
          mask: false, enableArrow: false, autoCancel: true, targetSpace: 4,
          popupColor: $r('app.color.canvas'), radius: 8, backgroundBlurStyle: BlurStyle.NONE,
          shadow: { radius: 12, color: $r('app.color.popover_shadow'), offsetY: 4 },
          onStateChange: (event) => { if (!event.isVisible) this.activeIndex = -1; }
        })
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
