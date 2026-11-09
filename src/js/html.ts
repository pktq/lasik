import { Findings } from "../core/types.js";
import { healJs, type JsHealOptions, type JsHealResult } from "./heal.js";

const SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi;
// The executable set BLA hardens (bla/src/engine/protector.ts:332-362, classifyHtmlScriptTag).
const JS_TYPE = /^\s*(?:text\/javascript|application\/javascript|module|text\/ecmascript|application\/ecmascript|javascript)?\s*$/i;

/** Identifiers used from HTML attributes (`onclick="foo()"`, `href="javascript:foo()"`): keep them alive in plain scripts. */
function attributeRoots(html: string): Set<string> {
  const roots = new Set<string>();
  for (const m of html.matchAll(/\s(?:on[a-z]+|[a-z-]+(?=\s*=\s*["']\s*javascript:))\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    for (const id of m[2]!.matchAll(/[A-Za-z_$][\w$]*/g)) roots.add(id[0]);
  }
  return roots;
}

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
  const roots = attributeRoots(html);
  const all = [...html.matchAll(SCRIPT)].map((m) => ({ attrs: m[1] ?? "", body: m[2] ?? "" }));
  const inline = all.filter((b) => !/\bsrc\s*=/i.test(b.attrs) && JS_TYPE.test(b.attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? ""));
  // With no external scripts every reader of a global is on this page: a script's globals
  // stay only if an attribute or another script's surviving code mentions them. Start from
  // the unhealed scripts and re-heal until those mentions stop shrinking.
  const pageLocal = !all.some((b) => /\bsrc\s*=/i.test(b.attrs));
  const healOne = (b: { attrs: string; body: string }, others: Set<string>): JsHealResult => {
    const type = b.attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? "";
    return healJs(b.body, { ...opts, filename: type === "module" ? "inline.mjs" : "inline.js", externalRoots: new Set([...roots, ...others]), pageLocal });
  };
  const wordsOf = (s: string) => new Set(s.match(/[A-Za-z_$][\w$]*/g) ?? []);
  let texts = inline.map((b) => b.body);
  let results: JsHealResult[] = [];
  for (let round = 0; round < 4; round++) {
    const words = texts.map(wordsOf);
    results = inline.map((b, i) => healOne(b, pageLocal ? new Set(words.flatMap((w, j) => (j === i ? [] : [...w]))) : new Set()));
    const next = results.map((r, i) => (r.changed ? r.code : inline[i]!.body));
    const stable = next.every((t, i) => wordsOf(t).size === words[i]!.size);
    texts = next;
    if (!pageLocal || stable) break;
  }

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
    return `<script${a}>\n${cleaned.replace(/<\/script/gi, "<\/script")}\n</script>`;
  });

  return { code, findings, warnings, changed, scripts };
}
