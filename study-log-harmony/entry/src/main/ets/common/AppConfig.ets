export enum WorkspaceBreakpoint {
  COMPACT = 'compact',
  MEDIUM = 'medium',
  LARGE = 'large',
  EXTRA_LARGE = 'extra_large'
}

export const READING_MAX_WIDTH: number = 1040;
export const COLLECTION_MAX_WIDTH: number = 1240;
export const THEME_PREFERENCES: string = 'study_log_public_theme';

export interface TabDefinition {
  label: string;
  tooltip: string;
  icon: Resource;
  activeIcon: Resource;
}

export const WORKSPACE_TABS: TabDefinition[] = [
  { label: '日志', tooltip: '阅读与编辑学习日志', icon: $r('app.media.tab_file_text'), activeIcon: $r('app.media.tab_file_text_active') },
  { label: '随记', tooltip: '记录想法与个人理解', icon: $r('app.media.tab_lightbulb'), activeIcon: $r('app.media.tab_lightbulb_active') },
  { label: '收藏', tooltip: '回看收藏的小节', icon: $r('app.media.tab_star'), activeIcon: $r('app.media.tab_star_active') },
  { label: '问答', tooltip: '基于学习记录提问', icon: $r('app.media.tab_message_square_text'), activeIcon: $r('app.media.tab_message_square_text_active') },
  { label: '统计', tooltip: '查看学习趋势', icon: $r('app.media.tab_chart_column'), activeIcon: $r('app.media.tab_chart_column_active') }
];
