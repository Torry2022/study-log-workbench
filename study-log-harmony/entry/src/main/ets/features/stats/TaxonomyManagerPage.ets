import { appFeedback, FeedbackTone } from '../../common/ui/AppFeedback';
import { AppDropdown, SearchField } from '../../common/ui/FormControls';
import { EmptyState, InlineStatus, LoadFailure } from '../../common/ui/FeedbackStates';
import { apiClient } from '../../common/network/ApiClient';
import { activeInstance } from '../../common/network/InstanceConfig';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { workspaceSerifFamily } from '../../common/ui/Typography';
import { TaxonomyCatalogItem, TaxonomySuggestion } from './TaxonomyModels';
import { TaxonomyController } from './TaxonomyController';
import { taxonomyDraftStore } from './TaxonomyDraftStore';

@Component
export struct TaxonomyManagerPage {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  onBack: () => void = () => {};
  onSaved: () => void = () => {};
  onStateChange: (dirty: boolean, busy: boolean) => void = () => {};
  private alive: boolean = false;
  private draftNamespace: string = '';
  @State private data: TaxonomyController = new TaxonomyController(apiClient, () => this.reportState());
  @State private query: string = '';
  @State private monthFilter: string = 'all';
  @State private domainFilter: string = 'all';
  @State private statusFilter: string = 'all';
  @State private domainDraft: string = '';
  aboutToAppear(): void {
    this.alive = true;
    this.draftNamespace = activeInstance.namespace;
    this.data.load().then((loaded: boolean) => {
      if (!loaded || !this.alive || activeInstance.namespace !== this.draftNamespace) return;
      const draft = taxonomyDraftStore.load(this.draftNamespace);
      if (draft) { this.data.restoreDraft(draft); this.domainDraft = draft.domainDraft; this.reportState(); }
    });
  }
  aboutToDisappear(): void {
    if (!apiClient.getToken() && this.draftNamespace && activeInstance.namespace === this.draftNamespace &&
      (this.data.hasChanges() || this.data.hasPendingSuggestions() || this.domainDraft.trim().length > 0)) {
      try {
        taxonomyDraftStore.save({ namespace: this.draftNamespace, taxonomy: this.data.taxonomy,
          baseVersion: this.data.savedTaxonomy.version, domainDraft: this.domainDraft,
          suggestions: this.data.suggestions });
      } catch (_) { this.showToast('分类草稿暂存失败，请及时复制当前内容', 'error'); }
    }
    this.alive = false;
    this.data.dispose();
  }

  private reportState(): void {
    if (this.alive) this.onStateChange(this.data.hasChanges() || this.data.hasPendingSuggestions() ||
      this.domainDraft.trim().length > 0, this.data.busy || this.data.suggestionBusy);
  }

  private clearDraft(): void {
    try { taxonomyDraftStore.clear(this.draftNamespace); }
    catch (_) { this.showToast('本机分类草稿清理失败', 'error'); }
  }

  private requestBack(): void { this.onBack(); }

  private requestReload(): void {
    AlertDialog.show({ message: '重新读取将放弃当前分类修改，确定继续吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃并重新读取', fontColor: $r('app.color.error'), action: () => {
        if (!this.alive || this.data.busy) return;
        this.data.load().then((loaded: boolean) => {
          if (loaded && this.alive) {
            this.domainDraft = '';
            this.clearDraft();
            this.reportState();
          }
        });
      } }
    });
  }

  private currentDomain(item: TaxonomyCatalogItem): string {
    return this.data.taxonomy.mappings[item.tag] || '其他';
  }

  private suggestionFor(tag: string): TaxonomySuggestion | undefined {
    return this.data.suggestions.find((item: TaxonomySuggestion) => item.tag === tag);
  }

  private rowStatus(item: TaxonomyCatalogItem): string {
    if (this.suggestionFor(item.tag)) return 'suggested';
    if (this.data.taxonomy.mappings[item.tag] !== this.data.savedTaxonomy.mappings[item.tag]) return 'dirty';
    return this.data.taxonomy.mappings[item.tag] ? 'mapped' : 'unclassified';
  }

  private statusLabel(status: string): string {
    if (status === 'suggested') return 'AI 建议';
    if (status === 'dirty') return '待保存';
    if (status === 'mapped') return '显式映射';
    return '未分类';
  }

  private filterMonths(): string[] {
    const values: string[] = [];
    this.data.catalog.forEach((item: TaxonomyCatalogItem) => {
      item.months.forEach((month: string) => {
        if (!values.includes(month)) values.push(month);
      });
    });
    return values.sort().reverse();
  }

  private filteredItems(): TaxonomyCatalogItem[] {
    const keyword = this.query.trim().toLocaleLowerCase();
    return this.data.catalog.filter((item: TaxonomyCatalogItem) => {
      if (keyword && `${item.tag} ${item.sources.join(' ')}`.toLocaleLowerCase().indexOf(keyword) < 0) return false;
      if (this.monthFilter !== 'all' && !item.months.includes(this.monthFilter)) return false;
      if (this.domainFilter !== 'all' && this.currentDomain(item) !== this.domainFilter &&
        this.suggestionFor(item.tag)?.domain !== this.domainFilter) return false;
      if (this.statusFilter !== 'all' && this.rowStatus(item) !== this.statusFilter) return false;
      return true;
    });
  }

  private updateMapping(tag: string, domain: string): void { this.data.updateMapping(tag, domain); }

  private addDomain(): void {
    if (this.data.busy || this.data.loading) return;
    this.data.addDomain(this.domainDraft);
    this.domainDraft = '';
    this.reportState();
  }

  private removeDomain(domain: string): void {
    if (domain === '其他' || this.data.busy) return;
    AlertDialog.show({ message: `删除领域“${domain}”？使用该领域的映射将归入“其他”。`,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '删除', fontColor: $r('app.color.error'), action: () => {
        if (!this.alive) return;
        this.data.removeDomain(domain);
        if (this.domainFilter === domain) this.domainFilter = 'all';
      } }
    });
  }

  private async save(): Promise<void> {
    const saved = await this.data.save();
    if (!this.alive) return;
    if (saved) {
      this.clearDraft();
      this.onSaved(); this.showToast('领域映射已保存', 'success');
    }
  }

  private requestSuggestions(): void {
    if (!activeInstance.capabilities?.features.aiTaxonomy.configured) return;
    this.data.requestSuggestions(this.filteredItems());
  }

  private showToast(message: string, tone: FeedbackTone = 'info'): void {
    appFeedback.show(message, tone);
  }

  @Builder
  private domainChip(domain: string) {
    Row({ space: 5 }) {
      Text(domain).fontSize(11).fontColor($r('app.color.body')).maxLines(1)
      if (domain === '其他') {
        Text('内置').fontSize(8).fontColor($r('app.color.muted_soft'))
      } else {
        Button({ type: ButtonType.Normal, stateEffect: false }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(10).fontColor([$r('app.color.muted')])
        }
        .width(18).height(18).padding(0).borderRadius(9).backgroundColor(Color.Transparent)
        .accessibilityText(`删除领域 ${domain}`).onClick(() => this.removeDomain(domain))
      }
    }
    .height(30).padding({ left: 10, right: 8 })
    .backgroundColor($r('app.color.canvas'))
    .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(15)
  }

  @Builder
  private catalogCard(item: TaxonomyCatalogItem) {
    Column({ space: 9 }) {
      Row() {
        Text(item.tag).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
          .maxLines(2).layoutWeight(1)
        Text(`${item.count} 次`).fontSize(11).fontColor($r('app.color.muted'))
      }.width('100%')
      if (item.sources.length > 0) {
        Text(item.sources.join(' / ')).width('100%').fontSize(11).lineHeight(17).fontColor($r('app.color.muted'))
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      Row({ space: 8 }) {
        Text(this.statusLabel(this.rowStatus(item)))
          .fontSize(10).fontColor($r('app.color.body'))
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .backgroundColor(['dirty', 'unclassified'].includes(this.rowStatus(item)) ?
            $r('app.color.primary_tint') : $r('app.color.surface_soft'))
          .borderRadius(12)
        Text(item.months.slice(0, 3).join('、')).fontSize(10).fontColor($r('app.color.muted'))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1).textAlign(TextAlign.End)
      }.width('100%')
      AppDropdown({
        options: this.data.taxonomy.domains,
        selectedIndex: Math.max(0, this.data.taxonomy.domains.indexOf(this.currentDomain(item))),
        value: this.currentDomain(item),
        icon: $r('app.media.settings_2'),
        accessibilityLabel: `设置 ${item.tag} 的领域`,
        onSelect: (_index: number, value: string) => this.updateMapping(item.tag, value)
      }).width('100%').height(38)
      if (this.suggestionFor(item.tag)) {
        Row({ space: 8 }) {
          Checkbox({ name: item.tag, group: 'taxonomy_suggestions' })
            .select(!!this.suggestionFor(item.tag)?.selected)
            .onChange((selected: boolean) => this.data.updateSuggestion(item.tag,
              this.suggestionFor(item.tag)?.domain || '其他', selected))
          Text('建议领域').fontSize(11).fontColor($r('app.color.muted'))
          AppDropdown({
            options: this.data.taxonomy.domains,
            selectedIndex: Math.max(0, this.data.taxonomy.domains.indexOf(this.suggestionFor(item.tag)?.domain || '其他')),
            value: this.suggestionFor(item.tag)?.domain || '其他',
            icon: $r('app.media.settings_2'),
            accessibilityLabel: `审核 ${item.tag} 的建议领域`,
            onSelect: (_index: number, value: string) => this.data.updateSuggestion(item.tag, value,
              !!this.suggestionFor(item.tag)?.selected)
          }).layoutWeight(1).height(38)
        }.width('100%')
      }
    }
    .width('100%').padding(14).alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.canvas'))
    .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(10)
  }

  build() {
    Column() {
      Row({ space: 8 }) {
        Button({ type: ButtonType.Normal, stateEffect: false }) {
          SymbolGlyph($r('sys.symbol.chevron_backward')).fontSize(18).fontColor([$r('app.color.ink')])
        }
        .width(38).height(38).padding(0).backgroundColor($r('app.color.surface_soft'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
        .accessibilityText('返回月度复盘').onClick(() => this.requestBack())
        Column({ space: 2 }) {
          Text('分类管理').fontFamily(workspaceSerifFamily(this.workspaceBreakpoint)).fontSize(24)
            .fontColor($r('app.color.ink'))
          Text('统一维护全部历史小标签的领域口径').fontSize(11).fontColor($r('app.color.muted'))
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Button(this.data.busy ? '保存中' : '保存映射', { type: ButtonType.Normal })
          .height(38).padding({ left: 12, right: 12 }).fontSize(12).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.on_primary')).backgroundColor($r('app.color.primary'))
          .borderRadius(8).id('taxonomy_save').enabled(!this.data.busy && !this.data.suggestionBusy &&
            !this.data.hasPendingSuggestions() && !this.data.loading && !this.data.loadFailed &&
            !this.data.conflict && this.data.hasChanges()).onClick(() => this.save())
      }
      .width('100%').height(62).padding({ left: 10, right: 12 })
      .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })

      Scroll() {
        Column({ space: 14 }) {
          InlineStatus({ text: this.data.loadFailed ? '' : this.data.errorMessage, error: true,
            retry: this.data.conflict, onRetry: () => this.requestReload(), retryLabel: '重新读取' })
          if (this.data.loading) {
            Column({ space: 10 }) {
              LoadingProgress().width(28).height(28).color($r('app.color.primary'))
              Text('正在读取分类数据').fontSize(12).fontColor($r('app.color.muted'))
            }.width('100%').height(220).justifyContent(FlexAlign.Center)
          } else if (this.data.loadFailed) {
            Column() {
              LoadFailure({ title: '分类数据读取失败', message: this.data.errorMessage, onRetry: () => this.data.load() })
            }.width('100%').height(360)
          } else {
            Column({ space: 10 }) {
              Row() {
                Column({ space: 2 }) {
                  Text('领域').fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
                  Text('自定义领域用于整理日志标签，“其他”为默认分类').fontSize(10).fontColor($r('app.color.muted'))
                }.alignItems(HorizontalAlign.Start).layoutWeight(1)
                Text(`${this.data.taxonomy.domains.length} 项`).fontSize(10).fontColor($r('app.color.muted_soft'))
              }.width('100%')
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.data.taxonomy.domains, (domain: string) => {
                  Row() { this.domainChip(domain) }.margin({ right: 7, bottom: 7 })
                }, (domain: string) => domain)
              }.width('100%')
              Row({ space: 8 }) {
                TextInput({ text: this.domainDraft, placeholder: '新增自定义领域' })
                  .layoutWeight(1).height(38).fontSize(13).backgroundColor($r('app.color.canvas'))
                  .monopolizeEvents(true)
                  .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
                  .id('taxonomy_domain_input').onChange((value: string) => { this.domainDraft = value; this.reportState(); }).onSubmit(() => this.addDomain())
                Button('添加', { type: ButtonType.Normal }).width(64).height(38).fontSize(12)
                  .fontColor($r('app.color.ink')).backgroundColor($r('app.color.canvas'))
                  .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
                  .enabled(this.domainDraft.trim().length > 0).onClick(() => this.addDomain())
              }.width('100%')
            }
            .width('100%').padding(12).alignItems(HorizontalAlign.Start)
            .backgroundColor($r('app.color.surface_card'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(10)

            Button({ type: ButtonType.Normal }) {
              Row({ space: 7 }) {
                if (this.data.suggestionBusy) LoadingProgress().width(16).height(16).color($r('app.color.ink'))
                else Image($r('app.media.wand_sparkles')).width(16).height(16).objectFit(ImageFit.Contain)
                Text(this.data.suggestionBusy ? '正在生成建议' : `AI 分类建议（${this.filteredItems().length}）`)
                  .fontSize(13).fontWeight(FontWeight.Medium)
              }
            }
            .width('100%').height(40).fontColor($r('app.color.ink')).backgroundColor($r('app.color.canvas'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
            .enabled(!!activeInstance.capabilities?.features.aiTaxonomy.configured && !this.data.suggestionBusy &&
              !this.data.busy && this.filteredItems().length > 0 && this.filteredItems().length <= 200 &&
              !this.data.hasChanges() && this.data.savedTaxonomy.domains.some((domain: string) => domain !== '其他'))
            .onClick(() => this.requestSuggestions()).id('taxonomy_suggest')
            if (this.data.suggestionMessage) {
              Text(this.data.suggestionMessage).fontSize(11).fontColor(this.data.suggestionError ?
                $r('app.color.error') : $r('app.color.muted'))
            }
            if (!activeInstance.capabilities?.features.aiTaxonomy.configured) {
              Text('尚未配置分类建议模型').fontSize(11).fontColor($r('app.color.muted'))
            } else if (!this.data.savedTaxonomy.domains.some((domain: string) => domain !== '其他')) {
              Text('请先添加并保存自定义领域').fontSize(11).fontColor($r('app.color.muted'))
            } else if (this.data.hasChanges()) {
              Text('请先保存当前分类修改').fontSize(11).fontColor($r('app.color.muted'))
            } else if (this.filteredItems().length > 200) {
              Text('请通过筛选将本次标签范围控制在 200 个以内').fontSize(11).fontColor($r('app.color.muted'))
            }
            if (this.data.hasPendingSuggestions()) {
              Row({ space: 8 }) {
                Text(`已选 ${this.data.suggestions.filter((item: TaxonomySuggestion) => item.selected).length} / ${this.data.suggestions.length} 条`)
                  .fontSize(11).fontColor($r('app.color.muted')).layoutWeight(1)
                Button('放弃建议').height(38).fontSize(12).backgroundColor($r('app.color.canvas'))
                  .fontColor($r('app.color.body')).onClick(() => this.data.discardSuggestions())
                Button('应用已选到草稿').height(38).fontSize(12).backgroundColor($r('app.color.primary'))
                  .fontColor($r('app.color.on_primary'))
                  .enabled(!this.data.suggestionBusy && this.data.suggestions.some((item: TaxonomySuggestion) => item.selected))
                  .onClick(() => this.data.applySuggestions()).id('taxonomy_apply_suggestions')
              }.width('100%')
            }

            Column({ space: 8 }) {
              SearchField({
                value: this.query,
                placeholder: '搜索标签或原始标题',
                showSubmit: false,
                onChange: (value: string) => this.query = value,
                onSubmit: () => {}
              })
              Row({ space: 8 }) {
                AppDropdown({
                  options: ['全部月份'].concat(this.filterMonths()),
                  selectedIndex: this.monthFilter === 'all' ? 0 : this.filterMonths().indexOf(this.monthFilter) + 1,
                  value: this.monthFilter === 'all' ? '全部月份' : this.monthFilter,
                  icon: $r('app.media.calendar_days'),
                  accessibilityLabel: '按月份筛选分类',
                  onSelect: (index: number, value: string) => this.monthFilter = index === 0 ? 'all' : value
                }).layoutWeight(1).height(38)
                AppDropdown({
                  options: ['全部领域'].concat(this.data.taxonomy.domains),
                  selectedIndex: this.domainFilter === 'all' ? 0 : this.data.taxonomy.domains.indexOf(this.domainFilter) + 1,
                  value: this.domainFilter === 'all' ? '全部领域' : this.domainFilter,
                  icon: $r('app.media.settings_2'),
                  accessibilityLabel: '按领域筛选分类',
                  onSelect: (index: number, value: string) => this.domainFilter = index === 0 ? 'all' : value
                }).layoutWeight(1).height(38)
              }.width('100%')
              Row({ space: 8 }) {
                AppDropdown({
                  options: ['全部状态', '显式映射', '未分类', 'AI 建议', '待保存'],
                  selectedIndex: ['all', 'mapped', 'unclassified', 'suggested', 'dirty'].indexOf(this.statusFilter),
                  value: this.statusFilter === 'all' ? '全部状态' : this.statusLabel(this.statusFilter),
                  icon: $r('app.media.sliders_horizontal'),
                  accessibilityLabel: '按状态筛选分类',
                  onSelect: (index: number) => {
                    this.statusFilter = ['all', 'mapped', 'unclassified', 'suggested', 'dirty'][index];
                  }
                }).layoutWeight(1).height(38)
                Text(`${this.filteredItems().length} / ${this.data.catalog.length}`)
                  .width(72).height(38).fontSize(11).fontColor($r('app.color.muted')).textAlign(TextAlign.Center)
              }.width('100%')
            }.width('100%')

            if (this.filteredItems().length === 0) {
              Column() {
                EmptyState({
                  symbol: $r('sys.symbol.magnifyingglass'),
                  title: '没有符合条件的小标签',
                  description: '调整筛选条件后再试'
                })
              }.width('100%').height(240)
            } else {
              Column({ space: 8 }) {
                ForEach(this.filteredItems(), (item: TaxonomyCatalogItem) => {
                  this.catalogCard(item)
                }, (item: TaxonomyCatalogItem) => `${item.tag}:${this.currentDomain(item)}:${this.rowStatus(item)}:${this.data.taxonomy.domains.join('|')}`)
              }.width('100%')
            }
          }
        }
        .enabled(!this.data.busy).width('100%').padding({ left: 14, right: 14, top: 12, bottom: 40 }).alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1).width('100%').align(Alignment.TopStart)
      .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring)
    }
    .width('100%').height('100%').backgroundColor($r('app.color.canvas'))
  }
}
