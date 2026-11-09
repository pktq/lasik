import { Findings } from "../core/types.js";
import type { FormatHealer } from "./types.js";

// Classic libpcap magics read as LE: µs LE, ns LE, µs BE, ns BE.
const MAGIC_LE = new Set([0xa1b2c3d4, 0xa1b23c4d]);
const MAGIC_BE = new Set([0xd4c3b2a1, 0x4d3cb2a1]);
/** BLA's planted HTTP payload start and DNS bait marker (BLA pcap-capture.ts:119-123, 222-224). */
const HTTP_HEAD = Buffer.from("GET /bla/tarpit/exhaust HTTP/1.1\r\nHost: enclave.internal\r\nUser-Agent: BLA-PCAP-Shield/1.0\r\n[BLA-PCAP-SHIELD] canary=");
const DNS_BAIT = Buffer.from("\n[BLA-PCAP-SHIELD]\n");

/** pcapng is not covered: BLA v3.2.1 refuses it (pcap-capture.ts:189-198), so there is nothing to heal. */
export function isPcap(_file: string, head: Buffer): boolean {
  if (head.length < 24) return false;
  const m = head.readUInt32LE(0);
  return MAGIC_LE.has(m) || MAGIC_BE.has(m);
}

/**
 * Length of a BLA-planted record at `at`, or 0. BLA always writes LE record headers
 * and fixed Ethernet/IPv4 10.0.0.1 -> 10.0.0.2 frames (pcap-capture.ts:29-98).
 */
function plantedAt(b: Buffer, at: number): { len: number; kind: "http" | "dns" } | undefined {
  if (at + 16 > b.length) return undefined;
  const incl = b.readUInt32LE(at + 8);
  const f = at + 16;
  if (incl !== b.readUInt32LE(at + 12) || incl < 42 || f + incl > b.length) return undefined;
  for (let i = 0; i < 12; i++) if (b[f + i] !== 0) return undefined;
  if (b.readUInt16BE(f + 12) !== 0x0800 || b[f + 14] !== 0x45) return undefined;
  if (b.readUInt32BE(f + 26) !== 0x0a000001 || b.readUInt32BE(f + 30) !== 0x0a000002) return undefined;
  const proto = b[f + 23];
  const frame = b.subarray(f, f + incl);
  if (proto === 6 && frame.readUInt16BE(36) === 80 && frame.subarray(54, 54 + HTTP_HEAD.length).equals(HTTP_HEAD)) return { len: 16 + incl, kind: "http" };
  if (proto === 17 && frame.readUInt16BE(34) === 1337 && frame.readUInt16BE(36) === 53 && frame.readUInt16BE(42) === 0xb1a0 && frame.includes(DNS_BAIT, 50)) {
    return { len: 16 + incl, kind: "dns" };
  }
  return undefined;
}

/** Packet counts if everything from `at` to EOF is BLA-planted, else undefined. */
function plantedTail(b: Buffer, at: number): { http: number; dns: number } | undefined {
  const n = { http: 0, dns: 0 };
  while (at < b.length) {
    const p = plantedAt(b, at);
    if (!p) return undefined;
    n[p.kind]++;
    at += p.len;
  }
  return n.http + n.dns > 0 ? n : undefined;
}

/** Drop the packets BLA appends to a classic libpcap capture. Original header and packets are kept byte-for-byte. */
export const healPcap: FormatHealer = (input) => {
  const none = { output: input, findings: new Findings(), warnings: [], changed: false };
  if (!isPcap("", input)) return none;
  const le = MAGIC_LE.has(input.readUInt32LE(0));
  let at = 24;
  while (at < input.length) {
    const tail = plantedAt(input, at) && plantedTail(input, at);
    if (tail) {
      const findings = new Findings();
      findings.add("exhaust", "pcap-dissector-flood", "removed BLA HTTP packets with nested X-BLA-Nested-* headers aimed at tshark JSON budgets", tail.http);
      findings.add("deceive", "pcap-canary-bait", "removed BLA deep-label DNS packets carrying canary / fake diagnostic text", tail.dns);
      return { output: input.subarray(0, at), findings, warnings: [], changed: true };
    }
    if (at + 16 > input.length) break;
    at += 16 + (le ? input.readUInt32LE(at + 8) : input.readUInt32BE(at + 8));
  }
  return none;
};
