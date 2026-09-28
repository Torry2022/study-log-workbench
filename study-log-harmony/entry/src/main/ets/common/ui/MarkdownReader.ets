import { appFeedback } from './AppFeedback';
import { webview } from '@kit.ArkWeb';
import common from '@ohos.app.ability.common';
import { apiClient } from '../network/ApiClient';
import { activeInstance } from '../network/InstanceConfig';
import { WorkspaceBreakpoint, READING_MAX_WIDTH } from '../AppConfig';
import { usesWideTypography } from './Typography';
import { BackToTopControl } from './BackToTopControl';
import { FrameAction } from './FrameAction';

class ReaderFrameBridge {
  previewImage(source: string): void {
    if (/^(data:image\/|https:\/\/)/.test(source)) AppStorage.setOrCreate('previewImageSource', source);
  }
  onRendered: (sequence: number) => void = () => {};
  onViewportReady: (sequence: number) => void = () => {};
  onFailed: (sequence: number) => void = () => {};
  onActiveHeading: (headingId: string) => void = () => {};

  activeHeading(headingId: string): void {
    this.onActiveHeading(headingId);
  }

  failed(sequence: number): void {
    this.onFailed(sequence);
  }

  viewportReady(sequence: number): void {
    this.onViewportReady(sequence);
  }

  rendered(sequence: number): void {
    this.onRendered(sequence);
  }

}

@Component
export struct MarkdownReader {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop @Watch('contentChanged') content: string = '';
  @Prop @Watch('viewportRequested') viewportRequestRevision: number = 0;
  @Prop contentMode: string = 'document';
  onImageDrop?: (event: DragEvent) => void;
  @Prop fillAvailableWidth: boolean = false;
  @Prop @Watch('viewportRequested') stableViewport: boolean = false;
  @State private surfaceWidth: number = 0;
  @State private surfaceInset: number = 0;
  @Prop @Watch('contentTopInsetChanged') contentTopInset: number = 0;
  @Prop followEnd: boolean = false;
  @Prop resetScrollOnContentChange: boolean = false;
  @Prop @Watch('contentChanged') documentKey: string = '';
  @Prop restoreScrollOffset: number = 0;
  @Prop @Watch('themePreferenceChanged') themePreference: string = 'system';
  @StorageProp('systemTheme') @Watch('systemThemeChanged') private systemTheme: string = 'light';
  @StorageProp('pref_readingScale') @Watch('readingScaleChanged') private readingScale: number = 1;
  @Prop targetHeading: string = '';
  @Prop targetHeadingIndex: number = -1;
  @Prop targetHeadingId: string = '';
  @Prop targetKind: string = '';
  @Prop targetQuery: string = '';
  @Prop @Watch('targetRequestChanged') targetRevision: number = 0;
  @Prop @Watch('outlineRequestChanged') outlineRequestRevision: number = 0;
  @Prop @Watch('scrollToTopRequestChanged') scrollToTopRequestRevision: number = 0;
  @Prop showBackToTop: boolean = true;
  @Prop backToTopInset: number = 14;
  @Prop trackScrollProgress: boolean = false;
  @Prop trackActiveHeading: boolean = false;
  onInternalLink: (date: string, heading: string) => void = () => {};
  onCitationLink: (date: string, heading: string, headingIndex: number) => void = () => {};
  onWikiCitationLink: (pageId: string, title: string) => void = () => {};
  onWikiReviewLink: (reviewId: string) => void = () => {};
  onQaAttemptAction: (id: string, action: string) => void = () => {};
  onWikiSourceLink: (kind: string, date: string, heading: string, noteId: string) => void = () => {};
  onTargetResult: (kind: string, found: boolean) => void = () => {};
  onRenderReady: () => void = () => {};
  onRenderFailed: (documentKey: string) => void = () => {};
  onViewportReady: () => void = () => {};
  onContentRendered: (content: string, documentKey: string) => void = () => {};
  onScrollPosition: (yOffset: number) => void = () => {};
  onScrollProgress: (progress: number) => void = () => {};
  onTopDividerPosition: (yOffset: number) => void = () => {};
  onActiveHeading: (headingId: string) => void = () => {};
  private controller: webview.WebviewController = new webview.WebviewController();
  private frameBridge: ReaderFrameBridge = new ReaderFrameBridge();
  @State private ready: boolean = false;
  @State private webContentReady: boolean = false;
  @State private scrollOffset: number = 0;
  @State private scrollProgress: number = 0;
  private handledTargetRevision: number = -1;
  private lastRenderKey: string = '';
  private completedContentKey: string = '';
  private renderSequence: number = 0;
  private lastRenderedContent: string = '';
  private lastRenderedDocumentKey: string = '';
  private renderScheduled: boolean = false;
  private renderTimer: number = -1;
  private active: boolean = false;
  private viewportSequence: number = 0;
  private maxScrollOffset: number = 0;
  private scrollRangeQueryPending: boolean = false;
  private activeHeadingQueryPending: boolean = false;
  private viewportWidthPx: number = 0;

  private viewportRequested(): void {
    this.viewportSequence++;
    this.getUIContext().postFrameCallback(new FrameAction(() => this.checkViewport()));
  }

  private checkViewport(): void {
    if (this.active && this.ready && this.viewportWidthPx > 0) {
      const sequence = ++this.viewportSequence;
      this.controller.runJavaScript(`window.waitForReaderViewport(${this.viewportWidthPx}, ${this.stableViewport}, ${sequence})`);
    }
  }

  aboutToAppear(): void {
    this.active = true;
    this.frameBridge.onActiveHeading = (headingId: string) => {
      if (this.active && this.ready && this.trackActiveHeading) this.onActiveHeading(headingId);
    };
    this.frameBridge.onFailed = (sequence: number) => {
      if (this.acceptsRender(sequence)) this.onRenderFailed(this.lastRenderedDocumentKey);
    };
    this.frameBridge.onViewportReady = (sequence: number) => {
      if (this.active && this.ready && sequence === this.viewportSequence) this.onViewportReady();
    };
    this.frameBridge.onRendered = (sequence: number) => {
      if (!this.acceptsRender(sequence)) return;
      this.completedContentKey = this.desiredContentKey();
      this.webContentReady = true;
      this.measureScrollRange();
      this.measureActiveHeading();
      this.measureTopDividerPosition();
      this.onRenderReady();
      this.onContentRendered(this.lastRenderedContent, this.lastRenderedDocumentKey);
    };
  }

  aboutToDisappear(): void {
    this.active = false;
    this.renderSequence++;
    this.viewportSequence++;
    if (this.renderTimer >= 0) clearTimeout(this.renderTimer);
    this.renderTimer = -1;
    this.renderScheduled = false;
  }

  aboutToReuse(): void {
    this.requestRender();
  }

  private contentChanged(): void {
    this.requestRender();
  }

  onDidBuild(): void {
    if (this.ready) this.requestRender();
  }

  private themePreferenceChanged(): void {
    this.requestRender();
  }

  private systemThemeChanged(): void {
    if (this.themePreference === 'system') this.requestRender();
  }

  private contentTopInsetChanged(): void {
    this.requestRender();
  }

  private readingScaleChanged(): void {
    if (!this.ready) return;
    this.controller.runJavaScript(`document.documentElement.style.setProperty('--reading-scale', '${this.readingScale}');`);
    this.measureScrollRange();
  }

  private targetRequestChanged(): void {
    this.requestRender();
  }

  private outlineRequestChanged(): void {
    if (!this.ready || this.outlineRequestRevision <= 0) return;
    this.measureActiveHeading();
  }

  private javaScriptString(result: string): string {
    if (result.length < 2 || !result.startsWith('"') || !result.endsWith('"')) return result;
    try {
      return JSON.parse(result) as string;
    } catch (_) {
      return result;
    }
  }

  private scrollToTopRequestChanged(): void {
    if (!this.ready || this.scrollToTopRequestRevision <= 0) return;
    this.scrollToTop();
  }

  private requestRender(): void {
    if (!this.active || this.renderScheduled) return;
    this.renderScheduled = true;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = -1;
      this.renderScheduled = false;
      this.render();
    }, 0);
  }

  private desiredRenderKey(): string {
    const theme = this.themePreference === 'dark' || this.themePreference === 'light' ?
      this.themePreference : this.systemTheme;
    return JSON.stringify([
      this.content, this.contentMode, Math.max(0, this.contentTopInset),
      JSON.stringify(apiClient.getToken()), activeInstance.origin, theme,
      usesWideTypography(this.workspaceBreakpoint) ? 'wide' : 'compact',
      this.targetHeading, this.targetHeadingIndex, this.targetHeadingId, this.targetKind,
      this.targetQuery, this.targetRevision, this.followEnd, this.resetScrollOnContentChange,
      this.documentKey, Math.max(0, this.restoreScrollOffset)
    ]);
  }

  private desiredContentKey(): string {
    return JSON.stringify([this.content, this.documentKey, this.contentMode, this.contentTopInset,
      apiClient.getToken(), activeInstance.origin, this.themePreference, this.systemTheme, this.readingScale,
      usesWideTypography(this.workspaceBreakpoint)]);
  }

  private acceptsRender(sequence: number): boolean {
    return this.active && this.ready && sequence === this.renderSequence &&
      this.lastRenderKey === this.desiredRenderKey();
  }

  private render(): void {
    if (!this.active || !this.ready) return;
    const renderedContent = this.content;
    const markdown = JSON.stringify(renderedContent);
    const contentMode = JSON.stringify(this.contentMode);
    const contentTopInset = Math.max(0, this.contentTopInset);
    const token = JSON.stringify(apiClient.getToken());
    const origin = JSON.stringify(activeInstance.origin);
    const theme = this.themePreference === 'dark' || this.themePreference === 'light' ?
      this.themePreference : this.systemTheme;
    const typography = usesWideTypography(this.workspaceBreakpoint) ? 'wide' : 'compact';
    const heading = JSON.stringify(this.targetHeading);
    const headingId = JSON.stringify(this.targetHeadingId);
    const query = JSON.stringify(this.targetQuery);
    const shouldApplyTarget = this.targetRevision > 0 && this.handledTargetRevision !== this.targetRevision;
    const hasNewContent = renderedContent !== this.lastRenderedContent;
    const documentChanged = this.documentKey.length > 0 && this.documentKey !== this.lastRenderedDocumentKey;
    const restoreScrollOffset = Math.max(0, this.restoreScrollOffset);
    const revision = this.targetRevision;
    const kind = this.targetKind;
    if (shouldApplyTarget) this.handledTargetRevision = revision;
    const afterRender = shouldApplyTarget ?
      (kind === 'search' ? `window.scrollToText(${query}, true)` :
        (this.targetHeading || this.targetHeadingId ?
          `window.scrollToHeading(${heading}, ${this.targetHeadingIndex}, ${headingId})` : 'window.scrollToTop()')) :
      (this.followEnd ? 'window.scrollTo(0, document.body.scrollHeight)' :
        (documentChanged ? `window.scrollTo(0, ${restoreScrollOffset})` :
          (this.resetScrollOnContentChange && hasNewContent ? 'window.scrollToTop()' : 'true')));
    const targetResultUrl = JSON.stringify(
      `study-log://target-result?kind=${encodeURIComponent(kind)}&revision=${revision}`
    );
    const afterRenderAction = shouldApplyTarget && kind ?
      `const found = Boolean(${afterRender}); ${kind === 'internal' || kind === 'shared' || kind === 'shared-return' ? 'if (!found) window.scrollToTop(); ' : ''}window.location.href = ${targetResultUrl} + '&found=' + (found ? '1' : '0')` :
      afterRender;
    const renderKey = this.desiredRenderKey();
    if (renderKey === this.lastRenderKey) return;
    this.lastRenderKey = renderKey;
    this.lastRenderedContent = renderedContent;
    this.lastRenderedDocumentKey = this.documentKey;
    const renderSequence = ++this.renderSequence;
    const reuseContent = this.contentMode === 'log' && this.completedContentKey === this.desiredContentKey();
    if (!reuseContent) this.completedContentKey = '';
    const renderContent = reuseContent ? 'Promise.resolve()' :
      `window.renderMarkdown(${markdown}, ${token}, '${theme}', ${contentMode}, ${origin})`;
    this.controller.runJavaScript(
      (documentChanged ? 'window.clearLocatedHeading(); ' : '') +
      `document.documentElement.style.setProperty('--content-top-inset', '${contentTopInset}px'); ` +
      `document.documentElement.style.setProperty('--reading-scale', '${this.readingScale}'); ` +
      `document.documentElement.dataset.typography = '${typography}'; ` +
      `${renderContent}.then(() => { ${afterRenderAction}; ` +
      `requestAnimationFrame(() => requestAnimationFrame(() => { window.readerFrames.rendered(${renderSequence}); })); })` +
      `.catch(() => window.readerFrames.failed(${renderSequence}))`,
      (error) => {
        if (error && this.acceptsRender(renderSequence)) {
          this.onRenderFailed(this.lastRenderedDocumentKey);
          this.lastRenderKey = '';
          this.lastRenderedContent = '';
          this.lastRenderedDocumentKey = '';
        }
      }
    );
  }

  private handleTargetResult(url: string): boolean {
    if (!url.startsWith('study-log://target-result?')) return false;
    const values: Record<string, string> = {};
    url.slice(url.indexOf('?') + 1).split('&').forEach((part: string) => {
      const separator = part.indexOf('=');
      if (separator < 0) return;
      values[decodeURIComponent(part.slice(0, separator))] = decodeURIComponent(part.slice(separator + 1));
    });
    if (`${this.handledTargetRevision}` === values['revision'] && values['kind']) {
      this.onTargetResult(values['kind'], values['found'] === '1');
    }
    return true;
  }

  private handleInternalLink(url: string): boolean {
    if (!url.startsWith('study-log://wikilink?')) return false;
    const query = url.slice(url.indexOf('?') + 1);
    let date = '';
    let heading = '';
    query.split('&').forEach((part: string) => {
      const separator = part.indexOf('=');
      if (separator < 0) return;
      const key = decodeURIComponent(part.slice(0, separator));
      const value = decodeURIComponent(part.slice(separator + 1));
      if (key === 'date') date = value.trim();
      if (key === 'heading') heading = value.trim();
    });
    this.onInternalLink(date, heading);
    return true;
  }

  private handleCitationLink(url: string): boolean {
    if (!url.startsWith('study-log://citation?')) return false;
    const values: Record<string, string> = {};
    url.slice(url.indexOf('?') + 1).split('&').forEach((part: string) => {
      const separator = part.indexOf('=');
      if (separator < 0) return;
      values[decodeURIComponent(part.slice(0, separator))] = decodeURIComponent(part.slice(separator + 1));
    });
    const headingIndex = Number.parseInt(values['headingIndex'] || '-1');
    this.onCitationLink(values['date'] || '', values['heading'] || '', Number.isNaN(headingIndex) ? -1 : headingIndex);
    return true;
  }

  private measureTopDividerPosition(): void {
    if (this.contentMode !== 'qa') return;
    this.controller.runJavaScript(
      "(() => { const item = document.querySelector('.qa-message'); " +
        "return item ? item.offsetTop + item.offsetHeight : 0; })()",
      (error, result: string) => {
        if (error) return;
        const position = Number.parseFloat(result);
        this.onTopDividerPosition(Number.isFinite(position) ? Math.max(0, position) : 0);
      }
    );
  }

  private queryValues(url: string): Record<string, string> {
    const values: Record<string, string> = {};
    const queryIndex = url.indexOf('?');
    if (queryIndex < 0) return values;
    url.slice(queryIndex + 1).split('&').forEach((part: string) => {
      const separator = part.indexOf('=');
      if (separator < 0) return;
      values[decodeURIComponent(part.slice(0, separator))] = decodeURIComponent(part.slice(separator + 1));
    });
    return values;
  }

  private handleWikiCitationLink(url: string): boolean {
    if (!url.startsWith('study-log://wiki-citation?')) return false;
    const values = this.queryValues(url);
    this.onWikiCitationLink(values['pageId'] || '', values['title'] || '');
    return true;
  }

  private handleWikiSourceLink(url: string): boolean {
    if (!url.startsWith('study-log://wiki-source?')) return false;
    const values = this.queryValues(url);
    this.onWikiSourceLink(values['kind'] || '', values['date'] || '', values['heading'] || '', values['noteId'] || '');
    return true;
  }

  private confirmExternalLink(url: string): void {
    AlertDialog.show({
      message: `即将使用系统浏览器打开：\n${url}`,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '打开', action: () => this.openExternalLink(url) }
    });
  }

  private async openExternalLink(url: string): Promise<void> {
    const host = this.getUIContext().getHostContext() as common.UIAbilityContext;
    try {
      await host.startAbility({ action: 'ohos.want.action.viewData', uri: url });
    } catch (_) {
      appFeedback.show('无法打开系统浏览器', 'error');
    }
  }

  private handleNavigation(url: string): boolean {
    if (this.handleTargetResult(url)) return true;
    if (url.startsWith('study-log://qa-attempt?')) {
      const values = this.queryValues(url);
      if (this.contentMode === 'qa' && values['id'] && (values['action'] === 'retry' || values['action'] === 'edit')) {
        this.onQaAttemptAction(values['id'], values['action']);
      }
      return true;
    }
    if (url.startsWith('study-log://wiki-review?')) {
      this.onWikiReviewLink(this.queryValues(url)['id'] || '');
      return true;
    }
    if (this.handleWikiCitationLink(url)) return true;
    if (this.handleWikiSourceLink(url)) return true;
    if (this.handleCitationLink(url)) return true;
    if (this.handleInternalLink(url)) return true;
    if (!/^https?:\/\//i.test(url)) return false;
    this.confirmExternalLink(url);
    return true;
  }

  private handleScroll(yOffset: number): void {
    this.scrollOffset = Math.max(0, yOffset);
    this.onScrollPosition(yOffset);
    this.measureActiveHeading();
    if (!this.showBackToTop && !this.trackScrollProgress) return;
    this.updateScrollProgress();
    if (this.maxScrollOffset <= 0 || this.scrollOffset > this.maxScrollOffset) this.measureScrollRange();
  }

  private measureActiveHeading(): void {
    if (!this.trackActiveHeading || !this.ready || this.activeHeadingQueryPending) return;
    this.activeHeadingQueryPending = true;
    const sequence = this.renderSequence;
    this.controller.runJavaScript('window.currentHeadingId()', (error, result: string) => {
      this.activeHeadingQueryPending = false;
      if (!error && this.acceptsRender(sequence)) this.onActiveHeading(this.javaScriptString(result));
    });
  }

  private updateScrollProgress(): void {
    this.scrollProgress = this.maxScrollOffset > 0 ?
      Math.min(1, Math.max(0, this.scrollOffset / this.maxScrollOffset)) : 0;
    this.onScrollProgress(this.scrollProgress);
  }

  private measureScrollRange(): void {
    if ((!this.showBackToTop && !this.trackScrollProgress) || this.scrollRangeQueryPending) return;
    this.scrollRangeQueryPending = true;
    this.controller.runJavaScript(
      `Math.max(0, document.documentElement.scrollHeight - window.innerHeight)`,
      (error, result: string) => {
        this.scrollRangeQueryPending = false;
        if (error) return;
        const maxScrollOffset = Number.parseFloat(result);
        if (Number.isNaN(maxScrollOffset)) return;
        this.maxScrollOffset = Math.max(0, maxScrollOffset);
        this.updateScrollProgress();
      }
    );
  }

  private scrollToTop(): void {
    this.controller.runJavaScript(
      `window.clearLocatedHeading(); window.scrollTo({ top: 0, behavior: ` +
      `(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth' })`,
      () => {}
    );
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Row() {
      Web({
        src: $rawfile('markdown/index.html'),
        controller: this.controller,
        // Keep scrolling and overscroll on ArkWeb's independent render surface.
        renderMode: RenderMode.ASYNC_RENDER
      })
        .width(this.stableViewport && this.surfaceWidth > 0 ? this.surfaceWidth : '100%')
        .constraintSize({ maxWidth: this.stableViewport ? Math.max(this.surfaceWidth, READING_MAX_WIDTH) :
          (this.fillAvailableWidth ? '100%' : READING_MAX_WIDTH) })
        .height('100%')
        .offset({ x: this.stableViewport ? this.surfaceInset : 0 })
        .opacity(this.webContentReady ? 1 : 0)
        .backgroundColor($r('app.color.canvas'))
        .onDrop(this.onImageDrop)
        .javaScriptAccess(true)
        .javaScriptProxy({ object: this.frameBridge, name: 'readerFrames', methodList: ['rendered', 'viewportReady', 'previewImage', 'failed', 'activeHeading'], controller: this.controller })
        .onAreaChange((_oldArea, area) => {
          if (this.stableViewport) return;
          this.viewportWidthPx = this.getUIContext().vp2px(Number(area.width));
          this.checkViewport();
        })
        .domStorageAccess(false)
        .onlineImageAccess(true)
        .horizontalScrollBarAccess(false)
        .verticalScrollBarAccess(false)
        .overScrollMode(this.contentMode === 'log' ? OverScrollMode.NEVER : OverScrollMode.ALWAYS)
        .onScroll((event: OnScrollEvent) => this.handleScroll(event.yOffset))
        .onOverrideUrlLoading((request) => this.handleNavigation(request.getRequestUrl()))
        .onPageBegin(() => {
          this.completedContentKey = '';
          this.renderSequence++;
          this.viewportSequence++;
          this.ready = false;
          this.webContentReady = false;
        })
        .onPageEnd(() => {
          this.ready = true;
          this.checkViewport();
          this.webContentReady = false;
          this.lastRenderKey = '';
          this.lastRenderedContent = '';
          this.lastRenderedDocumentKey = '';
          this.requestRender();
        })
      }.width('100%').height('100%').justifyContent(this.stableViewport ? FlexAlign.Start : FlexAlign.Center)
        .clip(this.stableViewport)
        .onAreaChange((_oldArea, area) => {
          if (!this.stableViewport) return;
          const width = this.fillAvailableWidth ? Number(area.width) : Math.min(Number(area.width), READING_MAX_WIDTH);
          this.surfaceInset = Math.max(0, (Number(area.width) - width) / 2);
          this.surfaceWidth = Math.max(this.surfaceWidth, width);
          this.viewportWidthPx = this.getUIContext().vp2px(width);
          this.checkViewport();
        })
      if (this.showBackToTop) {
        BackToTopControl({
          visible: this.scrollOffset > 8,
          progress: this.scrollProgress,
          scrollOffset: this.scrollOffset,
          onBackToTop: () => this.scrollToTop()
        })
          .margin({ right: this.backToTopInset, bottom: this.backToTopInset })
          .zIndex(3)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.canvas'))
  }
}
