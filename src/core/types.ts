/** The BLA defence layer a finding belongs to. */
export type Layer =
  | "encrypt" // string encryption / literal hiding
  | "tarpit" // opaque predicates, unreachable exhaustion graphs
  | "deceive" // decoy logic, honey data, fake manifests
  | "exhaust" // padding and floods aimed at analyser budgets
  | "entangle" // digest interlocks binding decoys to real code
  | "runtime" // debugger / instrumentation detection
  | "prompt"; // text aimed at the model reading the code

export type Format =
  | "javascript"
  | "html"
  | "sourcemap"
  | "wasm"
  | "asar"
  | "sqlite"
  | "python"
  | "json"
  | "safetensors"
  | "gguf"
  | "unknown";

export interface Finding {
  layer: Layer;
  technique: string;
  detail: string;
  count: number;
}

export interface FileReport {
  file: string;
  format: Format;
  bytesBefore: number;
  bytesAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  findings: Finding[];
  warnings: string[];
  /** True when LASIK changed the artifact. */
  healed: boolean;
  /** Where the healed artifact was written (heal only). */
  output?: string;
}

export interface Report {
  tool: string;
  version: string;
  mode: "scan" | "heal";
  target: string;
  files: FileReport[];
  totals: {
    files: number;
    blinded: number;
    findings: number;
    bytesBefore: number;
    bytesAfter: number;
    tokensBefore: number;
    tokensAfter: number;
  };
  /** 0 = clean, 100 = heavily BLA-hardened. Based on findings, not on file size. */
  blindness: number;
  verdict: "clean" | "suspected" | "blinded";
  /** Distinct AI-evasion techniques found (`layer/technique`): a risk signal. */
  evasion: string[];
}

/** Collects findings while a file is processed. */
export class Findings {
  private readonly map = new Map<string, Finding>();

  add(layer: Layer, technique: string, detail: string, count = 1): void {
    if (count <= 0) return;
    const key = `${layer}:${technique}`;
    const prev = this.map.get(key);
    if (prev) prev.count += count;
    else this.map.set(key, { layer, technique, detail, count });
  }

  list(): Finding[] {
    return [...this.map.values()];
  }

  get size(): number {
    return this.map.size;
  }
}
