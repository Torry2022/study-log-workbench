export interface EditorLinkCandidate {
  kind: 'day' | 'heading';
  date: string;
  heading: string | null;
  headingId?: string;
  preview: string;
}

export interface EditorLinksResponse { results: EditorLinkCandidate[]; }

export function editorLinkMarkup(candidate: EditorLinkCandidate, alias: string): string {
  const date = candidate.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('内部链接日期无效');
  if (candidate.heading && /[#|\r\n]|\]\]/.test(candidate.heading)) throw new Error('目标标题包含内部链接不支持的字符');
  if (candidate.headingId && (!candidate.heading || !/^[\w\u3400-\u9fff-]+$/u.test(candidate.headingId))) {
    throw new Error('目标小节标识无效');
  }
  const target = candidate.heading ? `${date}#${candidate.headingId || candidate.heading}` : date;
  const label = alias.replace(/\s+/g, ' ').trim();
  if (/[|]|\]\]/.test(label)) throw new Error('显示文字不能包含 | 或 ]]');
  const display = label || candidate.heading || date;
  return `[[${target}${display !== (candidate.headingId || candidate.heading || date) ? `|${display}` : ''}]]`;
}
