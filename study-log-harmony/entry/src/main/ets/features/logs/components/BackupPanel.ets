import { webview } from '@kit.ArkWeb';
import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { apiClient, ApiError } from '../../../common/network/ApiClient';
import { EmptyState, InlineStatus, LoadFailure } from '../../../common/ui/FeedbackStates';
import { workspaceSerifFamily } from '../../../common/ui/Typography';
import { BackupPreview, BackupVersion } from '../BackupModels';
import { BackupRepository } from '../BackupRepository';
import { DayEntry } from '../LogModels';

@Component
export struct BackupPanel {
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @StorageProp('systemTheme') private systemTheme: string = 'light';
  @Prop date: string = '';
  onClose: () => void = () => {};
  onBeforeRestore: () => Promise<boolean> = async () => false;
  onRestored: (day: DayEntry) => void = () => {};
  onBusyChange: (busy: boolean) => void = () => {};
  @State private versions: BackupVersion[] = [];
  @State private nextCursor: string | null = null;
  @State private selected: BackupVersion | undefined = undefined;
  @State private preview: BackupPreview | undefined = undefined;
  @State private loading: boolean = true;
  @State private loadingMore: boolean = false;
  @State private previewLoading: boolean = false;
  @State private confirming: boolean = false;
  @State private restoring: boolean = false;
  @State private conflict: boolean = false;
  @State private listError: string = '';
  @State private previewError: string = '';
  @State private restoreError: string = '';
  @State private panelWidth: number = 0;
  private repository: BackupRepository = new BackupRepository(apiClient);
  private controller: webview.WebviewController = new webview.WebviewController();
  private lifecycle: number = 0;
  private listRevision: number = 0;
  private previewRevision: number = 0;

  aboutToAppear(): void {
    this.lifecycle++;
    this.loadVersions();
  }

  aboutToDisappear(): void {
    this.lifecycle++;
    this.listRevision++;
    this.previewRevision++;
    this.onBusyChange(false);
  }

  private busy(): boolean { return this.confirming || this.restoring; }
  private wide(): boolean { return this.panelWidth >= 720; }

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
    const lifecycle = this.lifecycle;
    const revision = ++this.previewRevision;
    this.selected = version;
    this.preview = undefined;
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
      this.renderPreview();
    } catch (error) {
      if (lifecycle === this.lifecycle && revision === this.previewRevision) {
        this.previewError = error instanceof Error ? error.message : '读取历史版本失败';
      }
    } finally {
      if (lifecycle === this.lifecycle && revision === this.previewRevision) this.previewLoading = false;
    }
  }

  private renderPreview(): void {
    if (!this.preview) return;
    const preview = this.preview;
    const label = this.selected ? this.time(this.selected.createdAt) : '';
    this.controller.runJavaScript(`window.renderBackup(${JSON.stringify(preview.currentContent)},` +
      `${JSON.stringify(preview.historicalContent)},${this.systemTheme === 'dark'},${JSON.stringify(label)})`)
      .catch(() => {});
  }

  private async restore(): Promise<void> {
    const preview = this.preview;
    if (!preview || this.busy() || this.conflict) return;
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
    try {
      const response = await this.repository.restore({ date: preview.date, kind: 'write', id: preview.id,
        baseVersion: preview.currentVersion, backupVersion: preview.backupVersion });
      if (lifecycle !== this.lifecycle || revision !== this.previewRevision) return;
      if (!response.day || response.day.date !== preview.date || !response.day.exists || !response.day.version) {
        throw new Error('恢复响应格式异常');
      }
      this.onRestored(response.day);
    } catch (error) {
      if (lifecycle !== this.lifecycle || revision !== this.previewRevision) return;
      this.conflict = error instanceof ApiError && error.statusCode === 409;
      this.restoreError = this.conflict ? '内容已变化，请重新预览并确认后再恢复。' :
        error instanceof Error ? error.message : '恢复失败';
    } finally {
      if (lifecycle === this.lifecycle) {
        this.restoring = false;
        this.onBusyChange(false);
      }
    }
  }

  @Builder
  private versionList() {
    Column({ space: 8 }) {
      Row() {
        Text('恢复目标').fontSize(11).fontColor($r('app.color.muted')).layoutWeight(1)
        Text(this.date).fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
      }.width('100%').padding({ bottom: 10 })
        .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
      Text('保存前版本').fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        .width('100%')
      Text('最近 20 个不同的日块版本').fontSize(11).fontColor($r('app.color.muted'))
        .width('100%')
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
      Scroll() {
        Column() {
          ForEach(this.versions, (version: BackupVersion) => {
            Button({ type: ButtonType.Normal }) {
              Row() {
                Text(this.time(version.createdAt)).fontSize(12).fontColor($r('app.color.body')).layoutWeight(1)
                Text(this.formatSize(version.sizeBytes)).fontSize(11).fontColor($r('app.color.muted'))
              }.width('100%')
            }.width('100%').height(38).padding({ left: 10, right: 10 })
              .backgroundColor(this.selected?.id === version.id ? $r('app.color.surface_card') : Color.Transparent)
              .borderRadius(6).enabled(!this.busy()).onClick(() => this.selectVersion(version))
          }, (version: BackupVersion) => version.id)
          if (this.nextCursor || this.listError) {
            Button(this.loadingMore ? '正在读取' : this.listError ? '重试更早版本' : '加载更早版本',
              { type: ButtonType.Normal }).height(36)
              .fontSize(12).fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
              .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
              .enabled(!this.loadingMore).onClick(() => this.loadVersions(true))
          }
        }.width('100%')
      }.layoutWeight(1).width('100%').scrollBar(BarState.Auto)
    }.width(this.wide() ? 250 : '100%').height(this.wide() ? '100%' : 210)
      .alignItems(HorizontalAlign.Start).padding(12)
      .backgroundColor($r('app.color.canvas'))
      .border({ width: this.wide() ? { right: 1 } : { bottom: 1 }, color: $r('app.color.hairline') })
  }

  @Builder
  private comparison() {
    Column() {
      if (this.previewLoading) {
        Row({ space: 8 }) {
          LoadingProgress().width(20).height(20).color($r('app.color.primary'))
          Text('正在读取历史日块').fontSize(13).fontColor($r('app.color.muted'))
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.previewError && !this.preview) {
        LoadFailure({ title: '历史版本读取失败', message: this.previewError,
          onRetry: () => { if (this.selected) this.selectVersion(this.selected); } })
      } else if (this.preview) {
        Web({ src: $rawfile('editor/backup.html'), controller: this.controller, renderMode: RenderMode.SYNC_RENDER })
          .width('100%').layoutWeight(1).javaScriptAccess(true).domStorageAccess(false).onlineImageAccess(false)
          .onOverrideUrlLoading(() => true).onPageEnd(() => this.renderPreview())
        if (this.restoreError) {
          InlineStatus({ text: this.restoreError, error: true })
        }
        Row({ space: 8 }) {
          Text(this.conflict ? '请重新预览后再恢复。' : '仅恢复当前日块，恢复前会保留现有文件。')
            .fontSize(12).fontColor($r('app.color.muted')).layoutWeight(1)
          if (this.conflict) {
            Button('重新预览', { type: ButtonType.Normal }).fontSize(13)
              .fontColor($r('app.color.body')).backgroundColor($r('app.color.canvas'))
              .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
              .onClick(() => { if (this.selected) this.selectVersion(this.selected); })
          } else {
            Button(this.restoring ? '恢复中' : '恢复此版本')
              .fontSize(13).fontColor($r('app.color.on_primary')).backgroundColor($r('app.color.primary'))
              .enabled(!this.busy()).onClick(() => this.restore())
          }
        }.width('100%').padding(12).backgroundColor($r('app.color.surface_soft'))
      } else {
        EmptyState({ title: '选择一个历史版本', description: '确认内容后再恢复当前日块。' })
      }
    }.layoutWeight(1).height('100%').width(this.wide() ? undefined : '100%')
  }

  build() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Column({ space: 3 }) {
          Text('备份与恢复').fontFamily(workspaceSerifFamily(this.breakpoint)).fontSize(24)
            .fontColor($r('app.color.ink'))
          Text('比较历史内容，恢复当前日块。').fontSize(11).fontColor($r('app.color.muted'))
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Button('关闭', { type: ButtonType.Normal }).enabled(!this.busy())
          .fontSize(13).fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
          .onClick(() => this.onClose())
      }.width('100%').height(48)
      if (this.wide()) {
        Row() { this.versionList(); this.comparison() }.width('100%').layoutWeight(1)
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
      } else {
        Column() { this.versionList(); this.comparison() }.width('100%').layoutWeight(1)
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
      }
    }.width('100%').height('100%').padding(16)
      .backgroundColor($r('app.color.canvas'))
      .onAreaChange((_old, area) => this.panelWidth = Number(area.width))
  }
}
