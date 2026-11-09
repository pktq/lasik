import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { doctor, listClients, setup } from "../src/setup/index.js";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "lasik-setup-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

const o = (extra: object = {}) => ({ home, platform: "linux" as const, env: {}, ...extra });
const put = (rel: string, text: string) => { const p = join(home, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return p; };
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("setup", () => {
  it("adds, is idempotent, updates, removes (JSON client)", () => {
    const p = put(".cursor/mcp.json", JSON.stringify({ other: 1, mcpServers: { x: { command: "y" } } }));
    expect(setup(o({ clients: ["cursor"] }))[0]!.status).toBe("added");
    expect(json(p)).toEqual({ other: 1, mcpServers: { x: { command: "y" }, lasik: { command: "npx", args: ["-y", "lasik-agents", "mcp"] } } });
    expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
    expect(setup(o({ clients: ["cursor"] }))[0]!.status).toBe("unchanged");
    const d = json(p); d.mcpServers.lasik.args = ["old"]; writeFileSync(p, JSON.stringify(d));
    expect(setup(o({ clients: ["cursor"] }))[0]!.status).toBe("updated");
    expect(setup(o({ clients: ["cursor"], remove: true }))[0]!.status).toBe("updated");
    expect(json(p)).toEqual({ other: 1, mcpServers: { x: { command: "y" } } });
    expect(setup(o({ clients: ["cursor"], remove: true }))[0]!.status).toBe("unchanged");
  });

  it("uses the right shape for VS Code, OpenCode, Copilot", () => {
    setup(o({ clients: ["vscode", "opencode", "copilot-cli"] }));
    expect(json(join(home, ".config/Code/User/mcp.json")).servers.lasik).toEqual({ type: "stdio", command: "npx", args: ["-y", "lasik-agents", "mcp"] });
    expect(json(join(home, ".config/opencode/opencode.json")).mcp.lasik).toEqual({ type: "local", command: ["npx", "-y", "lasik-agents", "mcp"], enabled: true });
    expect(json(join(home, ".copilot/mcp-config.json")).mcpServers.lasik.tools).toEqual(["*"]);
  });

  it("appends and replaces Codex TOML, preserving other tables", () => {
    const p = put(".codex/config.toml", 'model = "x"\n\n[mcp_servers.other]\ncommand = "o"\n');
    expect(setup(o({ clients: ["codex"] }))[0]!.status).toBe("added");
    let t = readFileSync(p, "utf8");
    expect(t).toContain('model = "x"');
    expect(t).toContain('[mcp_servers.lasik]\ncommand = "npx"\nargs = ["-y", "lasik-agents", "mcp"]');
    expect(setup(o({ clients: ["codex"] }))[0]!.status).toBe("unchanged");
    writeFileSync(p, '[mcp_servers.lasik]\ncommand = "old"\n\n[mcp_servers.other]\ncommand = "o"\n');
    expect(setup(o({ clients: ["codex"] }))[0]!.status).toBe("updated");
    t = readFileSync(p, "utf8");
    expect(t).not.toContain("old");
    expect(t).toContain('[mcp_servers.other]\ncommand = "o"');
    expect(t.match(/\[mcp_servers\.lasik\]/g)).toHaveLength(1);
    setup(o({ clients: ["codex"], remove: true }));
    expect(readFileSync(p, "utf8")).toBe('[mcp_servers.other]\ncommand = "o"\n');
  });

  it("errors on invalid JSON without writing; makes backups", () => {
    const p = put(".cursor/mcp.json", "{ nope");
    const r = setup(o({ clients: ["cursor"] }))[0]!;
    expect(r.status).toBe("error");
    expect(readFileSync(p, "utf8")).toBe("{ nope");
    expect(existsSync(p + ".lasik.bak")).toBe(false);
    writeFileSync(p, '{"a":1}');
    const ok = setup(o({ clients: ["cursor"] }))[0]!;
    expect(ok.backup).toBe(p + ".lasik.bak");
    expect(readFileSync(p + ".lasik.bak", "utf8")).toBe('{"a":1}');
    expect(readdirSync(dirname(p)).some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("dryRun writes nothing; skips not-installed unless explicit", () => {
    put(".cursor/mcp.json", "{}");
    const r = setup(o({ dryRun: true }));
    expect(r.find((a) => a.client === "cursor")!.status).toBe("added");
    expect(r.find((a) => a.client === "windsurf")!.status).toBe("skipped-not-installed");
    expect(readFileSync(join(home, ".cursor/mcp.json"), "utf8")).toBe("{}");
    expect(existsSync(join(home, ".codeium"))).toBe(false);
    setup(o());
    expect(existsSync(join(home, ".codeium"))).toBe(false);
    expect(listClients(o()).find((c) => c.id === "cursor")!.installed).toBe(true);
  });

  it("doctor reports registration and rea as info", () => {
    setup(o({ clients: ["cursor"] }));
    const d = doctor(o());
    expect(d.find((c) => c.check === "client:cursor")!.ok).toBe(true);
    expect(d.find((c) => c.check === "client:codex")!.ok).toBe(false);
    expect(d.find((c) => c.check === "rea")!.ok).toBe(true);
    expect(d.find((c) => c.check === "node")).toBeDefined();
  });
});
