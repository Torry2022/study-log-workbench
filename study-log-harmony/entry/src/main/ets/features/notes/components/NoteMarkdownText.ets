import { common } from '@kit.AbilityKit';
import { noteSpans, NoteSpan } from '../NoteInlineMarkdown';
import { appFeedback } from '../../../common/ui/AppFeedback';
import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { workspaceCodeFamily, workspaceSansFamily } from '../../../common/ui/Typography';
import { NoteImage } from './NoteImage';

interface NoteContentPart { text: string; source: string; alt: string; }

@Component
export struct NoteMarkdownText {
  @StorageProp('pref_readingScale') private readingScale: number = 1;
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @Prop @Watch('parse') content: string = '';
  @Prop lineHeight: number = 25;
  onInternalLink: (date: string, heading: string) => void = () => {};
  @State private parts: NoteContentPart[] = [];

  aboutToAppear(): void { this.parse(); }
  private parse(): void {
    const parts: NoteContentPart[] = [];
    // Consume escapes and code before recognizing image markup.
    const pattern = /\\[\s\S]|(`+)[\s\S]*?\1|!\[([^\]]*)\]\(([^\s)]+)\)/g;
    let offset = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(this.content)) !== null) {
      if (!match[3]) continue;
      if (match.index > offset) parts.push({ text: this.content.slice(offset, match.index), source: '', alt: '' });
      parts.push({ text: '', source: match[3], alt: match[2] });
      offset = match.index + match[0].length;
    }
    if (offset < this.content.length) parts.push({ text: this.content.slice(offset), source: '', alt: '' });
    this.parts = parts;
  }

  private open(link: string): void {
    const internal = link.match(/^study-log:\/\/wikilink\?date=([^&]+)&heading=(.*)$/);
    if (internal) { this.onInternalLink(internal[1], decodeURIComponent(internal[2])); return; }
    if (!/^https?:\/\//i.test(link)) return;
    AlertDialog.show({
      message: `即将使用系统浏览器打开：\n${link}`,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '打开', action: async () => {
        try {
          const host = this.getUIContext().getHostContext() as common.UIAbilityContext;
          await host.startAbility({ action: 'ohos.want.action.viewData', uri: link });
        } catch (_) { appFeedback.show('无法打开系统浏览器', 'error'); }
      } }
    });
  }

  @Builder
  private textPart(content: string) {
    Text() {
      ForEach(noteSpans(content), (span: NoteSpan) => {
        Span(span.text)
          .fontWeight(span.bold ? FontWeight.Bold : FontWeight.Normal)
          .fontStyle(span.italic ? FontStyle.Italic : FontStyle.Normal)
          .fontFamily(span.code ? workspaceCodeFamily(this.breakpoint) : workspaceSansFamily(this.breakpoint))
          .fontColor(span.link || span.code ? $r('app.color.primary_active') : $r('app.color.body'))
          .decoration({ type: span.link ? TextDecorationType.Underline :
            span.strike ? TextDecorationType.LineThrough : TextDecorationType.None })
          .onClick(span.link ? () => this.open(span.link) : undefined)
      })
    }.fontSize(15 * this.readingScale).lineHeight(this.lineHeight * this.readingScale).width('100%')
      .copyOption(CopyOptions.LocalDevice)
  }

  build() {
    Column({ space: 8 }) {
      ForEach(this.parts, (part: NoteContentPart) => {
        if (part.source) { NoteImage({ source: part.source, alt: part.alt }) }
        else { this.textPart(part.text) }
      })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
