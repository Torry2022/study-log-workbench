import { ApiClient, ApiError } from '../../common/network/ApiClient';
import { InstanceCapabilities } from '../../common/network/InstanceConfig';

interface AiTextResult { content: string; warnings: string[]; }
interface GeneratedLogResponse { result: AiTextResult; }
interface HighlightResponse { result: AiTextResult; }
interface GenerateRequest { date: string; material: string; instruction: string; presetId?: string; }
export interface GenerationPreset { id: string; name: string; prompt: string; readOnly: boolean; issue?: string; }
interface GenerationPresetsResponse { version: string; defaultPresetId: string; presets: GenerationPreset[]; }
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
  presets: GenerationPreset[] = [];
  presetId: string = 'legacy';
  presetsLoading: boolean = false;
  presetsLoaded: boolean = false;
  presetError: string = '';
  private presetsRevision: number = 0;
  private revision: number = 0;
  private transport: ApiClient;

  constructor(transport: ApiClient) { this.transport = transport; }

  get requestRevision(): number { return this.revision; }

  generationConfigured(capabilities?: InstanceCapabilities): boolean {
    if (!capabilities?.features.aiWriting.supported) return false;
    if (this.presetId === 'legacy') return capabilities.features.aiWriting.configured;
    return capabilities.aiConfiguration?.provider.configured ?? capabilities.features.aiWriting.configured;
  }

  dispose(): void {
    this.revision++; this.presetsRevision++;
    this.busy = false; this.importing = false; this.reviewOpen = false;
    this.presets = []; this.presetId = 'legacy'; this.presetsLoaded = false;
    this.presetsLoading = false; this.presetError = '';
  }

  async loadPresets(): Promise<void> {
    if (this.presetsLoading || this.busy) return;
    const revision = ++this.presetsRevision;
    this.presetsLoading = true; this.presetError = '';
    try {
      const response = await this.transport.get<GenerationPresetsResponse>('/ai/generation-presets');
      if (revision !== this.presetsRevision) return;
      if (!response || !Array.isArray(response.presets) || !response.presets.length ||
        !response.presets.every((item: GenerationPreset) => typeof item.id === 'string' && typeof item.name === 'string') ||
        !response.presets.some((item: GenerationPreset) => item.id === response.defaultPresetId)) {
        throw new Error('写作方案响应格式异常');
      }
      const selected = this.presetsLoaded ? this.presetId : response.defaultPresetId;
      this.presets = response.presets;
      this.presetId = response.presets.some((item: GenerationPreset) => item.id === selected) ? selected : response.defaultPresetId;
      this.presetsLoaded = true;
    } catch (error) {
      if (revision !== this.presetsRevision) return;
      if (error instanceof ApiError && error.statusCode === 404) {
        // Older servers retain their existing generation.md contract.
        this.presets = []; this.presetId = 'legacy'; this.presetsLoaded = true;
      } else {
        this.presetError = error instanceof Error ? error.message : '写作方案读取失败，请重试';
      }
    } finally { if (revision === this.presetsRevision) this.presetsLoading = false; }
  }

  async generate(date: string): Promise<void> {
    if (!date || this.busy || this.presetsLoading || this.presetError || (!this.instruction.trim() && !this.material.trim())) return;
    const revision = ++this.revision;
    this.busy = true; this.message = ''; this.output = ''; this.outputDate = '';
    try {
      const request: GenerateRequest = { date, material: this.material, instruction: this.instruction };
      if (this.presetId !== 'legacy') request.presetId = this.presetId;
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
