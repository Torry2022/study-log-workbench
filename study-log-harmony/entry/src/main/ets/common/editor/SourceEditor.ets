import { webview } from '@kit.ArkWeb';
import { textNavigationKey, workspaceKey } from '../ui/WorkspaceKeys';
import { KeyCode } from '@kit.InputKit';

export interface EditorSnapshot {
  documentKey: string;
  revision: number;
  text: string;
  from: number;
  to: number;
  bookmark?: string;
  continuation?: string;
}

export interface EditorImageData {
  mime: string;
  chunks: string[];
}

interface ImagePacket {
  documentKey: string;
  type: string;
  target?: EditorSnapshot;
  count?: number;
  mime?: string;
  data?: string;
}

interface EditorMessage extends EditorSnapshot {
  type: string;
  requestId: number;
  error?: string;
  command?: string;
}

interface EditorRequest {
  action: string;
  documentKey: string;
  requestId: number;
  date?: string;
  text?: string;
  resetHistory?: boolean;
  from?: number;
  to?: number;
  expectedRevision?: number;
  bookmark?: string;
  lease?: string;
  continuation?: string;
}

interface PendingEditorRequest {
  resolve: (snapshot: EditorSnapshot) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class SourceEditorSession {
  focused: boolean = false;
  controller: webview.WebviewController = new webview.WebviewController();
  private runtimeReady: boolean = false;
  onReadyChange: (ready: boolean) => void = () => {};

  get ready(): boolean { return this.runtimeReady; }
  set ready(value: boolean) {
    if (this.runtimeReady === value) return;
    this.runtimeReady = value;
    this.onReadyChange(value);
  }
  documentKey: string = '';
  loadedDocumentKey: string = '';
  onChange: (snapshot: EditorSnapshot) => void = () => {};
  onDirty: (key: string) => void = () => {};
  onCommand: (command: string) => void = () => {};
  onFailure: (message: string) => void = () => {};
  onImages: (target: EditorSnapshot, images: EditorImageData[]) => void = () => {};
  private imageTarget: EditorSnapshot | null = null;
  private imageFiles: EditorImageData[] = [];
  private imageCount: number = 0;
  private imageBytes: number = 0;
  private sequence: number = 0;
  private requests: Map<number, PendingEditorRequest> = new Map();

  message(raw: string): void {
    try {
      const event = JSON.parse(raw) as EditorMessage;
      if (event.type === 'result') {
        const pending = this.requests.get(event.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.requests.delete(event.requestId);
        if (event.error) pending.reject(new Error(event.error));
        else if (event.documentKey !== this.documentKey) pending.reject(new Error('编辑文档已变化'));
        else pending.resolve(event);
      } else if (event.type === 'failed') {
        this.ready = false;
        this.onFailure(event.error || '编辑器运行失败');
      } else if (event.documentKey === this.documentKey) {
        if (event.type === 'notice') this.onFailure(event.error || '图片插入失败');
        if (event.type === 'change') this.onChange(event);
        if (event.type === 'dirty') this.onDirty(event.documentKey);
        if (event.type === 'command') this.onCommand(event.command || '');
      }
    } catch (_) {
      this.onFailure('编辑器通信失败');
    }
  }

  imageChunk(raw: string): boolean {
    try {
      const packet = JSON.parse(raw) as ImagePacket;
      if (packet.documentKey !== this.documentKey) return false;
      if (packet.type === 'abort') { this.resetImages(); return true; }
      if (packet.type === 'begin') {
        if (this.imageTarget || !packet.target || !packet.count || packet.count > 5 ||
          packet.target.documentKey !== this.documentKey) return false;
        this.imageTarget = packet.target;
        this.imageCount = packet.count;
        return true;
      }
      if (!this.imageTarget) return false;
      if (packet.type === 'file') {
        if (!packet.mime || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(packet.mime) ||
          this.imageFiles.length >= this.imageCount) return false;
        this.imageFiles.push({ mime: packet.mime, chunks: [] });
      } else if (packet.type === 'chunk') {
        if (!packet.data || packet.data.length > 32768 || !this.imageFiles.length) return false;
        this.imageBytes += packet.data.length;
        if (this.imageBytes > 28 * 1024 * 1024) return false;
        this.imageFiles[this.imageFiles.length - 1].chunks.push(packet.data);
      } else if (packet.type === 'end') {
        if (this.imageFiles.length !== this.imageCount || this.imageFiles.some((file: EditorImageData) => !file.chunks.length)) return false;
        const target = this.imageTarget;
        const files = this.imageFiles;
        this.resetImages();
        this.onImages(target, files);
      } else return false;
      return true;
    } catch (_) { this.resetImages(); return false; }
  }

  private resetImages(): void {
    this.imageTarget = null;
    this.imageFiles = [];
    this.imageCount = 0;
    this.imageBytes = 0;
  }

  private request(request: EditorRequest): Promise<EditorSnapshot> {
    if (!this.ready) return Promise.reject(new Error('编辑器尚未就绪'));
    request.requestId = ++this.sequence;
    return new Promise<EditorSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(request.requestId);
        reject(new Error('编辑器没有响应，请完成输入后重试'));
      }, 12000);
      this.requests.set(request.requestId, { resolve: resolve, reject: reject, timer: timer });
      this.controller.runJavaScript(`window.editorRequest(${JSON.stringify(request)})`, (error) => {
        if (!error) return;
        const pending = this.requests.get(request.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.requests.delete(request.requestId);
        reject(new Error('编辑器通信失败'));
      });
    });
  }

  async load(key: string, date: string, text: string): Promise<EditorSnapshot> {
    this.resetImages();
    this.documentKey = key;
    this.loadedDocumentKey = '';
    const snapshot = await this.request({ action: 'load', documentKey: key, requestId: 0, date: date, text: text });
    if (this.documentKey === key) this.loadedDocumentKey = key;
    return snapshot;
  }

  command(action: string): Promise<EditorSnapshot> {
    return this.request({ action: action, documentKey: this.documentKey, requestId: 0 });
  }

  captureContinuation(lease: string): Promise<EditorSnapshot> {
    if (this.imageTarget) return Promise.reject(new Error('请先完成图片传输'));
    return this.request({ action: 'captureContinuation', documentKey: this.documentKey, requestId: 0, lease: lease });
  }

  resumeContinuation(lease: string): Promise<EditorSnapshot> {
    return this.request({ action: 'resumeContinuation', documentKey: this.documentKey, requestId: 0, lease: lease });
  }

  restoreContinuation(continuation: string, expectedRevision: number): Promise<EditorSnapshot> {
    if (this.imageTarget) return Promise.reject(new Error('请先完成图片传输'));
    return this.request({ action: 'restoreContinuation', documentKey: this.documentKey, requestId: 0,
      continuation: continuation, expectedRevision: expectedRevision });
  }

  replace(text: string, resetHistory: boolean = false): Promise<EditorSnapshot> {
    return this.request({ action: 'replace', documentKey: this.documentKey, requestId: 0,
      text: text, resetHistory: resetHistory });
  }

  insert(target: EditorSnapshot, text: string): Promise<EditorSnapshot> {
    if (target.documentKey !== this.documentKey) return Promise.reject(new Error('编辑文档已变化，请重新插入'));
    return this.request({ action: 'insert', documentKey: target.documentKey, requestId: 0,
      text: text, from: target.from, to: target.to, expectedRevision: target.revision, bookmark: target.bookmark });
  }

  async release(target: EditorSnapshot): Promise<void> {
    if (this.ready && target.documentKey === this.documentKey && target.bookmark) {
      await this.request({ action: 'release', documentKey: target.documentKey, requestId: 0, bookmark: target.bookmark });
    }
  }

  dispose(): void {
    this.focused = false;
    this.resetImages();
    this.ready = false;
    this.requests.forEach((pending: PendingEditorRequest) => {
      clearTimeout(pending.timer);
      pending.reject(new Error('编辑器已关闭'));
    });
    this.requests.clear();
  }
}

@Component
export struct SourceEditor {
  @StorageProp('pref_editorSize') @Watch('preferencesChanged') private editorSize: number = 14;
  @StorageProp('pref_editorWrap') @Watch('preferencesChanged') private editorWrap: boolean = true;
  session: SourceEditorSession = new SourceEditorSession();
  @Prop @Watch('documentChanged') documentKey: string = '';
  @Prop @Watch('documentChanged') initialText: string = '';
  @State private loaded: boolean = false;
  @State private error: string = '';
  private mouseContextMenu: boolean = false;
  private pendingLoad: number = -1;
  private loadRevision: number = 0;
  private disposed: boolean = false;

  aboutToAppear(): void { this.disposed = false; }

  private preferencesChanged(): void {
    if (this.session.ready) {
      this.session.controller.runJavaScript(`window.setEditorPreferences(${this.editorSize}, ${this.editorWrap})`);
    }
  }

  private documentChanged(): void {
    this.loadRevision += 1;
    if (this.pendingLoad >= 0) clearTimeout(this.pendingLoad);
    this.pendingLoad = setTimeout(() => {
      this.pendingLoad = -1;
      this.loadDocument();
    }, 0);
  }

  private async loadDocument(): Promise<void> {
    if (this.disposed || !this.session.ready || !this.documentKey) return;
    const revision = ++this.loadRevision;
    const key = this.documentKey;
    const text = this.initialText;
    this.error = '';
    try {
      await this.session.load(key, key.slice(0, 10), text);
      if (revision !== this.loadRevision || key !== this.documentKey || text !== this.initialText) return;
      this.loaded = true;
    } catch (error) {
      if (revision !== this.loadRevision || key !== this.documentKey || text !== this.initialText) return;
      this.error = error instanceof Error ? error.message : '编辑器加载失败';
      this.session.onFailure(this.error);
    }
  }

  aboutToDisappear(): void {
    this.disposed = true;
    this.loadRevision += 1;
    if (this.pendingLoad >= 0) clearTimeout(this.pendingLoad);
    this.pendingLoad = -1;
    this.session.dispose();
  }

  private editorMenu(items: TextMenuItem[]): TextMenuItem[] {
    if (!this.mouseContextMenu) return items;
    const result: TextMenuItem[] = [
      { id: TextMenuItemId.of('editor.undo'), content: '撤销', icon: $r('sys.symbol.undo'), labelInfo: 'Ctrl+Z' },
      { id: TextMenuItemId.of('editor.redo'), content: '重做', icon: $r('sys.symbol.redo'), labelInfo: 'Ctrl+Shift+Z' }
    ];
    for (const id of [TextMenuItemId.CUT, TextMenuItemId.COPY, TextMenuItemId.PASTE, TextMenuItemId.SELECT_ALL]) {
      const item = items.find((candidate: TextMenuItem) => candidate.id.equals(id));
      if (item) result.push(item);
    }
    return result;
  }

  private editorMenuAction(item: TextMenuItem): boolean {
    const action = item.id.equals(TextMenuItemId.of('editor.undo')) ? 'undo' :
      item.id.equals(TextMenuItemId.of('editor.redo')) ? 'redo' : '';
    if (!action) return false;
    this.session.command(action).catch((error: Error) => this.session.onFailure(error.message));
    return true;
  }

  build() {
    Stack() {
      Web({ src: $rawfile('editor/index.html'), controller: this.session.controller, renderMode: RenderMode.SYNC_RENDER })
        .id('log_source_editor')
        .monopolizeEvents(true)
        .width('100%').height('100%').backgroundColor($r('app.color.surface_dark_soft'))
        .javaScriptAccess(true).domStorageAccess(false).onlineImageAccess(false)
        .enableDefaultContextMenu(true)
        .editMenuOptions({
          onCreateMenu: (items: TextMenuItem[]) => this.editorMenu(items),
          onMenuItemClick: (item: TextMenuItem) => this.editorMenuAction(item)
        })
        .javaScriptProxy({ object: this.session, name: 'editorBridge', methodList: ['message', 'imageChunk'], controller: this.session.controller })
        .onOverrideUrlLoading(() => true)
        .onFocus(() => this.session.focused = true)
        .onBlur(() => this.session.focused = false)
        .onTouch(() => this.mouseContextMenu = false)
        .onContextMenuShow((event) => {
          this.mouseContextMenu = !!event && event.param.getSourceType() === ContextMenuSourceType.Mouse && event.param.isEditable();
          return false;
        })
        // Keep workspace search available when the IME consumes Ctrl+Shift+F after text input.
        .onKeyPreIme((event: KeyEvent) => {
          if (!workspaceKey(event, KeyCode.KEYCODE_F, true, true)) return false;
          this.session.onCommand('globalSearch');
          return true;
        })
        .onKeyEvent((event: KeyEvent) => {
          let command = '';
          if (workspaceKey(event, KeyCode.KEYCODE_F1)) command = 'help';
          else if (workspaceKey(event, KeyCode.KEYCODE_F6)) command = 'focusNext';
          else if (workspaceKey(event, KeyCode.KEYCODE_F6, false, true)) command = 'focusPrevious';
          else if (workspaceKey(event, KeyCode.KEYCODE_F10)) command = 'menuFocus';
          else if (workspaceKey(event, KeyCode.KEYCODE_N, true, false, true)) command = 'newLog';
          else if (workspaceKey(event, KeyCode.KEYCODE_Q, true, false, true)) command = 'newQa';
          if (command) { this.session.onCommand(command); return true; }
          return textNavigationKey(event);
        })
        .onPageBegin(() => { this.loadRevision += 1; this.session.ready = false; this.loaded = false; })
        .onPageEnd(() => {
          if (this.disposed) return;
          this.session.ready = true;
          this.preferencesChanged();
          this.loadDocument();
        })
      if (!this.loaded || this.error) {
        Column({ space: 12 }) {
          if (this.error) {
            Text(this.error).fontColor($r('app.color.on_dark_soft')).fontSize(13)
            Button('重试').onClick(() => this.loadDocument())
          } else {
            LoadingProgress().width(24).height(24).color($r('app.color.primary'))
          }
        }.width('100%').height('100%').justifyContent(FlexAlign.Center)
          .backgroundColor($r('app.color.surface_dark_soft'))
      }
    }.width('100%').height('100%')
  }
}
