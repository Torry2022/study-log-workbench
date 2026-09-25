export interface NoteSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  strike: boolean;
  link: string;
}

// Native inline formatting keeps note paragraphs in the surrounding List's layout.
// Unmatched delimiters and unsupported syntax remain readable text.
export function noteSpans(source: string, bold: boolean = false, italic: boolean = false,
  strike: boolean = false): NoteSpan[] {
  const result: NoteSpan[] = [];
  const append = (text: string, code: boolean = false, link: string = ''): void => {
    const previous = result[result.length - 1];
    if (previous && previous.bold === bold && previous.italic === italic && previous.strike === strike &&
      previous.code === code && previous.link === link) previous.text += text;
    else result.push({ text, bold, italic, code, strike, link });
  };
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    if (/^\\[\\`*_[\]~]/.test(rest)) { append(rest[1]); index += 2; continue; }
    if (rest.startsWith('`')) {
      const delimiter = rest.match(/^`+/)![0];
      const end = source.indexOf(delimiter, index + delimiter.length);
      if (end > index + delimiter.length) {
        append(source.slice(index + delimiter.length, end), true);
        index = end + delimiter.length;
        continue;
      }
    }
    const internal = rest.match(/^\[\[(\d{4}-\d{2}-\d{2})(?:#([^|\]]+))?(?:\|([^\]]+))?\]\]/);
    if (internal) {
      append(internal[3] || internal[2] || internal[1], false,
        `study-log://wikilink?date=${internal[1]}&heading=${encodeURIComponent(internal[2] || '')}`);
      index += internal[0].length;
      continue;
    }
    const link = rest.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    if (link && (index === 0 || source[index - 1] !== '!')) {
      append(link[1], false, link[2]); index += link[0].length; continue;
    }
    let matched = false;
    const delimiters = ['***', '___', '**', '__', '~~', '*', '_'];
    for (const delimiter of delimiters) {
      if (!rest.startsWith(delimiter) || /\s/.test(rest[delimiter.length] || ' ')) continue;
      if (delimiter.startsWith('_') && index > 0 && /[\w]/.test(source[index - 1])) continue;
      const end = source.indexOf(delimiter, index + delimiter.length);
      if (end <= index + delimiter.length || /\s/.test(source[end - 1])) continue;
      const content = source.slice(index + delimiter.length, end);
      result.push(...noteSpans(content, bold || delimiter.length >= 2 && delimiter !== '~~',
        italic || delimiter.length === 1 || delimiter.length === 3, strike || delimiter === '~~'));
      index = end + delimiter.length;
      matched = true;
      break;
    }
    if (!matched) { append(source[index]); index++; }
  }
  return result;
}
