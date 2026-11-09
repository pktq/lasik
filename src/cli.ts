#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { run } from "./engine/run.js";
import { renderMarkdown, renderText } from "./engine/render.js";
import { firewallText } from "./firewall/index.js";
import { EXPANSION, NAME, PACKAGE, TAGLINE, VERSION } from "./identity.js";
import { doctor, setup, type ClientId } from "./setup/index.js";

const HELP = `${NAME} ${VERSION} · ${EXPANSION}
${TAGLINE}

Usage
  lasik scan <path>            Detect BLA hardening and score how blinded an agent would be
  lasik heal <path> [-o dir]   Write a cleaned copy an agent (or REA) can read (default: <path>.lasik)
  lasik firewall [file|-]      Redact LLM-directed decoy text from any text (stdin with -)
  lasik bench <dir>            Heal every target under <dir> and print a before/after table
  lasik setup                  Register the LASIK MCP server with your coding agents
  lasik doctor                 Check Node, npx, agent registrations and REA
  lasik mcp                    Run the MCP server on stdio

Options
  --json                 Machine-readable report
  --md                   Markdown report
  -o, --out <dir>        Output directory for heal
  --aggressive           Also fold predicates proven only by sampling, and shake files without BLA fingerprints
  --no-firewall          Don't run the prompt firewall
  --strict-firewall      Redact every prompt-decoy match, even in runtime strings (read view; may change behaviour)
  --no-rename            Keep BLA's renamed module handles
  --fail-on <level>      Exit 3 when the verdict is at least <suspected|blinded> (for CI)
  --client <id>          setup: only this client (repeatable): claude-code, claude-desktop, cursor, codex,
                         gemini-cli, windsurf, antigravity, vscode, copilot-cli, opencode
  --dry-run              setup: show what would change
  --remove               setup: unregister

LASIK never executes the code it reads. Use it on software you own or are authorised to analyse.
`;

interface Args {
  cmd: string;
  pos: string[];
  flags: Map<string, string[]>;
}

function parse(argv: string[]): Args {
  const flags = new Map<string, string[]>();
  const pos: string[] = [];
  const valued = new Set(["-o", "--out", "--fail-on", "--client"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("-") && a !== "-") {
      const [k, inline] = a.split("=", 2) as [string, string | undefined];
      const v = inline ?? (valued.has(k) ? argv[++i] ?? "" : "true");
      flags.set(k, [...(flags.get(k) ?? []), v]);
    } else pos.push(a);
  }
  return { cmd: pos.shift() ?? "help", pos, flags };
}

const has = (a: Args, ...k: string[]) => k.some((x) => a.flags.has(x));
const get = (a: Args, ...k: string[]) => k.map((x) => a.flags.get(x)?.[0]).find((v) => v !== undefined);

function report(a: Args, mode: "scan" | "heal"): number {
  const target = a.pos[0];
  if (!target) {
    process.stderr.write(`usage: lasik ${mode} <path>\n`);
    return 2;
  }
  const r = run(target, mode, {
    outDir: get(a, "-o", "--out"),
    aggressive: has(a, "--aggressive"),
    firewall: has(a, "--no-firewall") ? false : has(a, "--strict-firewall") ? "strict" : "safe",
    rename: !has(a, "--no-rename"),
  });
  if (has(a, "--json")) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  else if (has(a, "--md")) process.stdout.write(renderMarkdown(r));
  else process.stdout.write(renderText(r, process.stdout.isTTY) + "\n");
  const failOn = get(a, "--fail-on");
  const rank = { clean: 0, suspected: 1, blinded: 2 } as const;
  if (failOn && failOn in rank && rank[r.verdict] >= rank[failOn as keyof typeof rank]) return 3;
  return 0;
}

function bench(a: Args): number {
  const dir = a.pos[0];
  if (!dir) {
    process.stderr.write("usage: lasik bench <dir>   (each subdirectory is one target)\n");
    return 2;
  }
  const r = run(dir, "scan", { aggressive: has(a, "--aggressive") });
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const rows = r.files.filter((f) => f.findings.length);
  const lines = [
    `| Artifact | Format | Before | After | Tokens before → after | Cheaper |`,
    `|---|---|---:|---:|---:|---:|`,
    ...rows.map(
      (f) =>
        `| \`${f.file.replace(/\\/g, "/")}\` | ${f.format} | ${kb(f.bytesBefore)} | ${kb(f.bytesAfter)} | ` +
        `${f.tokensBefore.toLocaleString("en-US")} → ${f.tokensAfter.toLocaleString("en-US")} | ${(f.tokensBefore / Math.max(1, f.tokensAfter)).toFixed(1)}× |`,
    ),
    `| **Total** | | **${kb(r.totals.bytesBefore)}** | **${kb(r.totals.bytesAfter)}** | ` +
      `**${r.totals.tokensBefore.toLocaleString("en-US")} → ${r.totals.tokensAfter.toLocaleString("en-US")}** | ` +
      `**${(r.totals.tokensBefore / Math.max(1, r.totals.tokensAfter)).toFixed(1)}×** |`,
  ];
  process.stdout.write((has(a, "--json") ? JSON.stringify(r, null, 2) : lines.join("\n")) + "\n");
  return 0;
}

function firewall(a: Args): number {
  const src = a.pos[0] ?? "-";
  const text = src === "-" ? readFileSync(0, "utf8") : readFileSync(src, "utf8");
  const r = firewallText(text);
  process.stdout.write(r.text);
  if (r.redactions) process.stderr.write(`${NAME}: redacted ${r.redactions} decoy span(s): ${r.hits.map((h) => `${h.rule}×${h.count}`).join(", ")}\n`);
  return 0;
}

async function main(): Promise<number> {
  const a = parse(process.argv.slice(2));
  if (has(a, "--version", "-v") || a.cmd === "version") {
    process.stdout.write(`${PACKAGE} ${VERSION}\n`);
    return 0;
  }
  switch (a.cmd) {
    case "scan":
      return report(a, "scan");
    case "heal":
    case "see":
      return report(a, "heal");
    case "firewall":
      return firewall(a);
    case "bench":
      return bench(a);
    case "setup": {
      const res = setup({ clients: a.flags.get("--client") as ClientId[] | undefined, dryRun: has(a, "--dry-run"), remove: has(a, "--remove") });
      for (const x of res) process.stdout.write(`${x.status.padEnd(22)} ${x.client.padEnd(15)} ${x.configPath}${x.detail ? `  (${x.detail})` : ""}\n`);
      return res.some((x) => x.status === "error") ? 1 : 0;
    }
    case "doctor": {
      const res = doctor();
      for (const x of res) process.stdout.write(`${x.ok ? "ok  " : "FAIL"}  ${x.check}: ${x.detail}\n`);
      return res.every((x) => x.ok) ? 0 : 1;
    }
    case "mcp": {
      const { startMcpServer } = await import("./mcp/server.js");
      await startMcpServer();
      return -1; // keep running
    }
    case "help":
    default:
      process.stdout.write(HELP);
      return a.cmd === "help" ? 0 : 2;
  }
}

main().then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`${NAME}: ${(err as Error).stack ?? String(err)}\n`);
    process.exitCode = 1;
  },
);
