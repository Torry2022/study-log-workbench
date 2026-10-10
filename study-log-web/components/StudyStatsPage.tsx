"use client";

import { BarChart3, CalendarDays, FileText, Tags } from "lucide-react";
import { StatsOverview } from "./stats/StatsOverview";
import { TaxonomyManager } from "./stats/TaxonomyManager";
import { WorkspaceState } from "./WorkspaceState";
import type { StatsController } from "@/hooks/use-stats";
import type { StatsEntry } from "@/lib/stats-types";
import "@/app/stats.css";

interface Props {
  onOpenLog?: () => void;
  stats: StatsController;
  onOpenEntry?: (entry: StatsEntry) => void | Promise<boolean>;
}

export function StatsNavigation({ stats, onNavigate, filtersOnly = false }: { stats: StatsController; onNavigate?: () => void; filtersOnly?: boolean }) {
  return <div className="stats-sidebar-content">
    <div className="section-title inline"><CalendarDays size={15} />统计月份</div>
    <div className="month-list">{stats.months.map(month => <button type="button" key={month.id}
      className={stats.selectedMonth === month.id ? "nav-item active" : "nav-item"}
      onClick={async () => { if (await stats.changeMonth(month.id)) onNavigate?.(); }}><span>{month.label}</span><small>{month.dayCount}</small></button>)}</div>
    {!stats.initialLoading && !stats.loading && !stats.statsError && !stats.taxonomyError && !stats.months.length && <WorkspaceState kind="empty" title="暂无月份记录" layout="compact" />}
    {!filtersOnly && <button className="button secondary full" type="button" onClick={() => { stats.showManager(); onNavigate?.(); }}><Tags size={15} />分类管理</button>}
  </div>;
}

export function StudyStatsPage({ stats, onOpenEntry, onOpenLog }: Props) {
  const monthOptions = stats.months.some(month => month.id === stats.selectedMonth) ? stats.months :
    [...stats.months, { id: stats.selectedMonth, label: stats.selectedMonth, dayCount: 0, firstDate: null, lastDate: null }].filter(month => month.id);
  return <>
    <div className="reader-toolbar-container"><div className="reader-toolbar reader-toolbar-stats">
      <div className="module-title-block"><div className="reader-heading-row"><h2>学习统计</h2></div></div>
      <div className="reader-controls">{onOpenLog && <button className="button secondary" type="button" onClick={onOpenLog}><FileText size={15} />日志</button>}</div>
    </div></div>
    <div className="stats-shell stats-shell-embedded" inert={!stats.active}>
    <section className="stats-workspace stats-workspace-embedded stats-workspace-v2">
      {stats.taxonomyError && <div className="stats-feedback error" role="alert"><span>{stats.taxonomyError}</span>
        <button type="button" className="button secondary" disabled={stats.busy || stats.initialLoading} onClick={() => void stats.reloadTaxonomy()}>重新读取分类</button>
      </div>}
      {stats.feedback && <div className="stats-feedback" role="status"><span>{stats.feedback}</span><button type="button" className="button secondary" onClick={stats.dismissFeedback}>关闭</button></div>}
      {stats.view === "overview" ? <>
        {stats.loading || (!stats.monthlyStats && !stats.statsError && !stats.taxonomyError) ? <WorkspaceState kind="loading" title="正在加载统计数据" className="stats-empty" /> : stats.statsError ?
          <WorkspaceState kind="error" title={stats.statsError} className="stats-empty" actions={<button type="button" className="button secondary" onClick={stats.refreshStats}>重试</button>} /> :
          !stats.monthlyStats ? <WorkspaceState kind="error" title="暂时无法读取统计数据" className="stats-empty" actions={<button type="button" className="button secondary" onClick={() => void stats.reloadTaxonomy()}>重试</button>} /> :
          !stats.months.length ? <WorkspaceState kind="empty" icon={BarChart3} title="暂无统计数据" description="保存日志后，按日期统计记录天数，按三级标题统计小节与主题。数量不代表掌握程度；无需配置模型即可查看基础统计。" layout="module" actions={onOpenLog ? <button className="button secondary" type="button" onClick={onOpenLog}><FileText size={15} />前往日志</button> : undefined} /> : <StatsOverview key={stats.selectedMonth} months={monthOptions} selectedMonth={stats.selectedMonth} stats={stats.monthlyStats}
            classificationReady={stats.monthlyStats.classificationReady !== false}
            busy={stats.busy || stats.loading} onMonthChange={month => void stats.changeMonth(month)} onRefresh={stats.refreshStats}
            onOpenManager={stats.showManager} onOpenEntry={entry => { void onOpenEntry?.(entry); }} />}
      </> : <>
        {stats.dirty && <p className="stats-draft-status" role="status">分类有未保存修改</p>}
        <TaxonomyManager taxonomy={stats.taxonomy} savedTaxonomy={stats.savedTaxonomy} catalog={stats.catalog}
          ai={stats.ai}
          busy={stats.busy || stats.initialLoading} onBack={() => void stats.showOverview()} onTaxonomyChange={stats.setTaxonomy}
          onSave={() => void stats.saveTaxonomy()} onReload={() => void stats.reloadTaxonomy()} onConfirmRemoveDomain={stats.confirmRemoveDomain} />
      </>}
    </section>
  </div></>;
}
