import { Findings } from "../core/types.js";
import { healJs, type JsHealOptions } from "./heal.js";

const SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi;
const JS_TYPE = /^\s*(?:text\/javascript|application\/javascript|module|text\/ecmascript)?\s*$/i;

/** Identifiers used from HTML attributes (`onclick="foo()"`): keep them alive in plain scripts. */
function attributeRoots(html: string): Set<string> {
  const roots = new Set<string>();
  for (const m of html.matchAll(/\son[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi)) {
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
  const findings = new Findings();
  const warnings: string[] = [];
  const roots = attributeRoots(html);
  let scripts = 0;
  let changed = false;

  const code = html.replace(SCRIPT, (whole, attrs: string | undefined, body: string) => {
    const a = attrs ?? "";
    if (/\bsrc\s*=/i.test(a)) return whole;
    const type = a.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? "";
    if (!JS_TYPE.test(type)) return whole;
    scripts++;
    const r = healJs(body, { ...opts, filename: type === "module" ? "inline.mjs" : "inline.js", externalRoots: roots });
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
