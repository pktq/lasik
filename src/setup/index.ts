import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export type ClientId =
  | "claude-code" | "claude-desktop" | "cursor" | "codex" | "gemini-cli"
  | "windsurf" | "antigravity" | "vscode" | "copilot-cli" | "opencode";

export interface SetupAction {
  client: ClientId;
  configPath: string;
  status: "added" | "updated" | "unchanged" | "skipped-not-installed" | "error";
  detail?: string;
  backup?: string;
}

interface Ctx { home: string; platform: NodeJS.Platform; env: NodeJS.ProcessEnv }
interface Opts { home?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv }

const NAME = "lasik";
const COMMAND = "npx";
const ARGS = ["-y", "lasik-agents", "mcp"];

interface Client {
  id: ClientId;
  name: string;
  path: (c: Ctx) => string;
  /** root key holding servers; absent for TOML */
  key?: string;
  entry?: () => unknown;
  /** installed-detection dir; defaults to the config file's parent dir */
  marker?: (c: Ctx) => string;
}

const stdio = () => ({ type: "stdio", command: COMMAND, args: [...ARGS] });
const plain = () => ({ command: COMMAND, args: [...ARGS] });

const appData = (c: Ctx, sub: string): string =>
  c.platform === "win32" ? join(c.env.APPDATA ?? join(c.home, "AppData", "Roaming"), sub)
  : c.platform === "darwin" ? join(c.home, "Library", "Application Support", sub)
  : join(c.env.XDG_CONFIG_HOME ?? join(c.home, ".config"), sub);

const CLIENTS: Client[] = [
  // ~/.claude.json lives directly in home, so its parent dir proves nothing
  { id: "claude-code", name: "Claude Code", path: (c) => join(c.home, ".claude.json"), key: "mcpServers", entry: stdio, marker: (c) => join(c.home, ".claude") },
  { id: "claude-desktop", name: "Claude Desktop", path: (c) => appData(c, join("Claude", "claude_desktop_config.json")), key: "mcpServers", entry: plain },
  { id: "cursor", name: "Cursor", path: (c) => join(c.home, ".cursor", "mcp.json"), key: "mcpServers", entry: plain },
  { id: "codex", name: "Codex", path: (c) => join(c.home, ".codex", "config.toml") },
  { id: "gemini-cli", name: "Gemini CLI", path: (c) => join(c.home, ".gemini", "settings.json"), key: "mcpServers", entry: plain },
  { id: "windsurf", name: "Windsurf", path: (c) => join(c.home, ".codeium", "windsurf", "mcp_config.json"), key: "mcpServers", entry: plain },
  { id: "antigravity", name: "Antigravity", path: (c) => join(c.home, ".gemini", "antigravity", "mcp_config.json"), key: "mcpServers", entry: plain },
  { id: "vscode", name: "VS Code", path: (c) => appData(c, join("Code", "User", "mcp.json")), key: "servers", entry: stdio },
  { id: "copilot-cli", name: "Copilot CLI", path: (c) => join(c.home, ".copilot", "mcp-config.json"), key: "mcpServers", entry: () => ({ ...plain(), tools: ["*"] }) },
  { id: "opencode", name: "OpenCode", path: (c) => join(c.home, ".config", "opencode", "opencode.json"), key: "mcp", entry: () => ({ type: "local", command: [COMMAND, ...ARGS], enabled: true }) },
];

function ctx(o: Opts = {}): Ctx {
  return { home: o.home ?? homedir(), platform: o.platform ?? process.platform, env: o.env ?? process.env };
}

function isInstalled(cl: Client, c: Ctx): boolean {
  const p = cl.path(c);
  return existsSync(p) || existsSync(cl.marker ? cl.marker(c) : dirname(p));
}

export function listClients(o: Opts = {}): { id: ClientId; name: string; configPath: string; installed: boolean }[] {
  const c = ctx(o);
  return CLIENTS.map((cl) => ({ id: cl.id, name: cl.name, configPath: cl.path(c), installed: isInstalled(cl, c) }));
}

type Edit = { status: "added" | "updated" | "unchanged"; next: string } | { error: string };

const CODEX_HEADER = /^\[mcp_servers\.(?:lasik|"lasik")\]\s*$/;
const CODEX_BLOCK = `[mcp_servers.${NAME}]\ncommand = "${COMMAND}"\nargs = [${ARGS.map((a) => `"${a}"`).join(", ")}]\n`;

function editToml(text: string, remove: boolean): Edit {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => CODEX_HEADER.test(l.trim()));
  if (start < 0) {
    if (remove) return { status: "unchanged", next: text };
    const sep = text === "" || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return { status: "added", next: text + sep + CODEX_BLOCK };
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
  const old = lines.slice(start, end).join("\n").trim();
  const before = lines.slice(0, start).join("\n") + (start ? "\n" : "");
  const after = lines.slice(end).join("\n");
  if (remove) return { status: "updated", next: (before + after).replace(/\n{3,}/g, "\n\n") };
  if (old === CODEX_BLOCK.trim()) return { status: "unchanged", next: text };
  return { status: "updated", next: before + CODEX_BLOCK + (after ? "\n" + after : "") };
}

function editJson(cl: Client, text: string | undefined, remove: boolean): Edit {
  let root: Record<string, unknown> = {};
  if (text !== undefined && text.trim() !== "") {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (e) { return { error: `invalid JSON: ${(e as Error).message}` }; }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { error: "config root is not a JSON object" };
    root = parsed as Record<string, unknown>;
  }
  const key = cl.key!;
  const cur = root[key];
  if (cur !== undefined && (typeof cur !== "object" || cur === null || Array.isArray(cur))) return { error: `"${key}" is not an object` };
  const servers = (cur ?? {}) as Record<string, unknown>;
  const had = NAME in servers;
  const want = cl.entry!();
  if (remove) {
    if (!had) return { status: "unchanged", next: text ?? "" };
    delete servers[NAME];
  } else {
    if (had && JSON.stringify(servers[NAME]) === JSON.stringify(want)) return { status: "unchanged", next: text ?? "" };
    servers[NAME] = want;
  }
  root[key] = servers;
  return { status: remove || had ? "updated" : "added", next: JSON.stringify(root, null, 2) + "\n" };
}

function compute(cl: Client, path: string, remove: boolean): { edit: Edit; existed: boolean } {
  const existed = existsSync(path);
  let text: string | undefined;
  if (existed) {
    try { text = readFileSync(path, "utf8"); } catch (e) { return { edit: { error: `cannot read: ${(e as Error).message}` }, existed }; }
  }
  return { edit: cl.key ? editJson(cl, text, remove) : editToml(text ?? "", remove), existed };
}

export function setup(o: Opts & { clients?: ClientId[]; dryRun?: boolean; remove?: boolean } = {}): SetupAction[] {
  const c = ctx(o);
  const explicit = o.clients !== undefined;
  return CLIENTS.filter((cl) => !explicit || o.clients!.includes(cl.id)).map((cl): SetupAction => {
    const configPath = cl.path(c);
    if (!explicit && !isInstalled(cl, c)) return { client: cl.id, configPath, status: "skipped-not-installed" };
    const { edit, existed } = compute(cl, configPath, !!o.remove);
    if ("error" in edit) return { client: cl.id, configPath, status: "error", detail: edit.error };
    if (edit.status === "unchanged") return { client: cl.id, configPath, status: "unchanged" };
    if (o.dryRun) return { client: cl.id, configPath, status: edit.status, detail: "dry run" };
    try {
      let backup: string | undefined;
      mkdirSync(dirname(configPath), { recursive: true });
      if (existed) { backup = configPath + ".lasik.bak"; copyFileSync(configPath, backup); }
      const tmp = `${configPath}.lasik.${process.pid}.tmp`;
      writeFileSync(tmp, edit.next);
      renameSync(tmp, configPath);
      return { client: cl.id, configPath, status: edit.status, ...(backup ? { backup } : {}) };
    } catch (e) {
      return { client: cl.id, configPath, status: "error", detail: (e as Error).message };
    }
  });
}

function onPath(bin: string, c: Ctx): boolean {
  const win = c.platform === "win32";
  const exts = win ? (c.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").concat("") : [""];
  return (c.env.PATH ?? c.env.Path ?? "").split(win ? ";" : delimiter)
    .some((d) => d && exts.some((x) => existsSync(join(d, bin + x))));
}

export function doctor(o: Opts = {}): { check: string; ok: boolean; detail: string }[] {
  const c = ctx(o);
  const out: { check: string; ok: boolean; detail: string }[] = [];
  const [maj = 0, min = 0] = process.versions.node.split(".").map(Number);
  out.push({ check: "node", ok: maj > 20 || (maj === 20 && min >= 19), detail: `v${process.versions.node} (need >= 20.19)` });
  const npx = onPath("npx", c);
  out.push({ check: "npx", ok: npx, detail: npx ? "found on PATH" : "not found on PATH" });
  for (const cl of CLIENTS) {
    const p = cl.path(c);
    const e = existsSync(p) ? compute(cl, p, false).edit : undefined;
    const reg = !!e && !("error" in e) && e.status === "unchanged";
    out.push({ check: `client:${cl.id}`, ok: reg, detail: reg ? `registered (${p})` : e && "error" in e ? `unreadable: ${e.error}` : `not registered (${p})` });
  }
  const rea = onPath("rea", c);
  out.push({ check: "rea", ok: true, detail: rea ? "rea CLI found on PATH" : "rea CLI not on PATH (optional; LASIK pairs with REA)" });
  return out;
}
