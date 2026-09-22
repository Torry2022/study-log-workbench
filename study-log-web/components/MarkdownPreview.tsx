"use client";

import { X } from "lucide-react";
import {
  createElement,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type Ref,
  type ReactNode,
  type WheelEvent
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { MermaidBlock } from "@/components/MermaidBlock";
import { withBasePath } from "@/lib/base-path";
import { buildMarkdownOutline, type MarkdownHeading } from "@/lib/markdown-outline";
import { useDialogExit } from "@/hooks/use-dialog-exit";

interface MarkdownPreviewProps {
  active?: boolean;
  content: string;
  headings?: MarkdownHeading[];
  containerRef?: Ref<HTMLElement>;
  themeMode?: "light" | "dark";
  textHighlight?: {
    query: string;
    ignoreCase: boolean;
  };
  onInternalLink?: (target: InternalLinkTarget) => void;
  citationSourceIds?: string[];
  onCitationLink?: (sourceId: string) => void;
}

export interface InternalLinkTarget {
  date?: string;
  headingText?: string;
}

interface LightboxImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

function sourceBlockProps(node: any) {
  const startLine = node?.position?.start?.line;
  const endLine = node?.position?.end?.line;
  const startOffset = node?.position?.start?.offset;
  const endOffset = node?.position?.end?.offset;
  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset)
  ) return {};
  return {
    "data-source-block": "true",
    "data-source-start-line": startLine,
    "data-source-end-line": endLine,
    "data-source-start-offset": startOffset,
    "data-source-end-offset": endOffset
  };
}

const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: "js",
  javascript: "js",
  jsx: "js",
  mjs: "js",
  typescript: "ts",
  tsx: "ts",
  py: "python",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  html: "markup",
  xml: "markup",
  vue: "markup"
};

const KEYWORDS: Record<string, string[]> = {
  bash: ["case", "do", "done", "elif", "else", "esac", "export", "fi", "for", "function", "if", "in", "local", "then", "while"],
  css: ["and", "from", "in", "not", "only", "or", "screen", "to"],
  js: [
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "import",
    "in",
    "let",
    "new",
    "of",
    "return",
    "switch",
    "throw",
    "try",
    "typeof",
    "var",
    "while",
    "yield"
  ],
  python: [
    "and",
    "as",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "elif",
    "else",
    "except",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "try",
    "while",
    "with",
    "yield"
  ],
  sql: ["alter", "and", "as", "by", "create", "delete", "drop", "from", "group", "having", "in", "insert", "into", "join", "left", "like", "limit", "not", "null", "on", "or", "order", "right", "select", "table", "update", "values", "where"]
};

const VALUE_WORDS = new Set(["False", "None", "True", "false", "null", "true", "undefined"]);

const TOKEN_PATTERN = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|\b[A-Za-z_$][\w$-]*\b|\b\d+(?:\.\d+)?\b|[{}()[\].,;:+\-*/%=<>!&|?@]+)/g;
const WIKI_LINK_PATTERN = /\[\[([^\]\n]+)]]/g;
const CITATION_PATTERN = /\[(S\d+)]/g;

function createTextHighlightPlugin(query: string, ignoreCase: boolean) {
  const rawNeedle = query.trim();
  const needle = ignoreCase ? rawNeedle.toLowerCase() : rawNeedle;

  return () => (tree: any) => {
    if (!needle) return;
    let highlighted = false;

    function visit(node: any) {
      if (highlighted || !Array.isArray(node?.children)) return;

      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (child?.type === "text" && typeof child.value === "string") {
          const haystack = ignoreCase ? child.value.toLowerCase() : child.value;
          const matchIndex = haystack.indexOf(needle);
          if (matchIndex < 0) continue;

          const before = child.value.slice(0, matchIndex);
          const match = child.value.slice(matchIndex, matchIndex + rawNeedle.length);
          const after = child.value.slice(matchIndex + rawNeedle.length);
          node.children.splice(
            index,
            1,
            ...(before ? [{ type: "text", value: before }] : []),
            {
              type: "element",
              tagName: "mark",
              properties: { className: ["search-hit-highlight"] },
              children: [{ type: "text", value: match }]
            },
            ...(after ? [{ type: "text", value: after }] : [])
          );
          highlighted = true;
          return;
        }
        visit(child);
        if (highlighted) return;
      }
    }

    visit(tree);
  };
}

function encodeAssetPath(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function resolveImageSrc(src: unknown): string {
  if (typeof src !== "string") return "";
  if (/^(https?:|data:|blob:)/i.test(src)) return src;

  const normalized = src.replace(/\\/g, "/").split(/[?#]/, 1)[0];
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  const assetsIndex = segments.indexOf("assets");
  const assetSegments = assetsIndex >= 0 ? segments.slice(assetsIndex + 1) : [];
  if (assetSegments.length > 0 && assetSegments.every((segment) => segment !== "..")) {
    return withBasePath(`/api/assets/${encodeAssetPath(assetSegments.join("/"))}`);
  }

  return src;
}

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) return textFromChildren(children.props.children);
  return "";
}

function mermaidChartFromPreChildren(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null;
  const className = child.props.className || "";
  if (!/\blanguage-mermaid\b/.test(className)) return null;
  return textFromChildren(child.props.children).trim();
}

function languageFromClassName(className?: string): string {
  const language = className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase() || "";
  return LANGUAGE_ALIASES[language] || language;
}

function tokenClassName(token: string, language: string, source: string, endIndex: number): string | null {
  if (/^(?:\/\/|#|\/\*)/.test(token)) return "syntax-token syntax-comment";
  if (/^["'`]/.test(token)) {
    if ((language === "json" || language === "yaml") && /^\s*:/.test(source.slice(endIndex))) {
      return "syntax-token syntax-key";
    }
    return "syntax-token syntax-string";
  }
  if (/^\d/.test(token)) return "syntax-token syntax-number";
  if (VALUE_WORDS.has(token)) return "syntax-token syntax-literal";
  if ((KEYWORDS[language] || KEYWORDS.js).includes(token) || KEYWORDS.sql.includes(token.toLowerCase())) {
    return "syntax-token syntax-keyword";
  }
  if (/^[{}()[\].,;:+\-*/%=<>!&|?@]+$/.test(token)) return "syntax-token syntax-punctuation";
  return null;
}

function renderHighlightedCode(value: string, language: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    const index = match.index || 0;
    if (index > cursor) parts.push(value.slice(cursor, index));

    const className = tokenClassName(token, language, value, index + token.length);
    parts.push(
      className ? (
        <span className={className} key={`${index}-${token}`}>
          {token}
        </span>
      ) : (
        token
      )
    );
    cursor = index + token.length;
  }

  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

function wikiLinkUrl(target: InternalLinkTarget): string {
  const params = new URLSearchParams();
  if (target.date) params.set("date", target.date);
  if (target.headingText) params.set("heading", target.headingText);
  return `study-log://wikilink?${params.toString()}`;
}

function markdownUrlTransform(value: string): string {
  return value.startsWith("study-log://wikilink?") || value.startsWith("study-log://citation?")
    ? value
    : defaultUrlTransform(value);
}

function parseWikiLink(rawValue: string): { label: string; target: InternalLinkTarget } | null {
  const [rawTarget, rawAlias] = rawValue.split("|", 2);
  const targetText = rawTarget.trim();
  if (!targetText) return null;

  const hashIndex = targetText.indexOf("#");
  const rawDate = hashIndex >= 0 ? targetText.slice(0, hashIndex).trim() : targetText;
  const rawHeading = hashIndex >= 0 ? targetText.slice(hashIndex + 1).trim() : "";
  const target: InternalLinkTarget = {};

  if (rawDate) target.date = rawDate;
  if (rawHeading) target.headingText = rawHeading;
  if (!target.date && !target.headingText) return null;

  return {
    label: (rawAlias || rawHeading || rawDate).trim() || targetText,
    target
  };
}

function splitWikiLinks(value: string): any[] | null {
  const nodes: any[] = [];
  let cursor = 0;

  for (const match of value.matchAll(WIKI_LINK_PATTERN)) {
    const start = match.index || 0;
    const end = start + match[0].length;
    if (start > 0 && value[start - 1] === "!") continue;

    const parsed = parseWikiLink(match[1]);
    if (!parsed) continue;

    if (start > cursor) nodes.push({ type: "text", value: value.slice(cursor, start) });
    nodes.push({
      type: "link",
      url: wikiLinkUrl(parsed.target),
      title: null,
      data: {
        hProperties: {
          "data-internal-link": "true"
        }
      },
      children: [{ type: "text", value: parsed.label }]
    });
    cursor = end;
  }

  if (cursor === 0) return null;
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

function remarkInternalLinks() {
  const blockedAncestorTypes = new Set(["link", "linkReference", "image", "imageReference"]);

  function visit(node: any, ancestors: any[] = []) {
    if (!node || !Array.isArray(node.children)) return;
    if (blockedAncestorTypes.has(node.type)) return;

    const nextChildren: any[] = [];
    for (const child of node.children) {
      if (child?.type === "text" && !ancestors.some((ancestor) => blockedAncestorTypes.has(ancestor.type))) {
        const split = splitWikiLinks(child.value || "");
        if (split) {
          nextChildren.push(...split);
          continue;
        }
      }

      visit(child, [...ancestors, node]);
      nextChildren.push(child);
    }
    node.children = nextChildren;
  }

  return (tree: any) => visit(tree);
}

function remarkCitationLinks(sourceIds: string[]) {
  const allowedSourceIds = new Set(sourceIds);
  const normalizedSourceIds = new Map(sourceIds.map((sourceId) => [sourceId.toUpperCase(), sourceId]));

  return function citationLinksPlugin() {
    function visit(node: any, blocked = false) {
      if (!node || !Array.isArray(node.children)) return;
      const blocksChildren = blocked || ["link", "linkReference", "code", "inlineCode"].includes(node.type);
      const nextChildren: any[] = [];

      for (const child of node.children) {
        if (!blocksChildren && child?.type === "footnoteReference") {
          const label = typeof child.label === "string" ? child.label : child.identifier;
          const sourceId = typeof label === "string" ? normalizedSourceIds.get(label.toUpperCase()) : undefined;
          if (sourceId) {
            nextChildren.push({
              type: "link",
              url: `study-log://citation?sourceId=${encodeURIComponent(sourceId)}`,
              title: null,
              children: [{ type: "text", value: sourceId }]
            });
            continue;
          }
        }

        if (!blocksChildren && child?.type === "text") {
          let cursor = 0;
          let matched = false;
          for (const match of child.value.matchAll(CITATION_PATTERN)) {
            const sourceId = match[1];
            if (!allowedSourceIds.has(sourceId)) continue;
            const start = match.index || 0;
            if (start > cursor) nextChildren.push({ type: "text", value: child.value.slice(cursor, start) });
            nextChildren.push({
              type: "link",
              url: `study-log://citation?sourceId=${encodeURIComponent(sourceId)}`,
              title: null,
              children: [{ type: "text", value: sourceId }]
            });
            cursor = start + match[0].length;
            matched = true;
          }
          if (matched) {
            if (cursor < child.value.length) nextChildren.push({ type: "text", value: child.value.slice(cursor) });
            continue;
          }
        }

        visit(child, blocksChildren);
        nextChildren.push(child);
      }
      node.children = nextChildren;
    }

    return (tree: any) => visit(tree);
  };
}

function remarkCjkStrong(source: string) {
  const blockedAncestorTypes = new Set(["code", "inlineCode", "link", "linkReference", "image", "imageReference"]);
  const pattern = /\*\*(?=\S)([^*\n]*?\S)\*\*(?=[\p{L}\p{N}])/gu;

  function splitMalformedNestedStrong(node: any): any[] | null {
    if (node?.type !== "strong" || !Array.isArray(node.children)) return null;

    const nestedIndex = node.children.findIndex((child: any) => child?.type === "strong");
    if (nestedIndex <= 0 || nestedIndex >= node.children.length - 1) return null;

    const before = node.children.slice(0, nestedIndex);
    const nested = node.children[nestedIndex];
    const after = node.children.slice(nestedIndex + 1);
    const previous = before.at(-1);
    const following = after[0];
    const nestedStart = nested?.position?.start?.offset;
    const nestedEnd = nested?.position?.end?.offset;

    if (
      typeof nestedStart !== "number" ||
      typeof nestedEnd !== "number" ||
      previous?.position?.end?.offset !== nestedStart ||
      following?.position?.start?.offset !== nestedEnd ||
      source.slice(nestedStart, nestedStart + 2) !== "**" ||
      !/^[\p{L}\p{N}]/u.test(source.slice(nestedStart + 2, nestedStart + 3))
    ) {
      return null;
    }

    return [
      { type: "strong", children: before },
      ...nested.children,
      { type: "strong", children: after }
    ];
  }

  function visit(node: any) {
    if (!node || !Array.isArray(node.children) || blockedAncestorTypes.has(node.type)) return;

    const nextChildren: any[] = [];
    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index];
      const splitStrong = splitMalformedNestedStrong(child);
      if (splitStrong) {
        nextChildren.push(...splitStrong);
        continue;
      }

      const inlineCode = node.children[index + 1];
      const suffix = node.children[index + 2];
      if (
        child?.type === "text" &&
        child.value.endsWith("**") &&
        inlineCode?.type === "inlineCode" &&
        suffix?.type === "text" &&
        /^\*\*(?=[\p{L}\p{N}])/u.test(suffix.value)
      ) {
        const prefix = child.value.slice(0, -2);
        if (prefix) nextChildren.push({ ...child, value: prefix });
        nextChildren.push({ type: "strong", children: [inlineCode] });
        const remainder = suffix.value.slice(2);
        if (remainder) nextChildren.push({ ...suffix, value: remainder });
        index += 2;
        continue;
      }

      if (child?.type === "text") {
        const nodes: any[] = [];
        let cursor = 0;
        for (const match of child.value.matchAll(pattern)) {
          const start = match.index || 0;
          if (start > cursor) nodes.push({ type: "text", value: child.value.slice(cursor, start) });
          nodes.push({ type: "strong", children: [{ type: "text", value: match[1] }] });
          cursor = start + match[0].length;
        }
        if (cursor > 0) {
          if (cursor < child.value.length) nodes.push({ type: "text", value: child.value.slice(cursor) });
          nextChildren.push(...nodes);
          continue;
        }
      }

      visit(child);
      nextChildren.push(child);
    }
    node.children = nextChildren;
  }

  return (tree: any) => visit(tree);
}

function remarkHtmlBreaks() {
  function visit(node: any) {
    if (!node || !Array.isArray(node.children)) return;
    node.children = node.children.map((child: any) => {
      if (child?.type === "html" && /^<br\s*\/?\s*>$/i.test(child.value || "")) {
        return { type: "break" };
      }
      visit(child);
      return child;
    });
  }

  return (tree: any) => visit(tree);
}

function parseInternalLinkHref(href: string): InternalLinkTarget | null {
  if (!href.startsWith("study-log://wikilink")) return null;
  const url = new URL(href);
  const date = url.searchParams.get("date")?.trim() || undefined;
  const headingText = url.searchParams.get("heading")?.trim() || undefined;
  if (!date && !headingText) return null;
  return { date, headingText };
}

function parseCitationHref(href: string): string | null {
  if (!href.startsWith("study-log://citation")) return null;
  const sourceId = new URL(href).searchParams.get("sourceId")?.trim() || "";
  return /^S\d+$/.test(sourceId) ? sourceId : null;
}

function clampScale(value: number): number {
  return Math.min(Math.max(value, 0.4), 4);
}

function normalizeLatexDelimiters(value: string): string {
  let fenceMarker = "";

  return value
    .split("\n")
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1][0];
        fenceMarker = fenceMarker === marker ? "" : fenceMarker || marker;
        return line;
      }
      if (fenceMarker) return line;

      return line
        .split(/(`+[^`]*`+)/g)
        .map((segment, index) => {
          if (index % 2 === 1) return segment;
          return segment
            .replace(/\\\[/g, () => "$$")
            .replace(/\\\]/g, () => "$$")
            .replace(/\\\(/g, () => "$")
            .replace(/\\\)/g, () => "$");
        })
        .join("");
    })
    .join("\n");
}

function MarkdownPreviewComponent({
  active = true,
  content,
  headings = [],
  containerRef,
  themeMode = "light",
  textHighlight,
  onInternalLink,
  citationSourceIds = [],
  onCitationLink
}: MarkdownPreviewProps) {
  const [lightboxImage, setLightboxImage] = useState<LightboxImage | null>(null);
  const lightboxExit = useDialogExit<HTMLDivElement>(() => lightboxExit.requestExit(() => setLightboxImage(null)));
  const [lightboxScale, setLightboxScale] = useState(1);
  const [lightboxOffset, setLightboxOffset] = useState({ x: 0, y: 0 });
  const [lightboxDragging, setLightboxDragging] = useState(false);
  const [canUsePortal, setCanUsePortal] = useState(false);
  const renderedContent = useMemo(() => normalizeLatexDelimiters(content), [content]);
  const textHighlightPlugin = useMemo(
    () => createTextHighlightPlugin(textHighlight?.query || "", textHighlight?.ignoreCase ?? true),
    [textHighlight?.ignoreCase, textHighlight?.query]
  );
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStateRef = useRef<{
    distance: number;
    centerX: number;
    centerY: number;
    scale: number;
    originX: number;
    originY: number;
  } | null>(null);
  const renderedHeadingIds = useMemo(() => new Map(
    headings.length ? buildMarkdownOutline(renderedContent).map((item, index) => [item.line, headings[index]?.id]) : []
  ), [renderedContent, headings]);

  useEffect(() => {
    setCanUsePortal(true);
  }, []);

  useEffect(() => { if (!active) setLightboxImage(null); }, [active]);

  useEffect(() => {
    if (!active || !lightboxImage) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLightboxImage(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, lightboxImage]);

  function renderHeading(level: number, children: ReactNode, props: Record<string, unknown>, node: any) {
    return createElement(
      `h${level}`,
      {
        ...props,
        ...sourceBlockProps(node),
        id: renderedHeadingIds.get(node?.position?.start?.line),
        className: "markdown-heading-anchor"
      },
      children
    );
  }

  function openLightbox(src: string, alt: string, event: MouseEvent<HTMLImageElement>) {
    event.stopPropagation();
    const image = event.currentTarget;
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) return;
    setLightboxImage({
      src,
      alt,
      width: image.naturalWidth || image.clientWidth || 1,
      height: image.naturalHeight || image.clientHeight || 1
    });
    setLightboxScale(1);
    setLightboxOffset({ x: 0, y: 0 });
    setLightboxDragging(false);
    dragStateRef.current = null;
    activePointersRef.current.clear();
    pinchStateRef.current = null;
  }

  function closeLightbox() {
    lightboxExit.requestExit(() => {
      setLightboxImage(null);
      setLightboxDragging(false);
      dragStateRef.current = null;
      activePointersRef.current.clear();
      pinchStateRef.current = null;
    });
  }

  function handleLightboxWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const step = event.deltaY > 0 ? -0.14 : 0.14;
    setLightboxScale((current) => {
      const next = clampScale(Number((current + step).toFixed(2)));
      if (next <= 1) setLightboxOffset({ x: 0, y: 0 });
      return next;
    });
  }

  function handleLightboxPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointersRef.current.size === 2) {
      const [first, second] = Array.from(activePointersRef.current.values());
      pinchStateRef.current = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        centerX: (first.x + second.x) / 2,
        centerY: (first.y + second.y) / 2,
        scale: lightboxScale,
        originX: lightboxOffset.x,
        originY: lightboxOffset.y
      };
      dragStateRef.current = null;
      setLightboxDragging(true);
      return;
    }

    if (lightboxScale <= 1) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: lightboxOffset.x,
      originY: lightboxOffset.y
    };
    setLightboxDragging(true);
  }

  function handleLightboxPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const pinchState = pinchStateRef.current;
    if (pinchState && activePointersRef.current.size >= 2) {
      const [first, second] = Array.from(activePointersRef.current.values());
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      const nextScale = clampScale(pinchState.scale * (distance / Math.max(pinchState.distance, 1)));
      event.preventDefault();
      setLightboxScale(nextScale);
      setLightboxOffset(nextScale <= 1 ? { x: 0, y: 0 } : {
        x: pinchState.originX + centerX - pinchState.centerX,
        y: pinchState.originY + centerY - pinchState.centerY
      });
      return;
    }

    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    setLightboxOffset({
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY
    });
  }

  function handleLightboxPointerEnd(event: PointerEvent<SVGSVGElement>) {
    activePointersRef.current.delete(event.pointerId);
    if (pinchStateRef.current) {
      pinchStateRef.current = null;
      dragStateRef.current = null;
      setLightboxDragging(false);
    }

    const dragState = dragStateRef.current;
    if (dragState?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      setLightboxDragging(false);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <article className="markdown-preview" ref={containerRef}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, () => remarkCjkStrong(renderedContent), remarkInternalLinks, remarkCitationLinks(citationSourceIds), remarkHtmlBreaks]}
        rehypePlugins={[rehypeKatex, textHighlightPlugin]}
        urlTransform={markdownUrlTransform}
        components={{
          h2({ node, children, ...props }: any) {
            return renderHeading(2, children, props, node);
          },
          h3({ node, children, ...props }: any) {
            return renderHeading(3, children, props, node);
          },
          h4({ node, children, ...props }: any) {
            return renderHeading(4, children, props, node);
          },
          h5({ node, children, ...props }: any) {
            return renderHeading(5, children, props, node);
          },
          h6({ node, children, ...props }: any) {
            return renderHeading(6, children, props, node);
          },
          p({ node, children, ...props }: any) {
            return <p {...props} {...sourceBlockProps(node)}>{children}</p>;
          },
          ul({ node, children, ...props }: any) {
            return <ul {...props} {...sourceBlockProps(node)}>{children}</ul>;
          },
          ol({ node, children, ...props }: any) {
            return <ol {...props} {...sourceBlockProps(node)}>{children}</ol>;
          },
          li({ node, children, ...props }: any) {
            return <li {...props} {...sourceBlockProps(node)}>{children}</li>;
          },
          blockquote({ node, children, ...props }: any) {
            return <blockquote {...props} {...sourceBlockProps(node)}>{children}</blockquote>;
          },
          table({ node, children, ...props }: any) {
            return <table {...props} {...sourceBlockProps(node)}>{children}</table>;
          },
          hr({ node, ...props }: any) {
            return <hr {...props} {...sourceBlockProps(node)} />;
          },
          code({ className, children, ...props }: any) {
            const language = languageFromClassName(className);
            const code = textFromChildren(children);
            return (
              <code className={className} data-language={language || undefined} {...props}>
                {language ? renderHighlightedCode(code, language) : children}
              </code>
            );
          },
          pre({ node, children }: any) {
            const mermaidChart = mermaidChartFromPreChildren(children);
            if (mermaidChart) {
              const source = sourceBlockProps(node);
              return (
                <MermaidBlock
                  chart={mermaidChart}
                  themeMode={themeMode}
                  sourceStartLine={source["data-source-start-line"]}
                  sourceEndLine={source["data-source-end-line"]}
                  sourceStartOffset={source["data-source-start-offset"]}
                  sourceEndOffset={source["data-source-end-offset"]}
                />
              );
            }
            return <pre className="code-block" {...sourceBlockProps(node)}>{children}</pre>;
          },
          img({ src, alt, ...props }: any) {
            const imageSrc = resolveImageSrc(src);
            const imageAlt = alt || "";
            return (
              <img
                src={imageSrc}
                alt={imageAlt}
                loading="lazy"
                referrerPolicy={/^https?:/i.test(imageSrc) ? "no-referrer" : undefined}
                {...props}
                className={["preview-image", props.className].filter(Boolean).join(" ")}
                onClick={(event) => openLightbox(imageSrc, imageAlt, event)}
              />
            );
          },
          a({ href, children, ...props }: any) {
            const citationSourceId = typeof href === "string" ? parseCitationHref(href) : null;
            if (citationSourceId) {
              return (
                <button
                  className="markdown-citation-link"
                  type="button"
                  onClick={() => onCitationLink?.(citationSourceId)}
                  title={`查看来源 ${citationSourceId}`}
                  aria-label={`查看来源 ${citationSourceId}`}
                >
                  {citationSourceId}
                </button>
              );
            }

            const internalTarget = typeof href === "string" ? parseInternalLinkHref(href) : null;
            if (internalTarget) {
              return (
                <a
                  {...props}
                  href={href}
                  data-internal-link="true"
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    event.preventDefault();
                    onInternalLink?.(internalTarget);
                  }}
                >
                  {children}
                </a>
              );
            }

            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          }
        }}
      >
        {renderedContent || "选择左侧日期，或新建今天的学习日志"}
      </ReactMarkdown>
      {active && lightboxImage && canUsePortal && createPortal(
        <div ref={lightboxExit.backdropRef} className="image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={closeLightbox}>
          <button className="image-lightbox-close" type="button" onClick={closeLightbox} aria-label="关闭图片预览">
            <X size={19} />
          </button>
          <div className="image-lightbox-stage" onWheel={handleLightboxWheel}>
            <div className="image-lightbox-frame" onClick={(event) => event.stopPropagation()}>
              <svg
                className={lightboxDragging ? "image-lightbox-image dragging" : "image-lightbox-image"}
                role="img"
                aria-label={lightboxImage.alt || "图片预览"}
                width={lightboxImage.width}
                height={lightboxImage.height}
                viewBox={`0 0 ${lightboxImage.width} ${lightboxImage.height}`}
                onPointerDown={handleLightboxPointerDown}
                onPointerMove={handleLightboxPointerMove}
                onPointerUp={handleLightboxPointerEnd}
                onPointerCancel={handleLightboxPointerEnd}
                style={{
                  transform: `translate(${lightboxOffset.x}px, ${lightboxOffset.y}px) scale(${lightboxScale})`
                }}
              >
                {lightboxImage.alt ? <title>{lightboxImage.alt}</title> : null}
                <image
                  href={lightboxImage.src}
                  width={lightboxImage.width}
                  height={lightboxImage.height}
                  preserveAspectRatio="xMidYMid meet"
                />
              </svg>
            </div>
          </div>
          <div className="image-lightbox-scale">{Math.round(lightboxScale * 100)}%</div>
        </div>,
        document.body
      )}
    </article>
  );
}

export const MarkdownPreview = memo(MarkdownPreviewComponent);
