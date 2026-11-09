import { Findings } from "../core/types.js";
import { healJs, type JsHealOptions, type JsHealResult } from "./heal.js";

const SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi;
// The executable set BLA hardens (bla/src/engine/protector.ts:332-362, classifyHtmlScriptTag).
const JS_TYPE = /^\s*(?:text\/javascript|application\/javascript|module|text\/ecmascript|application\/ecmascript|javascript)?\s*$/i;

/** Data blocks: script types the browser never runs. */
const DATA_TYPE = /^\s*(?:application\/(?:ld\+)?json|importmap|speculationrules|text\/plain)\s*$/i;

const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(colon|lpar|rpar|period|lowbar|semi);/gi, (_, n: string) => ({ colon: ":", lpar: "(", rpar: ")", period: ".", lowbar: "_", semi: ";" })[n.toLowerCase()]!);

/**
 * Every identifier-like word in the page outside its scripts: event attributes in any
 * syntax (quoted, unquoted, `/`-separated), `javascript:` URLs, entity-encoded ones. Any
 * global they could name stays alive.
 */
function markupRoots(html: string): Set<string> {
  return new Set(decodeEntities(html.replace(SCRIPT, " ")).match(/[A-Za-z_$][\w$]*/g) ?? []);
}

/** Markup that lets code outside the page's inline scripts read their globals. */
function pageIsOpen(html: string, scripts: { attrs: string }[]): boolean {
  if (/<(?:iframe|frame|object|embed|portal)\b/i.test(html)) return true;
  for (const { attrs } of scripts) {
    if (/\b(?:src|href)\s*=/i.test(attrs)) return true;
    const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? "";
    if (!JS_TYPE.test(type) && !DATA_TYPE.test(type)) return true; // text/babel and friends run JS we don't see
  }
  return false;
}

/** Surviving script code that can load more code into the page (imports, injected scripts, markup writes). */
const LOADS_CODE = /\bimport\s*(?:\(|["'{*\w])|createElement\s*\(|document\s*\.\s*write|\.(?:inner|outer)HTML\s*=|insertAdjacentHTML|createContextualFragment|new\s+Worker/;

export interface HtmlHealResult {
  code: string;
  findings: Findings;
  warnings: string[];
  changed: boolean;
  scripts: number;
}

/**
 * BLA hardens every executable inline <script> independently (each gets its
 * own seed, armor corpus and decoy suite) and injects a `void 0;` bootstrap
 * script when a page has none. Heal each script with the JS pipeline and
 * drop scripts that end up empty.
 */
export function healHtml(html: string, opts: JsHealOptions = {}): HtmlHealResult {
  const roots = markupRoots(html);
  const all = [...html.matchAll(SCRIPT)].map((m) => ({ attrs: m[1] ?? "", body: m[2] ?? "" }));
  const inline = all.filter((b) => !/\bsrc\s*=/i.test(b.attrs) && JS_TYPE.test(b.attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? ""));
  // On a closed page every reader of a global is on this page: a script's globals stay only
  // if the markup or another script's surviving code mentions them. Start from the unhealed
  // scripts and re-heal until those mentions stop changing.
  const healOne = (b: { attrs: string; body: string }, others: Set<string>, pageLocal: boolean): JsHealResult => {
    const type = b.attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? "";
    return healJs(b.body, { ...opts, filename: type === "module" ? "inline.mjs" : "inline.js", externalRoots: new Set([...roots, ...others]), pageLocal });
  };
  const wordsOf = (s: string) => new Set(s.match(/[A-Za-z_$][\w$]*/g) ?? []);
  const healAll = (pageLocal: boolean): { results: JsHealResult[]; settled: boolean } => {
    let texts = inline.map((b) => b.body);
    let results: JsHealResult[] = [];
    for (let round = 0; round < 4; round++) {
      const words = texts.map(wordsOf);
      results = inline.map((b, i) => healOne(b, pageLocal ? new Set(words.flatMap((w, j) => (j === i ? [] : [...w]))) : new Set(), pageLocal));
      texts = results.map((r, i) => (r.changed ? r.code : inline[i]!.body));
      const stable = texts.every((t, i) => {
        const w = wordsOf(t);
        return w.size === words[i]!.size && [...w].every((x) => words[i]!.has(x));
      });
      if (!pageLocal || stable) return { results, settled: true };
    }
    return { results, settled: false };
  };
  // Assume the page is closed, then check what survived: removed code never runs, so only
  // surviving code that loads more code can open it. Otherwise heal without the assumption.
  let { results, settled } = healAll(!pageIsOpen(html, all));
  if (!settled || results.some((r) => r.changed && LOADS_CODE.test(r.code))) results = healAll(false).results;

  const findings = new Findings();
  const warnings: string[] = [];
  let scripts = 0;
  let changed = false;
  const code = html.replace(SCRIPT, (whole, attrs: string | undefined) => {
    const a = attrs ?? "";
    if (/\bsrc\s*=/i.test(a)) return whole;
    const type = a.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? "";
    if (!JS_TYPE.test(type)) return whole;
    const r = results[scripts++]!;
    for (const x of r.findings.list()) findings.add(x.layer, x.technique, x.detail, x.count);
    warnings.push(...r.warnings.map((w) => `<script #${scripts}>: ${w}`));
    if (!r.changed) return whole;
    changed = true;
    const cleaned = r.code.trim();
    if (cleaned === "" || /^(?:"use strict";\s*)?(?:void 0;?)?$/.test(cleaned)) {
      findings.add("deceive", "bootstrap-script", "removed BLA's injected `void 0;` bootstrap <script>");
      return "";
    }
    // Keep the HTML parser from closing the element early.
    return `<script${a}>\n${cleaned.replace(/<\/script/gi, "<\\/script")}\n</script>`;
  });

  return { code, findings, warnings, changed, scripts };
}
