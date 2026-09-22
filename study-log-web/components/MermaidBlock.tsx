"use client";

import { memo, useEffect, useMemo, useState } from "react";
import mermaid from "mermaid";

interface MermaidBlockProps {
  chart: string;
  themeMode: "light" | "dark";
  sourceStartLine?: number;
  sourceEndLine?: number;
  sourceStartOffset?: number;
  sourceEndOffset?: number;
}

const mermaidSvgCache = new Map<string, string>();

function cssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function configureMermaid(themeMode: "light" | "dark") {
  const isDark = themeMode === "dark";
  const canvas = cssColor("--canvas", isDark ? "#151412" : "#faf9f5");
  const surfaceSoft = cssColor("--surface-soft", isDark ? "#1c1a17" : "#f5f0e8");
  const surfaceCard = cssColor("--surface-card", isDark ? "#26231f" : "#efe9de");
  const surfaceStrong = cssColor("--surface-strong", isDark ? "#332e27" : "#e8e0d2");
  const ink = cssColor("--ink", isDark ? "#f5f0e8" : "#141413");
  const body = cssColor("--body", isDark ? "#d8d0c2" : "#3d3d3a");
  const muted = cssColor("--muted", isDark ? "#a9a195" : "#6c6a64");
  const hairline = cssColor("--hairline", isDark ? "#353028" : "#e6dfd8");
  const primary = cssColor("--primary", isDark ? "#d4876a" : "#cc785c");

  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      darkMode: isDark,
      background: surfaceSoft,
      mainBkg: surfaceCard,
      primaryColor: surfaceCard,
      primaryTextColor: ink,
      primaryBorderColor: primary,
      secondaryColor: surfaceStrong,
      secondaryTextColor: ink,
      secondaryBorderColor: hairline,
      tertiaryColor: canvas,
      tertiaryTextColor: body,
      tertiaryBorderColor: hairline,
      lineColor: muted,
      textColor: ink,
      nodeTextColor: ink,
      edgeLabelBackground: surfaceSoft,
      noteBkgColor: surfaceStrong,
      noteTextColor: ink,
      noteBorderColor: primary,
      clusterBkg: surfaceSoft,
      clusterBorder: hairline,
      titleColor: ink
    }
  });
}

function normalizeMermaidSvg(value: string): string {
  return value
    .replace(/background(?:-color)?:\s*(?:#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|var\([^)]+\));?/g, "")
    .replace(/<svg\b/, '<svg data-mermaid-rendered="true"');
}

function MermaidBlockComponent({
  chart,
  themeMode,
  sourceStartLine,
  sourceEndLine,
  sourceStartOffset,
  sourceEndOffset
}: MermaidBlockProps) {
  const cacheKey = useMemo(() => `${themeMode}\u0000${chart}`, [chart, themeMode]);
  const [svg, setSvg] = useState(() => mermaidSvgCache.get(cacheKey) || "");
  const [error, setError] = useState("");
  const id = useMemo(() => `mermaid-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    const cachedSvg = mermaidSvgCache.get(cacheKey);
    if (cachedSvg) {
      setSvg(cachedSvg);
      setError("");
      return;
    }

    let cancelled = false;
    const renderId = `${id}-${themeMode}`;
    setSvg("");
    configureMermaid(themeMode);

    mermaid
      .render(renderId, chart)
      .then((result) => {
        if (!cancelled) {
          const normalizedSvg = normalizeMermaidSvg(result.svg);
          mermaidSvgCache.set(cacheKey, normalizedSvg);
          setSvg(normalizedSvg);
          setError("");
        }
      })
      .catch((renderError: Error) => {
        if (!cancelled) {
          setError(renderError.message);
          setSvg("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, chart, id, themeMode]);

  if (error) {
    return <pre className="code-block">{chart}</pre>;
  }

  return (
    <div
      className="mermaid-block"
      data-source-block={Number.isInteger(sourceStartLine) && Number.isInteger(sourceEndLine) ? "true" : undefined}
      data-source-start-line={sourceStartLine}
      data-source-end-line={sourceEndLine}
      data-source-start-offset={sourceStartOffset}
      data-source-end-offset={sourceEndOffset}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export const MermaidBlock = memo(MermaidBlockComponent);
