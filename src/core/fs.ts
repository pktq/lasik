import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", ".lasik-out"]);

/** Every file under `target` (or `target` itself), skipping VCS and dependency dirs. */
export function walk(target: string): string[] {
  const root = resolve(target);
  const st = statSync(root);
  if (st.isFile()) return [root];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(p);
      } else if (entry.isFile()) out.push(p);
    }
  }
  return out.sort();
}

/** Output path for `file` inside `outDir`, refusing anything that escapes it. */
export function outputPathFor(root: string, file: string, outDir: string): string {
  const base = statSync(root).isFile() ? resolve(root, "..") : resolve(root);
  const rel = relative(base, file);
  const dest = resolve(outDir, rel);
  const out = resolve(outDir);
  if (dest !== out && !dest.startsWith(out + sep)) throw new Error(`refusing to write outside ${out}: ${dest}`);
  return dest;
}
