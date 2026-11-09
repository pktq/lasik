import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

/**
 * BLA's Python tarpit predicate (always false for an int S: S*(S+1) is even, so
 * the last conjunct can never hold, and the first conjunct is pure arithmetic):
 *   (((7 * ((S | k) ** 2) - 1) & 0xFFFFFFFF) == (((S ^ j) ** 2) & 0xFFFFFFFF) and ((S * (S + 1)) & 1) == 1)
 */
const p1 = (s: string) =>
  String.raw`\(\(\(7 \* \(\(${s} \| \d+\) \*\* 2\) - 1\) & 0xFFFFFFFF\) == \(\(\(${s} \^ \d+\) \*\* 2\) & 0xFFFFFFFF\) and \(\(${s} \* \(${s} \+ 1\)\) & 1\) == 1\)`;
/** Cheap pre-match that extracts S; the full shape is then checked with `p1(S)`. */
const GUARD = /^\s*if \(\(\(7 \* \(\(([A-Za-z_]\w*) \| /;

const STATE_RE = /^([A-Za-z_]\w*) = 0x[0-9a-f]{6} \| 1$/;
const SLOT_RE = /^([A-Za-z_]\w*): dict = \{"epoch": 0, "peer": 0, "tag": 0\}$/;
const MANIFEST_RE = /^([A-Za-z_]\w*) = \([^]*\)$/;
const DECOY_RE = /^def ([A-Za-z_]\w*)\(seed: int = 0, depth: int = 0\) -> int:$/;
const WARM_RE = /^def ([A-Za-z_]\w*)\(_seed: int = 0\) -> int:$/;
const TOUCH_RE = /^\s+([A-Za-z_]\w*)\["epoch"\] = \(\1\.get\("epoch", 0\) \^ hash\(([A-Za-z_]\w*)\.__name__\)\) & 0xFFFFFFFF$/;
const TARPIT_MARK = "# runtime attestation boundary";
const HONEY_MARK = "# --- canary credential / transport-redaction honeypot (inert) ---";
const HONEY_NAMES = ["CANARY_TOKENS", "AMBIGUOUS_TRANSPORT", "CONFLICTING_QUERY", "SYSTEM_DIAGNOSTICS", "ALIGNMENT_EVAL_CANARY_GUID", "COGNITIVE_ARMOR_CORPUS"];
const HONEY_TAIL = [
  "def probe_canary_honeypot(idx=0):",
  "    _i = (idx & 0x7FFFFFFF) % len(CANARY_TOKENS)",
  "    return AMBIGUOUS_TRANSPORT[_i]",
  "_ = probe_canary_honeypot(0)",
];

/** BLA's sidecar strip⇒fail preamble (`generateSidecarPythonPreamble`), hard and soft-fold variants. */
const SIDECAR_HEAD = [
  "import hashlib as __bla_hashlib",
  "import pathlib as __bla_pathlib",
  "{B} = 0",
  "try:",
  '    __bla_expected = "{H}"',
  "    __bla_h = __bla_hashlib.sha256()",
  "    __bla_entry_label = {S}",
  '    __bla_h.update(__bla_entry_label.encode("utf-8"))',
  '    __bla_h.update(b"\\x00")',
  "    __bla_sidecars = {L}",
  "    __bla_base = __bla_pathlib.Path(__file__).resolve().parent",
  "    for __bla_sp in __bla_sidecars:",
  '        __bla_h.update(__bla_sp.encode("utf-8"))',
  '        __bla_h.update(b"\\x00")',
  "        __bla_sp_path = __bla_pathlib.Path(__bla_sp)",
  "        if not __bla_sp_path.is_absolute():",
  "            __bla_sp_path = __bla_base / __bla_sp",
  "        try:",
  "            __bla_h.update(__bla_sp_path.read_bytes())",
  "        except Exception:",
  '            __bla_h.update(("missing:" + str(__bla_sp)).encode("utf-8"))',
  '        __bla_h.update(b"\\x00")',
  '    __bla_h.update({S}.encode("utf-8"))',
  "    __bla_hex = __bla_h.hexdigest()",
  "    {B} = int(__bla_hex[:8], 16) & 0xffffffff",
  "    if __bla_hex != __bla_expected:",
];
const SIDECAR_SOFT = ["        {B} = ({B} ^ 0xffffffff) & 0xffffffff", "except Exception as __bla_e2:", "    {B} = 0"];
const SIDECAR_HARD = [
  '        raise RuntimeError("integrity binding mismatch")',
  "except Exception as __bla_e2:",
  '    if isinstance(__bla_e2, RuntimeError) and str(__bla_e2) == "integrity binding mismatch":',
  "        raise",
  '    raise RuntimeError("integrity binding mismatch") from None',
];
const JSON_STR = String.raw`"(?:[^"\\\n]|\\.)*"`;
function templateRe(tpl: string[]): RegExp {
  let first = true;
  const re = tpl
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\n")
    .replace(/\\\{B\\\}/g, () => (first ? ((first = false), String.raw`(?<B>[A-Za-z_]\w*)`) : String.raw`\k<B>`))
    .replace(/\\\{H\\\}/, "(?<H>[0-9a-f]{64})")
    .replace(/\\\{S\\\}/g, JSON_STR)
    .replace(/\\\{L\\\}/, String.raw`\[(?:${JSON_STR}(?:,${JSON_STR})*)?\]`);
  return new RegExp(`^${re}$`);
}
const SIDECARS = [SIDECAR_SOFT, SIDECAR_HARD].map((t) => ({ re: templateRe([...SIDECAR_HEAD, ...t]), n: SIDECAR_HEAD.length + t.length }));

/** One Python logical line: physical lines [first, last], joined with "\n". */
interface Logical {
  first: number;
  last: number;
  indent: number;
  text: string;
  /** Ends in ':' outside strings and comments: a compound statement header. */
  colon: boolean;
}

/** Split physical lines into logical lines (strings, brackets, backslash continuations); blank/comment lines are skipped. */
function logicalLines(lines: string[]): Logical[] | undefined {
  const out: Logical[] = [];
  let depth = 0;
  let quote = "";
  let cur: Logical | undefined;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!cur) {
      const t = l.trimStart();
      if (t === "" || t.startsWith("#")) continue;
      cur = { first: i, last: i, indent: l.length - t.length, text: l, colon: false };
    } else {
      cur.text += "\n" + l;
      cur.last = i;
    }
    let cont = false;
    let last = "";
    for (let j = 0; j < l.length; j++) {
      const ch = l[j]!;
      if (quote) {
        last = '"';
        if (ch === "\\") {
          if (j === l.length - 1) cont = true;
          j++;
        } else if (l.startsWith(quote, j)) {
          j += quote.length - 1;
          quote = "";
        }
        continue;
      }
      if (ch === "#") break;
      if (ch.trim()) last = ch;
      if (ch === '"' || ch === "'") {
        quote = l.startsWith(ch.repeat(3), j) ? ch.repeat(3) : ch;
        j += quote.length - 1;
      } else if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) {
        if (--depth < 0) return undefined;
      } else if (ch === "\\" && j === l.length - 1) cont = true;
    }
    if (quote.length === 1 && !cont) return undefined;
    if (quote || depth > 0 || cont) continue;
    cur.colon = last === ":";
    out.push(cur);
    cur = undefined;
  }
  return cur ? undefined : out;
}

/** Index just past the suite of the compound statement at `p`. */
function suiteEnd(ll: Logical[], p: number): number {
  let q = p + 1;
  while (q < ll.length && ll[q]!.indent > ll[p]!.indent) q++;
  return q;
}

/** A literal with no names in it (tuples/dicts of strings): evaluating it has no effect. */
const inert = (rhs: string) => /^[\s(){}[\],:"]*$/.test(rhs.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""'));

const words = (s: string) => new Set(s.match(/[A-Za-z_]\w*/g) ?? []);

/** Could this logical line (re)bind `name`? Conservative. */
function rebinds(text: string, name: string): boolean {
  return new RegExp(
    String.raw`(?<![\w.])${name}\s*(?:\*\*|//|<<|>>|[-+*/%&|^@])?=(?!=)|(?<![\w.])${name}\s*:=|\b(?:global|nonlocal|del|import|as|for|class|def|lambda|case)\b[^\n]*\b${name}\b`,
  ).test(text);
}

interface Tarpit {
  from: number; // physical lines [from, to]
  to: number;
  stateLine: number;
  state: string;
  slot: string;
  names: string[];
  decoys: Set<string>;
}

/** Recognise BLA's emitted tarpit (`generatePythonTarpit`) exactly: state, slot, chaff table, decoys, warm-init and its call. */
function findTarpits(lines: string[], ll: Logical[]): Tarpit[] {
  const out: Tarpit[] = [];
  for (let c = 0; c < lines.length; c++) {
    if (lines[c] !== TARPIT_MARK) continue;
    let p = ll.findIndex((x) => x.first > c);
    const at = (q: number) => (ll[q]?.indent === 0 ? ll[q]!.text : "");
    const state = ll[p]?.first === c + 1 ? STATE_RE.exec(at(p))?.[1] : undefined;
    const slot = SLOT_RE.exec(at(p + 1))?.[1];
    const manifest = MANIFEST_RE.exec(at(p + 2));
    if (!state || !slot || !manifest || !inert(at(p + 2).slice(manifest[1]!.length + 3))) continue;
    const stateLine = ll[p]!.first;
    p += 3;
    const decoys: string[] = [];
    let d: RegExpExecArray | null;
    while ((d = DECOY_RE.exec(at(p)))) {
      const end = suiteEnd(ll, p);
      if (ll[end - 1]!.text !== `    return acc ^ (${slot}.get("epoch", 0) & 0xFFFF)`) break;
      decoys.push(d[1]!);
      p = end;
    }
    const warm = WARM_RE.exec(at(p))?.[1];
    if (!warm || !decoys.length) continue;
    const want = [
      "    acc = _seed & 0xFFFFFFFF",
      ...decoys.map((n, i) => `    acc ^= ${n}(acc ^ ${i + 1}, 0)`),
      `    ${slot}["warm"] = acc`,
      "    return acc",
    ];
    const end = suiteEnd(ll, p);
    if (end - p - 1 !== want.length || want.some((w, i) => ll[p + 1 + i]!.text !== w)) continue;
    if (at(end) !== `${warm}(${state} & 0xFF)`) continue;
    out.push({ from: c, to: ll[end]!.last, stateLine, state, slot, names: [state, slot, manifest[1]!, warm, ...decoys], decoys: new Set(decoys) });
  }
  return out;
}

/** Recognise BLA's inert canary/diagnostic honeypot block (`protectPythonSource` deceptionBlock). */
function findHoneypots(lines: string[], ll: Logical[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (let c = 0; c < lines.length; c++) {
    if (lines[c] !== HONEY_MARK) continue;
    const p = ll.findIndex((x) => x.first > c);
    const ok =
      p >= 0 &&
      HONEY_NAMES.every((n, i) => {
        const t = ll[p + i]?.text ?? "";
        return ll[p + i]?.indent === 0 && t.startsWith(`${n} = `) && inert(t.slice(n.length + 3));
      }) &&
      HONEY_TAIL.every((t, i) => ll[p + HONEY_NAMES.length + i]?.text === t);
    if (ok) out.push({ from: c, to: ll[p + HONEY_NAMES.length + HONEY_TAIL.length - 1]!.last });
  }
  return out;
}

/** Every compound header (logical line ending in ':') still has an indented suite. */
function suitesIntact(lines: string[]): boolean {
  const ll = logicalLines(lines);
  if (!ll) return false;
  return ll.every((x, i) => !x.colon || (ll[i + 1]?.indent ?? -1) > x.indent);
}

/**
 * Heal a BLA-hardened Python module. Cuts the interlocks first (sidecar digest
 * preamble, shared-slot touches and always-false guards woven into real
 * functions), then removes BLA's tarpit and honeypot blocks once no real code
 * refers to them. Only BLA's exact emitted shapes are touched; any other file is
 * returned byte-identical. Text-structural; never imports or runs the module.
 */
export const healPython: FormatHealer = (input) => {
  const findings = new Findings();
  const warnings: string[] = [];
  const unchanged = () => ({ output: input, findings, warnings, changed: false });
  const src = input.toString("utf8");
  if (!src.includes(TARPIT_MARK) && !src.includes(HONEY_MARK) && !src.includes("__bla_hashlib")) return unchanged();

  const bom = src.charCodeAt(0) === 0xfeff ? src[0]! : "";
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.slice(bom.length).split(/\r?\n/);
  const ll = logicalLines(lines);
  if (!ll) {
    warnings.push("Python tokenisation failed (unterminated string or bracket); BLA blocks left in place");
    return unchanged();
  }

  const drop = new Set<number>();
  const dropRange = (a: number, b: number, set = drop) => {
    for (let k = a; k <= b; k++) set.add(k);
  };
  /** Physical lines owned by BLA blocks: excluded from "real code". */
  const owned = new Set<number>();

  // 1. Interlock: the sidecar strip⇒fail preamble.
  let sidecar: { from: number; to: number; binding: string; hex: string } | undefined;
  for (const x of ll) {
    if (x.text !== "import hashlib as __bla_hashlib") continue;
    for (const v of SIDECARS) {
      const m = v.re.exec(lines.slice(x.first, x.first + v.n).join("\n"));
      if (m) sidecar = { from: x.first, to: x.first + v.n - 1, binding: m.groups!.B!, hex: m.groups!.H! };
    }
    if (sidecar) break;
  }
  if (sidecar) dropRange(sidecar.from, sidecar.to, owned);

  const tarpits = findTarpits(lines, ll);
  const honeys = findHoneypots(lines, ll);
  for (const b of [...tarpits, ...honeys]) dropRange(b.from, b.to, owned);
  if (!sidecar && !tarpits.length && !honeys.length) {
    warnings.push("BLA Python markers present but no block matched BLA's emitted shape; left in place");
    return unchanged();
  }

  // 2. Interlocks woven into real code: always-false guards (when the state is a never-rebound int) and slot touches.
  const provenStates = new Set(
    tarpits.filter((t) => !ll.some((x) => x.first !== t.stateLine && rebinds(x.text, t.state))).map((t) => t.state),
  );
  const guards = new Set<number>();
  let guardCount = 0;
  const touches = new Map<number, Tarpit>();
  for (let i = 0; i < ll.length; i++) {
    const x = ll[i]!;
    if (owned.has(x.first)) continue;
    const g = GUARD.exec(x.text);
    if (g && provenStates.has(g[1]!) && new RegExp(`^\\s*if ${p1(g[1]!)}:$`).test(x.text)) {
      const end = suiteEnd(ll, i);
      const next = ll[end];
      if (end > i + 1 && !(next?.indent === x.indent && /^\s*(elif|else)\b/.test(next.text))) {
        for (let q = i; q < end; q++) guards.add(q);
        guardCount++;
        i = end - 1;
      }
      continue;
    }
    const t = TOUCH_RE.exec(x.text);
    const tp = t && tarpits.find((tp) => tp.slot === t[1] && tp.decoys.has(t[2]!));
    if (tp) touches.set(i, tp);
  }

  // 3. Remove each block no remaining real code refers to. `_` is BLA's throwaway target, not a reference.
  const realWords = (skipTouchesOf: Set<Tarpit>) => {
    const w = new Set<string>();
    ll.forEach((x, i) => {
      if (owned.has(x.first) || guards.has(i) || (touches.has(i) && skipTouchesOf.has(touches.get(i)!))) return;
      for (const s of words(x.text)) w.add(s);
    });
    w.delete("_");
    return w;
  };
  let used = realWords(new Set(tarpits));
  const removedTarpits = new Set(tarpits.filter((t) => !t.names.some((n) => used.has(n))));
  for (const t of tarpits) {
    if (!removedTarpits.has(t)) warnings.push(`real code refers to BLA tarpit names (${t.names.filter((n) => used.has(n)).join(", ")}); tarpit and its slot touches kept`);
  }
  used = realWords(removedTarpits);
  for (const t of tarpits) if (!removedTarpits.has(t)) for (const n of t.names) used.add(n);
  const removedHoneys = honeys.filter(() => !HONEY_NAMES.some((n) => used.has(n)) && !used.has("probe_canary_honeypot"));
  if (removedHoneys.length < honeys.length) warnings.push("real code refers to BLA honeypot names; honeypot block kept");

  for (const t of removedTarpits) {
    dropRange(t.from, t.to);
    for (const [i, tp] of touches) if (tp === t) dropRange(ll[i]!.first, ll[i]!.last);
  }
  for (const h of removedHoneys) dropRange(h.from, h.to);
  for (const i of guards) dropRange(ll[i]!.first, ll[i]!.last);
  // Separator blank lines BLA added after each removed block.
  for (const b of [...removedTarpits, ...removedHoneys]) for (let k = b.to + 1; k < lines.length && lines[k]!.trim() === ""; k++) drop.add(k);

  let replaced: string | undefined;
  if (sidecar) {
    dropRange(sidecar.from, sidecar.to);
    // Referenced elsewhere: pin the binding to its intact-state value (the protect-time digest prefix).
    if (used.has(sidecar.binding)) replaced = `${sidecar.binding} = 0x${sidecar.hex.slice(0, 8)}`;
  }

  const out: string[] = [];
  lines.forEach((l, k) => {
    if (sidecar && k === sidecar.from && replaced) out.push(replaced);
    if (!drop.has(k)) out.push(l);
  });
  if (!suitesIntact(out)) {
    warnings.push("removing BLA blocks would leave an empty Python suite; file left unchanged");
    return unchanged();
  }

  const touchCount = [...touches.values()].filter((t) => removedTarpits.has(t)).length;
  if (sidecar) findings.add("entangle", "python-sidecar-interlock", "cut BLA's sidecar digest preamble (strip-or-alter-then-raise interlock)");
  if (touchCount) findings.add("entangle", "python-weave-touch", "removed BLA's shared-slot touches woven into real functions", touchCount);
  if (guardCount) findings.add("tarpit", "python-opaque-guard", "removed blocks guarded by BLA's always-false Python tarpit predicate", guardCount);
  if (removedTarpits.size) findings.add("deceive", "python-tarpit-prelude", "removed BLA's Python tarpit: decoy functions, chaff table, private state and warm-init", [...removedTarpits].reduce((n, t) => n + t.decoys.size, 0));
  if (removedHoneys.length) findings.add("deceive", "python-honeypot-block", "removed BLA's inert canary / diagnostic honeypot block", removedHoneys.length);
  if (!findings.size) return unchanged();
  return { output: Buffer.from(bom + out.join(eol), "utf8"), findings, warnings, changed: true };
};
