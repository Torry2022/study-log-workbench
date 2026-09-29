import { ApiClient, ApiError } from '../../common/network/ApiClient';

interface AiTextResult { content: string; warnings: string[]; }
interface GeneratedLogResponse { result: AiTextResult; }
interface HighlightResponse { result: AiTextResult; }
interface GenerateRequest { date: string; material: string; instruction: string; }
interface HighlightRequest { date: string; content: string; }

@Observed
export class LogAiController {
  mode: string = 'generate';
  instruction: string = '';
  material: string = '';
  output: string = '';
  outputDate: string = '';
  originalDraft: string = '';
  highlighted: string = '';
  highlightDate: string = '';
  reviewOpen: boolean = false;
  busy: boolean = false;
  importing: boolean = false;
  message: string = '';
  private revision: number = 0;
  private transport: ApiClient;

  constructor(transport: ApiClient) { this.transport = transport; }

  get requestRevision(): number { return this.revision; }

  dispose(): void { this.revision++; this.busy = false; this.importing = false; this.reviewOpen = false; }

  async generate(date: string): Promise<void> {
    if (!date || this.busy || (!this.instruction.trim() && !this.material.trim())) return;
    const revision = ++this.revision;
    this.busy = true; this.message = ''; this.output = ''; this.outputDate = '';
    try {
      const request: GenerateRequest = { date, material: this.material, instruction: this.instruction };
      const response = await this.transport.post<GeneratedLogResponse>('/ai/generate', request);
      if (revision !== this.revision) return;
      if (!response.result || typeof response.result.content !== 'string') throw new Error('生成响应格式异常');
      this.output = response.result.content;
      this.outputDate = date;
      this.message = (response.result.warnings || []).join('\n');
    } catch (error) {
      if (revision === this.revision) this.message = error instanceof ApiError ? error.message :
        error instanceof Error ? error.message : 'AI 草稿生成失败';
    } finally { if (revision === this.revision) this.busy = false; }
  }

  async highlight(date: string, body: string): Promise<void> {
    if (!date || !body.trim() || this.busy) return;
    const revision = ++this.revision;
    this.busy = true; this.message = '';
    try {
      const content = `## ${date}\n\n${body.trim()}\n`;
      const request: HighlightRequest = { date, content };
      const response = await this.transport.post<HighlightResponse>('/ai/bold-highlights', request);
      if (revision !== this.revision) return;
      if (!response.result || typeof response.result.content !== 'string') throw new Error('标注响应格式异常');
      this.originalDraft = body;
      this.highlighted = response.result.content.replace(/^##\s+\d{4}-\d{2}-\d{2}[^\S\r\n]*\r?\n/, '')
        .replace(/^\r?\n+/, '').trimEnd();
      this.highlightDate = date;
      this.message = (response.result.warnings || []).join('\n');
      this.reviewOpen = true;
    } catch (error) {
      if (revision === this.revision) this.message = error instanceof ApiError ? error.message :
        error instanceof Error ? error.message : '重点标注失败';
    } finally { if (revision === this.revision) this.busy = false; }
  }
}
