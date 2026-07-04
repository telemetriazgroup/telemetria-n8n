import { type ReactNode } from "react";

export type MatchHighlightInput = {
  telemetriaKeyword?: string | null;
  personKeyword?: string | null;
  telemetriaExcerpt?: string | null;
  personExcerpt?: string | null;
};

type MatchKind = "telemetria" | "person";

type TextRange = { start: number; end: number; kind: MatchKind };

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordRegex(keyword: string): RegExp {
  return new RegExp(`\\b${escapeRe(keyword.trim())}\\b`, "gi");
}

function excerptCore(excerpt: string): string {
  return excerpt.replace(/^…\s*/, "").replace(/\s*…$/, "").trim();
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function excerptMatchesLine(line: string, excerpt: string | null | undefined): boolean {
  if (!excerpt?.trim()) return false;
  const core = excerptCore(excerpt);
  if (!core) return false;
  const normLine = normalizeSpaces(line);
  const normCore = normalizeSpaces(core);
  if (normCore.length >= 8 && normLine.includes(normCore)) return true;
  const words = normCore.split(" ").filter((w) => w.length > 3);
  if (words.length === 0) return normLine.includes(normCore);
  const hits = words.filter((w) => normLine.includes(w));
  return hits.length >= Math.min(2, words.length);
}

function lineMatchKinds(line: string, input: MatchHighlightInput): MatchKind[] {
  const kinds: MatchKind[] = [];
  if (input.telemetriaKeyword && keywordRegex(input.telemetriaKeyword).test(line)) {
    kinds.push("telemetria");
  }
  if (input.personKeyword && keywordRegex(input.personKeyword).test(line)) {
    kinds.push("person");
  }
  if (!kinds.includes("telemetria") && excerptMatchesLine(line, input.telemetriaExcerpt)) {
    kinds.push("telemetria");
  }
  if (!kinds.includes("person") && excerptMatchesLine(line, input.personExcerpt)) {
    kinds.push("person");
  }
  return kinds;
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TextRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= prev.end) {
      prev.end = Math.max(prev.end, cur.end);
      if (cur.kind !== prev.kind) prev.kind = "telemetria";
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

function findKeywordRanges(line: string, input: MatchHighlightInput): TextRange[] {
  const ranges: TextRange[] = [];
  if (input.telemetriaKeyword) {
    const re = keywordRegex(input.telemetriaKeyword);
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length, kind: "telemetria" });
    }
  }
  if (input.personKeyword) {
    const re = keywordRegex(input.personKeyword);
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length, kind: "person" });
    }
  }
  return mergeRanges(ranges);
}

function markClass(kind: MatchKind): string {
  return kind === "telemetria" ? "match-mark match-mark-telemetria" : "match-mark match-mark-person";
}

function highlightKeywordsInLine(line: string, input: MatchHighlightInput): ReactNode {
  const ranges = findKeywordRanges(line, input);
  if (ranges.length === 0) return line || "\u00a0";

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, idx) => {
    if (range.start > cursor) {
      parts.push(line.slice(cursor, range.start));
    }
    parts.push(
      <mark key={`${range.start}-${idx}`} className={markClass(range.kind)}>
        {line.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  });
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}

function lineClassName(kinds: MatchKind[]): string {
  if (kinds.length === 2) return "match-line match-line-both";
  if (kinds.includes("telemetria")) return "match-line match-line-telemetria";
  if (kinds.includes("person")) return "match-line match-line-person";
  return "";
}

/** Resalta la línea completa y la palabra clave donde hubo match. */
export function renderTextWithMatchHighlights(
  text: string,
  input: MatchHighlightInput
): ReactNode {
  if (!text) return text;
  const hasSignal =
    input.telemetriaKeyword ||
    input.personKeyword ||
    input.telemetriaExcerpt ||
    input.personExcerpt;
  if (!hasSignal) return text;

  const lines = text.split("\n");
  return lines.map((line, index) => {
    const kinds = lineMatchKinds(line, input);
    const className = lineClassName(kinds);
    const content = className ? highlightKeywordsInLine(line, input) : line || "\u00a0";

    return (
      <div key={index} className={className || "match-line-plain"}>
        {content}
      </div>
    );
  });
}

export function textContainsMatch(text: string, input: MatchHighlightInput): boolean {
  if (!text?.trim()) return false;
  return text.split("\n").some((line) => lineMatchKinds(line, input).length > 0);
}

export function compactMatchPreview(input: MatchHighlightInput): string {
  return (
    input.telemetriaExcerpt?.trim() ||
    input.personExcerpt?.trim() ||
    [input.telemetriaKeyword, input.personKeyword].filter(Boolean).join(" · ") ||
    ""
  );
}

/** Una línea corta para la tabla de correos match. */
export function renderCompactMatchPreview(input: MatchHighlightInput): ReactNode {
  const preview = compactMatchPreview(input);
  if (!preview) return "—";
  return renderTextWithMatchHighlights(preview, input);
}

export function renderSubjectWithMatch(
  subject: string | null | undefined,
  input: MatchHighlightInput
): ReactNode {
  if (!subject?.trim()) return "—";
  return renderTextWithMatchHighlights(subject, input);
}
