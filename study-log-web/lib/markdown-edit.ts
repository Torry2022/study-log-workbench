export type MarkdownEdit = "paragraph" | "h3" | "h4" | "h5" | "h6" | "bold" | "italic" | "code" | "codeBlock" | "unordered" | "ordered" | "quote" | "table" | "math" | "mathBlock" | "link";
export interface MarkdownChange { from: number; to: number; insert: string; anchor: number; head: number }

/** A single replacement, shared by CodeMirror and the note textareas. */
export function markdownChange(value: string, from: number, to: number, command: MarkdownEdit): MarkdownChange {
  const selected = value.slice(from, to);
  const wrap = (before: string, after: string, placeholder: string): MarkdownChange => {
    if (selected && selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
      const insert = selected.slice(before.length, selected.length - after.length);
      return { from, to, insert, anchor: from, head: from + insert.length };
    }
    if (selected && value.slice(from - before.length, from) === before && value.slice(to, to + after.length) === after) {
      return { from: from - before.length, to: to + after.length, insert: selected, anchor: from - before.length, head: from - before.length + selected.length };
    }
    const inner = selected || placeholder;
    return { from, to, insert: before + inner + after, anchor: from + before.length, head: from + before.length + inner.length };
  };
  if (command === "bold") return wrap("**", "**", "加粗文本");
  if (command === "italic") return wrap("*", "*", "斜体文本");
  if (command === "code") return wrap("`", "`", "代码");
  if (command === "math") return wrap("$", "$", "x^2");
  if (command === "link") {
    const label = selected || "链接文本";
    const insert = `[${label}](https://)`;
    return { from, to, insert, anchor: from + (selected ? label.length + 3 : 1), head: from + (selected ? insert.length - 1 : label.length + 1) };
  }
  if (["codeBlock", "mathBlock", "table"].includes(command)) {
    const leading = from && value[from - 1] !== "\n" ? "\n\n" : "";
    const trailing = to < value.length && value[to] !== "\n" ? "\n\n" : "";
    const fence = "`".repeat(Math.max(3, ...Array.from(selected.matchAll(/`+/g), match => match[0].length + 1)));
    const inner = selected || (command === "mathBlock" ? "E = mc^2" : command === "table" ? "内容" : "代码");
    const before = command === "codeBlock" ? `${fence}\n` : command === "mathBlock" ? "$$\n" : "| 列一 | 列二 |\n| --- | --- |\n| ";
    const body = command === "table" ? inner.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>") : inner;
    const after = command === "codeBlock" ? `\n${fence}` : command === "mathBlock" ? "\n$$" : " |  |";
    return { from, to, insert: leading + before + body + after + trailing, anchor: from + leading.length + before.length, head: from + leading.length + before.length + body.length };
  }
  const start = from === 0 ? 0 : value.lastIndexOf("\n", from - 1) + 1;
  // A selection ending at the next line's start must not format that line.
  const last = to > from && value[to - 1] === "\n" ? to - 1 : to;
  const newline = value.indexOf("\n", last);
  const end = newline < 0 ? value.length : newline;
  const original = value.slice(start, end);
  let offset = start, anchor = from, head = to, number = 0, delta = 0;
  const insert = original.split("\n").map(line => {
    if (!line.trim() && original.includes("\n")) {
      if (from >= offset && from <= offset + line.length) anchor = from + delta;
      if (to >= offset && to <= offset + line.length) head = to + delta;
      offset += line.length + 1; return line;
    }
    let remove = 0, prefix = "";
    const heading = line.match(/^ {0,3}#{1,6}[ \t]+/);
    if (command === "paragraph" || command.startsWith("h")) {
      remove = heading?.[0].length || 0;
      prefix = command === "paragraph" ? "" : "#".repeat(Number(command[1])) + " ";
    } else if (command === "quote") {
      remove = line.match(/^ {0,3}>[ \t]?/)?.[0].length || 0;
      prefix = "> ";
    } else {
      remove = line.match(/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/)?.[0].length || 0;
      prefix = command === "ordered" ? `${++number}. ` : "- ";
    }
    const map = (position: number) => offset + delta + prefix.length + Math.max(0, position - offset - remove);
    if (from >= offset && from <= offset + line.length) anchor = map(from);
    if (to >= offset && to <= offset + line.length) head = map(to);
    delta += prefix.length - remove;
    offset += line.length + 1;
    return prefix + line.slice(remove);
  }).join("\n");
  if (to > end) head = to + delta;
  return { from: start, to: end, insert, anchor, head };
}
