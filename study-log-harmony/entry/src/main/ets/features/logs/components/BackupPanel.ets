import { KeyCode } from '@kit.InputKit';
import { webview } from '@kit.ArkWeb';
import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { apiClient, ApiError } from '../../../common/network/ApiClient';
import { ActionPanelHeader } from '../../../common/ui/WorkspaceChrome';
import { InlineStatus, LoadFailure } from '../../../common/ui/FeedbackStates';
import { iconTint } from '../../../common/ui/IconTint';
import { workspaceSerifFamily } from '../../../common/ui/Typography';
import { ToolbarAction } from '../../../common/ui/ToolbarAction';
import { BackupPreview, BackupVersion } from '../BackupModels';
import { BackupRepository } from '../BackupRepository';
import { matchesRestoredContent } from '../LogDayBody';
import { DayEntry } from '../LogModels';

class BackupFrameBridge {
  onRendered: (revision: number) => void = () => {};

  rendered(revision: number): void {
    this.onRendered(revision);
  }
}

@Component
export struct BackupPanel {
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @StorageProp('systemTheme') @Watch('themeChanged') private systemTheme: string = 'light';
  @Link maximized: boolean;
  @Prop date: string = '';
  @Prop @Watch('themeChanged') themePreference: string = 'system';
  onClose: () => void = () => {};
  onBeforeRestore: () => Promise<boolean> = async () => false;
  onRestored: (day: DayEntry) => Promise<void> = async () => {};
  onBusyChange: (busy: boolean) => void = () => {};
  @State private versions: BackupVersion[] = [];
  @State private nextCursor: string | null = null;
  @State private selected: BackupVersion | undefined = undefined;
  @State private preview: BackupPreview | undefined = undefined;
  @State private loading: boolean = true;
  @State private loadingMore: boolean = false;
  @State private previewLoading: boolean = false;
  @State private webContentReady: boolean = false;
  @State private confirming: boolean = false;
  @State private restoring: boolean = false;
  @State private conflict: boolean = false;
  @State private listError: string = '';
  @State private previewError: string = '';
  @State private restoreError: string = '';
  @State private panelWidth: number = 0;
  @State private panelHeight: number = 0;
  private repository: BackupRepository = new BackupRepository(apiClient);
  private controller: webview.WebviewController = new webview.WebviewController();
  private frameBridge: BackupFrameBridge = new BackupFrameBridge();
  private webPageReady: boolean = false;
  private lifecycle: number = 0;
  private listRevision: number = 0;
  private previewRevision: number = 0;

  aboutToAppear(): void {
    const lifecycle = ++this.lifecycle;
    this.frameBridge.onRendered = (revision: number) => {
      if (lifecycle === this.lifecycle && revision === this.previewRevision && this.webPageReady) {
        this.webContentReady = true;
      }
    };
    this.loadVersions();
  }

  aboutToDisappear(): void {
    this.lifecycle++;
    this.listRevision++;
    this.previewRevision++;
    this.onBusyChange(false);
  }

  private busy(): boolean { return this.confirming || this.restoring; }
  private wide(): boolean { return this.panelWidth >= 760; }

  private time(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const pad = (number: number): string => number.toString().padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private formatSize(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` :
      `${(bytes / 1048576).toFixed(1)} MB`;
  }

  private async loadVersions(more: boolean = false): Promise<void> {
    if (more && (!this.nextCursor || this.loadingMore)) return;
    const lifecycle = this.lifecycle;
    const revision = ++this.listRevision;
    const cursor = more ? this.nextCursor || '' : '';
    if (more) this.loadingMore = true;
    else { this.loading = true; this.versions = []; this.nextCursor = null; }
    this.listError = '';
    try {
      const response = await this.repository.list(this.date, cursor);
      if (lifecycle !== this.lifecycle || revision !== this.listRevision) return;
      if (!response.backup || !Array.isArray(response.backup.write)) throw new Error('备份列表格式异常');
      this.versions = more ? [...this.versions, ...response.backup.write] : response.backup.write;
      this.nextCursor = response.backup.nextCursor;
    } catch (error) {
      if (lifecycle === this.lifecycle && revision === this.listRevision) {
        this.listError = error instanceof Error ? error.message : '读取备份列表失败';
      }
    } finally {
      if (lifecycle === this.lifecycle && revision === this.listRevision) {
        this.loading = false;
        this.loadingMore = false;
      }
    }
  }

  private async selectVersion(version: BackupVersion): Promise<void> {
    if (this.busy()) return;
    if (this.selected?.id === version.id && this.previewLoading) return;
    if (this.selected?.id === version.id && this.preview?.id === version.id &&
      !this.previewLoading && !this.previewError && !this.conflict) return;
    const lifecycle = this.lifecycle;
    const revision = ++this.previewRevision;
    this.selected = version;
    this.previewLoading = true;
    this.previewError = '';
    this.restoreError = '';
    this.conflict = false;
    try {
      const response = await this.repository.preview(this.date, version.id);
      if (lifecycle !== this.lifecycle || revision !== this.previewRevision) return;
      const preview = response.preview;
      if (!preview || preview.date !== this.date || preview.kind !== 'write' || preview.id !== version.id ||
        !/^[a-f0-9]{64}$/.test(preview.backupVersion)) throw new Error('历史版本响应格式异常');
      this.preview = preview;
      await this.renderPreview();
    } catch (error) {
      if (lifecycle === this.lifecycle && revision === this.previewRevision) {
        this.previewError = error instanceof Error ? error.message : '读取历史版本失败';
      }
    } finally {
      if (lifecycle === this.lifecycle && revision === this.previewRevision) this.previewLoading = false;
    }
  }

  private async renderPreview(): Promise<void> {
    if (!this.preview || !this.webPageReady) return;
    const preview = this.preview;
    const revision = this.previewRevision;
    const label = this.selected ? this.time(this.selected.createdAt) : '';
    try {
      await this.controller.runJavaScript(`window.renderBackup(${JSON.stringify(preview.currentContent)},` +
        `${JSON.stringify(preview.historicalContent)},${this.darkTheme()},${JSON.stringify(label)});` +
        `requestAnimationFrame(() => requestAnimationFrame(() => window.backupFrames.rendered(${revision})));`);
    } catch (_) {
      if (revision === this.previewRevision) this.previewError = '历史版本显示失败，请重新选择版本';
    }
  }

  private darkTheme(): boolean {
    return this.themePreference === 'dark' ||
      (this.themePreference === 'system' && this.systemTheme === 'dark');
  }

  private previewPending(): boolean {
    return this.previewLoading || (this.preview !== undefined && !this.webContentReady);
  }

  private themeChanged(): void {
    this.controller.runJavaScript(`document.documentElement.classList.toggle('dark',${this.darkTheme()})`)
      .catch(() => {});
  }

  private async restore(): Promise<void> {
    const preview = this.preview;
    if (!preview || this.busy() || this.previewLoading || this.previewError || !this.webContentReady || this.conflict) return;
    const lifecycle = this.lifecycle;
    const revision = this.previewRevision;
    this.confirming = true;
    this.onBusyChange(true);
    let approved = false;
    try { approved = await this.onBeforeRestore(); }
    catch (error) { this.restoreError = error instanceof Error ? error.message : '无法确认恢复'; }
    if (lifecycle !== this.lifecycle) return;
    this.confirming = false;
    if (!approved || revision !== this.previewRevision || this.preview !== preview) {
      this.onBusyChange(false);
      return;
    }
    this.restoring = true;
    this.restoreError = '';
    let restoredDay: DayEntry | undefined = undefined;
    try {
      try {
        const response = await this.repository.restore({ date: preview.date, kind: 'write', id: preview.id,
          baseVersion: preview.currentVersion, backupVersion: preview.backupVersion });
        if (lifecycle !== this.lifecycle || revision !== this.previewRevision) return;
        if (!response.day || response.day.date !== preview.date || !response.day.exists || !response.day.version) {
          throw new Error('恢复响应格式异常');
        }
        restoredDay = response.day;
      } catch (error) {
        if (lifecycle !== this.lifecycle || revision !== this.previewRevision) return;
        const uncertain = !(error instanceof ApiError) || error.statusCode === 0 || error.statusCode === 409 ||
          error.statusCode >= 500 || error.code === 'INVALID_RESPONSE';
        let verificationFailed = false;
        if (uncertain) {
          try {
            const current = await this.repository.day(preview.date);
            if (lifecycle !== this.lifecycle || revision !== this.previewRevision) return;
            if (current.day && matchesRestoredContent(current.day, preview.date, preview.historicalContent)) {
              restoredDay = current.day;
            } else if (current.day && current.day.version !== preview.currentVersion) {
              this.conflict = true;
              this.restoreError = '内容已变化，请重新预览并确认后再恢复。';
              return;
            }
          } catch (_) { verificationFailed = true; }
        }
        if (!restoredDay) {
          this.conflict = !verificationFailed && error instanceof ApiError && error.statusCode === 409;
          this.restoreError = verificationFailed ? '恢复结果未确认，请检查连接后重试。' :
            this.conflict ? '内容已变化，请重新预览并确认后再恢复。' :
            error instanceof Error ? error.message : '恢复失败';
          return;
        }
      }
      if (restoredDay) {
        try { await this.onRestored(restoredDay); }
        catch (_) {
          if (lifecycle === this.lifecycle && revision === this.previewRevision) {
            this.restoreError = '服务器已恢复，但编辑器同步失败。请刷新日志。';
          }
        }
      }
    } finally {
      if (lifecycle === this.lifecycle) {
        this.restoring = false;
        this.onBusyChange(false);
      }
    }
  }

  @Builder
  private versionList() {
    Scroll() {
      Column({ space: 8 }) {
        Row() {
          Text('恢复目标').fontSize(11).fontColor($r('app.color.muted')).layoutWeight(1)
          Text(this.date).fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        }.width('100%').padding({ bottom: 10 }).margin({ bottom: 8 })
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
        Text('保存前版本').fontSize(13).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
        Text('最近 20 个不同的日块版本').fontSize(11).fontColor($r('app.color.muted'))
        if (this.loading) {
          Row({ space: 8 }) {
            LoadingProgress().width(18).height(18).color($r('app.color.primary'))
            Text('正在读取备份').fontSize(12).fontColor($r('app.color.muted'))
          }.width('100%')
        } else if (this.listError && this.versions.length === 0) {
          Button('读取失败，点击重试', { type: ButtonType.Normal }).height(36)
            .fontSize(12).fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
            .onClick(() => this.loadVersions())
          Text(this.listError).fontSize(12).fontColor($r('app.color.error'))
        } else if (this.versions.length === 0) {
          Text('没有可用版本').fontSize(12).fontColor($r('app.color.muted_soft'))
        }
        ForEach(this.versions, (version: BackupVersion) => {
          Button({ type: ButtonType.Normal }) {
            Row() {
              Text(this.time(version.createdAt)).fontSize(12).fontColor($r('app.color.body')).layoutWeight(1)
              Text(this.formatSize(version.sizeBytes)).fontSize(11).fontColor($r('app.color.muted'))
            }
          }.width('100%').height(36).padding({ left: 10, right: 10 }).borderRadius(6)
            .backgroundColor(this.selected?.id === version.id ? $r('app.color.surface_card') : Color.Transparent)
            .enabled(!this.busy()).onClick(() => this.selectVersion(version))
        }, (version: BackupVersion) => version.id)
        if (this.nextCursor || this.listError && this.versions.length > 0) {
          Button(this.loadingMore ? '正在读取' : this.listError ? '重试更早版本' : '加载更早版本',
            { type: ButtonType.Normal }).height(36)
            .fontSize(12).fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
            .enabled(!this.loadingMore).onClick(() => this.loadVersions(true))
        }
      }.width('100%').padding(12).alignItems(HorizontalAlign.Start)
    }.id('backup_versions').width(this.wide() ? 250 : '100%')
      .height(this.wide() ? '100%' : Math.min(260, Math.max(120, this.panelHeight * 0.32)))
      .align(Alignment.TopStart).scrollBar(BarState.Auto)
      .backgroundColor($r('app.color.canvas'))
      .border({ width: this.wide() ? { right: 1 } : { bottom: 1 }, color: $r('app.color.hairline') })
  }

  @Builder
  private previewEmpty() {
    Column({ space: 8 }) {
      if (this.previewPending()) {
        LoadingProgress().width(22).height(22).color($r('app.color.primary'))
      } else {
        Image($r('app.media.archive_restore')).width(22).height(22)
          .colorFilter(iconTint($r('app.color.muted_soft')))
      }
      Text(this.previewPending() ? '正在读取历史日块' : '选择一个历史版本')
        .fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted'))
      if (!this.previewLoading && !this.preview) {
        Text('确认内容后再恢复，不会整文件覆盖。').fontSize(12)
          .fontColor($r('app.color.muted_soft')).textAlign(TextAlign.Center)
      }
    }.width('100%').height('100%').justifyContent(FlexAlign.Center).padding(16)
  }

  @Builder
  private comparison() {
    Column() {
      if (this.previewLoading && !this.preview) {
        Column() { this.previewEmpty() }
          .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.previewError && !this.preview) {
        LoadFailure({ title: '历史版本读取失败', message: this.previewError,
          onRetry: () => { if (this.selected) this.selectVersion(this.selected); } })
      } else if (this.preview) {
        Stack() {
          Web({ src: $rawfile('editor/backup.html'), controller: this.controller, renderMode: RenderMode.SYNC_RENDER })
            .id('backup_comparison_web').width('100%').height('100%')
            .opacity(this.webContentReady ? 1 : 0)
            .javaScriptAccess(true).domStorageAccess(false).onlineImageAccess(false)
            .javaScriptProxy({ object: this.frameBridge, name: 'backupFrames', methodList: ['rendered'], controller: this.controller })
            .backgroundColor($r('app.color.canvas')).monopolizeEvents(true)
            .onOverrideUrlLoading(() => true)
            .onPageBegin(() => { this.webPageReady = false; this.webContentReady = false; })
            .onPageEnd(() => { this.webPageReady = true; this.renderPreview(); })
          if (this.previewError) {
            Column() {
              LoadFailure({ title: '历史版本读取失败', message: this.previewError,
                onRetry: () => { if (this.selected) this.selectVersion(this.selected); } })
            }.width('100%').height('100%').backgroundColor($r('app.color.canvas')).zIndex(1)
          } else if (this.previewPending()) {
            Column() { this.previewEmpty() }
              .width('100%').height('100%').backgroundColor($r('app.color.canvas')).zIndex(1)
          }
        }.width('100%').layoutWeight(1).backgroundColor($r('app.color.canvas'))
        if (this.restoreError) {
          InlineStatus({ text: this.restoreError, error: true })
        }
        Flex({ direction: FlexDirection.Row,
          wrap: this.wide() ? FlexWrap.NoWrap : FlexWrap.Wrap,
          justifyContent: FlexAlign.End, alignItems: ItemAlign.Center }) {
          Text(this.conflict ? '请重新预览后再恢复。' : '仅恢复当前日块，恢复前会保留现有文件。')
            .fontSize(12).fontColor($r('app.color.muted'))
            .width(this.wide() ? undefined : '100%')
            .layoutWeight(this.wide() ? 1 : 0)
            .margin(this.wide() ? { right: 16 } : { bottom: 12 })
          if (this.conflict) {
            Button('重新预览', { type: ButtonType.Normal }).fontSize(13)
              .fontColor($r('app.color.body')).backgroundColor($r('app.color.canvas'))
              .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
              .onClick(() => { if (this.selected) this.selectVersion(this.selected); })
          } else {
            ToolbarAction({ label: this.restoring ? '恢复中' : '恢复此版本',
              icon: $r('app.media.archive_restore'), primary: true, busy: this.restoring,
              available: this.webContentReady && !this.previewLoading && !this.previewError && !this.busy(),
              onAction: () => this.restore() })
          }
        }.id('backup_restore_footer').width('100%').flexShrink(0)
          .padding({ left: 16, right: 16, top: 12, bottom: 12 })
          .backgroundColor($r('app.color.surface_soft'))
          .border({ width: { top: 1 }, color: $r('app.color.hairline') })
      } else {
        Column() { this.previewEmpty() }
          .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
      }
    }.width('100%').height('100%')
  }

  build() {
    Column({ space: 12 }) {
      if (this.breakpoint === WorkspaceBreakpoint.COMPACT) {
        ActionPanelHeader({ title: '备份与恢复', closeLabel: '关闭备份与恢复', showDragBar: true,
          onClose: () => { if (!this.busy()) this.onClose(); } })
      } else {
        Row({ space: 8 }) {
          Image($r('app.media.database_backup')).width(24).height(24)
            .colorFilter(iconTint($r('app.color.primary'))).margin({ right: 8 })
          Column({ space: 3 }) {
            Text('备份与恢复').fontFamily(workspaceSerifFamily(this.breakpoint)).fontSize(24)
              .fontColor($r('app.color.ink'))
            Text('比较历史内容，恢复当前日块。').fontSize(11).fontColor($r('app.color.muted'))
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          ToolbarAction({ label: this.maximized ? '还原备份窗口' : '最大化备份窗口', showLabel: false,
            icon: this.maximized ? $r('app.media.minimize_2') : $r('app.media.maximize_2'),
            onAction: () => this.getUIContext().animateTo({ duration: 260, curve: Curve.EaseInOut }, () => {
              this.maximized = !this.maximized;
            }) })
          ToolbarAction({ label: '关闭备份与恢复', showLabel: false, useSymbol: true,
            symbol: $r('sys.symbol.xmark'), available: !this.busy(), onAction: this.onClose })
        }.width('100%').height(48)
      }
      if (this.loading) {
        Column({ space: 8 }) {
          LoadingProgress().width(22).height(22).color($r('app.color.primary'))
          Text('正在读取备份列表').fontSize(13).fontColor($r('app.color.muted'))
        }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.listError && this.versions.length === 0) {
        Column() {
          LoadFailure({ title: '备份列表读取失败', message: this.listError,
            onRetry: () => this.loadVersions() })
        }.width('100%').layoutWeight(1)
      } else {
        if (this.wide()) {
          Row() { this.versionList(); Column() { this.comparison() }.layoutWeight(1).height('100%') }
            .width('100%').layoutWeight(1)
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
        } else {
          this.versionList()
          Column() { this.comparison() }.width('100%').layoutWeight(1)
        }
      }
    }.width('100%').height('100%').padding({ left: 16, right: 16, top: 8, bottom: 18 })
      .backgroundColor($r('app.color.canvas'))
      .onAreaChange((_old, area) => {
        this.panelWidth = Number(area.width);
        this.panelHeight = Number(area.height);
      })
      .onKeyEvent((event: KeyEvent) => {
        if (event.type !== KeyType.Down || event.keyCode !== KeyCode.KEYCODE_ESCAPE) return false;
        if (!this.busy()) this.onClose();
        return true;
      })
  }
}
