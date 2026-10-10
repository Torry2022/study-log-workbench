"use client";

import { CalendarDays, ChevronDown, RefreshCw, Settings2, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { WorkspaceState } from "../WorkspaceState";
import type { DomainCount, MonthlyStats, StatsEntry, TagCount } from "@/lib/stats-types";

type Drilldown =
  | { kind: "domain"; value: string }
  | { kind: "tag"; value: string }
  | { kind: "day"; value: string }
  | null;

type StatsOverviewProps = {
  months: Array<{ id: string; label: string; dayCount: number }>;
  selectedMonth: string;
  stats: MonthlyStats | null;
  busy: boolean;
  classificationReady: boolean;
  onMonthChange: (month: string) => void;
  onRefresh: () => void;
  onOpenManager: () => void;
  onOpenEntry: (entry: StatsEntry) => void;
};

const CHART_COLORS = [
  "var(--primary)",
  "var(--accent-teal)",
  "var(--warning)",
  "color-mix(in srgb, var(--primary) 62%, var(--accent-teal))",
  "color-mix(in srgb, var(--warning) 70%, var(--primary))",
  "color-mix(in srgb, var(--accent-teal) 68%, var(--ink))",
  "color-mix(in srgb, var(--muted) 72%, var(--surface-strong))",
  "color-mix(in srgb, var(--primary) 42%, var(--surface-strong))",
  "color-mix(in srgb, var(--accent-teal) 38%, var(--surface-strong))",
  "var(--surface-strong)"
];

function polarToCartesian(radius: number, angleInDegrees: number) {
  const angle = ((angleInDegrees - 90) * Math.PI) / 180;
  return { x: 60 + radius * Math.cos(angle), y: 60 + radius * Math.sin(angle) };
}

function describeArc(startPercent: number, endPercent: number): string {
  const startAngle = startPercent * 3.6;
  const endAngle = endPercent * 3.6;
  const start = polarToCartesian(40, startAngle);
  const end = polarToCartesian(40, endAngle);
  return `M ${start.x} ${start.y} A 40 40 0 ${endAngle - startAngle > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
}

function deltaLabel(value: number, suffix = ""): string {
  if (value === 0) return "与上月持平";
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function Delta({ value, suffix = "" }: { value: number; suffix?: string }) {
  return (
    <span className={value > 0 ? "stats-delta positive" : value < 0 ? "stats-delta negative" : "stats-delta"}>
      {value > 0 ? <TrendingUp size={12} /> : value < 0 ? <TrendingDown size={12} /> : null}
      {deltaLabel(value, suffix)}
    </span>
  );
}

function buildCalendar(month: string, stats: MonthlyStats | null) {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const firstWeekday = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const byDate = new Map((stats?.days || []).map((item) => [item.date, item]));
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = `${month}-${String(day).padStart(2, "0")}`;
      return { day, date, activity: byDate.get(date) || null };
    })
  ];
}

export function StatsOverview({
  months,
  selectedMonth,
  stats,
  busy,
  classificationReady,
  onMonthChange,
  onRefresh,
  onOpenManager,
  onOpenEntry
}: StatsOverviewProps) {
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<Drilldown>(null);
  const segments = useMemo(() => {
    let cursor = 0;
    return (stats?.domainCounts || []).map((item, index) => {
      const start = cursor;
      const size = stats && stats.topicCount > 0 ? (item.count / stats.topicCount) * 100 : 0;
      const end = index === (stats?.domainCounts.length || 0) - 1 ? 100 : start + size;
      cursor = end;
      return { ...item, start, end, color: CHART_COLORS[index % CHART_COLORS.length] };
    });
  }, [stats]);
  const activeSegment = segments.find((item) => item.domain === activeDomain) || null;
  const maxTagCount = Math.max(...(stats?.topTags.map((item) => item.count) || [1]), 1);
  const calendar = useMemo(() => buildCalendar(selectedMonth, stats), [selectedMonth, stats]);
  const maxDayTopics = Math.max(...(stats?.days.map((day) => day.topicCount) || [1]), 1);
  const activeDomains = stats?.domainCounts.filter((item) => item.domain !== "其他").length || 0;
  const previousActiveDomains = stats?.comparison?.activeDomains || 0;

  const drillEntries = useMemo(() => {
    if (!stats || !drilldown) return [];
    if (drilldown.kind === "domain") return stats.entries.filter((entry) => entry.domain === drilldown.value);
    if (drilldown.kind === "tag") return stats.entries.filter((entry) => entry.tag === drilldown.value);
    return stats.entries.filter((entry) => entry.date === drilldown.value);
  }, [drilldown, stats]);

  const drillTitle = drilldown
    ? drilldown.kind === "day"
      ? drilldown.value
      : drilldown.value
    : "";

  function chooseDomain(item: DomainCount) {
    setActiveDomain(item.domain);
    setDrilldown({ kind: "domain", value: item.domain });
  }

  function chooseTag(item: TagCount) {
    setDrilldown({ kind: "tag", value: item.tag });
  }

  const drilldownContent = drilldown ? (
    <>
      <div className="stats-section-heading">
        <div><h3>{drillTitle}</h3><p>{drillEntries.length} 个日志小节，点击查看原文。</p></div>
        <button className="button secondary compact" onClick={() => setDrilldown(null)}>关闭</button>
      </div>
      <div className="stats-drilldown-list">
        {drillEntries.map((entry) => (
          <button key={`${entry.date}-${entry.headingIndex}-${entry.rawHeading}`} type="button" onClick={() => onOpenEntry(entry)}>
            <time>{entry.date}</time><strong>{entry.headingText}</strong><span>{entry.domain}</span>
          </button>
        ))}
        {!drillEntries.length && <WorkspaceState kind="empty" title="当天暂无可统计的小节" layout="compact" className="stats-empty compact" />}
      </div>
    </>
  ) : null;

  return (
    <div className="stats-overview">
      <div className="stats-review-toolbar">
        <div>
          <h2>{selectedMonth || "月度复盘"}</h2>
          <p>按记录天数与日志小节回看本月学习结构。</p>
        </div>
        <div className="stats-review-actions">
          <label className="stats-month-select">
            <CalendarDays size={15} />
            <select value={selectedMonth} onChange={(event) => onMonthChange(event.target.value)} aria-label="选择统计月份">
              {months.map((month) => (
                <option key={month.id} value={month.id}>{month.label} · {month.dayCount} 天</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <button className="button secondary" onClick={onRefresh} disabled={busy || !selectedMonth}>
            <RefreshCw size={15} />刷新
          </button>
          <button className="button secondary" onClick={onOpenManager}>
            <Settings2 size={15} />分类管理
          </button>
        </div>
      </div>

      <section className="stats-metric-strip" aria-label="月度复盘摘要">
        <div><span>记录天数</span><strong>{stats?.dayCount || 0}</strong>{stats?.comparison ? <Delta value={(stats?.dayCount || 0) - stats.comparison.dayCount} suffix=" 天" /> : <small>暂无上月数据</small>}</div>
        <div><span>日志小节</span><strong>{stats?.topicCount || 0}</strong>{stats?.comparison && <Delta value={(stats?.topicCount || 0) - stats.comparison.topicCount} suffix=" 个" />}<small>按三级标题计数</small></div>
        <div><span>活跃领域</span><strong>{classificationReady ? activeDomains : "—"}</strong>{classificationReady && stats?.comparison ? <Delta value={activeDomains - previousActiveDomains} /> : <small>{classificationReady ? "不含“其他”" : "尚未整理领域"}</small>}</div>
        <div><span>未分类标签</span><strong>{classificationReady ? stats?.unclassifiedTags.length || 0 : "—"}</strong><small>{!classificationReady ? "分类为可选整理" : stats?.unclassifiedTags.length ? "有新主题可整理" : "已有主题均已分类"}</small></div>
      </section>

      <section className="stats-section stats-heatmap-section">
        <div className="stats-section-heading">
          <div><h3>学习日历</h3><p>颜色深浅表示当日日志小节数量；点击日期查看小节。</p></div>
          <span>含小节 {stats?.technicalDayCount || 0} 天</span>
        </div>
        <div className="stats-calendar-scroll" role="region" aria-label="学习日历" tabIndex={0}>
        <div className="stats-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="stats-calendar-grid">
          {calendar.map((item, index) => item ? (
            <button
              key={item.date}
              type="button"
              className={drilldown?.kind === "day" && drilldown.value === item.date ? "stats-calendar-day active" : "stats-calendar-day"}
              data-recorded={item.activity ? "true" : "false"}
              data-level={item.activity ? Math.max(1, Math.ceil((item.activity.topicCount / maxDayTopics) * 4)) : 0}
              title={`${item.date}${item.activity ? `：${item.activity.topicCount} 个日志小节` : "：无日志"}`}
              onClick={() => item.activity && setDrilldown({ kind: "day", value: item.date })}
              disabled={!item.activity}
            >
              <span>{item.day}</span>
              {item.activity && <small>{item.activity.topicCount}</small>}
            </button>
          ) : <span className="stats-calendar-spacer" key={`space-${index}`} />)}
        </div>
        </div>
        {drilldown?.kind === "day" && (
          <div className="stats-calendar-drilldown">
            {drilldownContent}
          </div>
        )}
      </section>

      <div className="stats-analysis-grid">
        <section className="stats-section stats-domain-section">
          <div className="stats-section-heading"><div><h3>领域占比</h3><p>按日志小节数量计算，点击扇区查看明细。</p></div></div>
          {!classificationReady ? <WorkspaceState kind="empty" title="尚未整理学习领域" description="配置模型后，可在分类管理中让 AI 整理领域；其他统计无需分类即可查看。" layout="compact" className="stats-empty compact" /> : stats?.topicCount ? (
            <div className="stats-donut-layout">
              <figure className="stats-donut" onMouseLeave={() => setActiveDomain(null)}>
                <svg viewBox="0 0 120 120" role="group" aria-label={`${selectedMonth} 领域占比`}>
                  <circle className="stats-donut-track" cx="60" cy="60" r="40" />
                  {segments.map((item) => item.end - item.start >= 99.99 ? (
                    <circle key={item.domain} className="stats-donut-segment" cx="60" cy="60" r="40" stroke={item.color} role="button" tabIndex={0} aria-label={`${item.domain}：${item.count}个，${item.percentage}%`} onFocus={() => setActiveDomain(item.domain)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseDomain(item); } }} onMouseEnter={() => setActiveDomain(item.domain)} onClick={() => chooseDomain(item)} />
                  ) : (
                    <path key={item.domain} className="stats-donut-segment" d={describeArc(item.start, item.end)} stroke={item.color} role="button" tabIndex={0} aria-label={`${item.domain}：${item.count}个，${item.percentage}%`} onFocus={() => setActiveDomain(item.domain)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseDomain(item); } }} onMouseEnter={() => setActiveDomain(item.domain)} onClick={() => chooseDomain(item)} />
                  ))}
                </svg>
                <div className="stats-donut-center"><strong>{stats.topicCount}</strong><span>日志小节</span></div>
                {activeSegment && <div className="stats-donut-tooltip"><i style={{ background: activeSegment.color }} /><strong>{activeSegment.domain}</strong><span>{activeSegment.count} 个 · {activeSegment.percentage}% · {activeSegment.activeDays} 天</span></div>}
              </figure>
            </div>
          ) : <WorkspaceState kind="empty" title="本月暂无可统计的小节" description={stats?.dayCount ? "普通段落会计入记录天数，三级标题会计入小节数量。" : undefined} layout="compact" className="stats-empty compact" />}
        </section>

        <section className="stats-section stats-ranking-section">
          <div className="stats-section-heading"><div><h3>高频标签</h3><p>按三级标题统计主题频次，保留括号中的内容。</p></div></div>
          <div className="stats-topic-ranking">
            {stats?.topTags.map((item, index) => (
              <button key={item.tag} type="button" onClick={() => chooseTag(item)} className={drilldown?.kind === "tag" && drilldown.value === item.tag ? "active" : ""}>
                <span className="stats-rank-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="stats-rank-main"><strong>{item.tag}</strong><small>{item.domain} · {item.activeDays} 天</small><i><b style={{ width: `${Math.max(4, item.count / maxTagCount * 100)}%` }} /></i></span>
                <span className="stats-rank-value"><strong>{item.count}</strong><small>{item.delta === 0 ? "—" : `${item.delta > 0 ? "+" : ""}${item.delta}`}</small></span>
              </button>
            ))}
            {!stats?.topTags.length && <WorkspaceState kind="empty" title="暂无标签数据" layout="compact" className="stats-empty compact" />}
          </div>
        </section>
      </div>

      {drilldown && drilldown.kind !== "day" && (
        <section className="stats-section stats-drilldown">
          {drilldownContent}
        </section>
      )}
    </div>
  );
}
