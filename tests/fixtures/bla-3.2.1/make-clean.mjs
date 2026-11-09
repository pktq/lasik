// Builds one small, clean sample per format into <out>. Usage: node make-samples.mjs <out> <bla-clone>
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateRawSync } from "node:zlib";

const [out, bla] = process.argv.slice(2);
mkdirSync(join(out, "dist"), { recursive: true });
const D = (f) => join(out, "dist", f);

// JS / TS / Python from BLA's own examples
for (const [src, dst] of [
  ["examples/dx-ball-sound-pan/sound-pan.js", "sound-pan.js"],
  ["examples/notion-electron-bridge/electron-bridge.js", "electron-bridge.js"],
  ["examples/enterprise-license-guard/license-validator.ts", "license-validator.ts"],
  ["examples/python-offline-engine/pricing_engine.py", "pricing_engine.py"],
]) copyFileSync(join(bla, src), D(dst));

writeFileSync(D("index.html"), `<!doctype html><html><head><title>demo</title></head><body>
<script>function total(items){let s=0;for(const i of items)s+=i.price*i.qty;return s}
document.title='Total '+total([{price:3,qty:2},{price:5,qty:1}]);</script></body></html>\n`);
writeFileSync(D("app.js.map"), JSON.stringify({ version: 3, file: "app.js", sources: ["src/app.ts"], names: [], mappings: "AAAA" }));

// WebAssembly: (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
writeFileSync(D("add.wasm"), Buffer.from("0061736d0100000001070160027f7f017f030201000707010361646400000a09010700200020016a0b", "hex"));

// ASAR with one JS file
{
  const js = Buffer.from("module.exports = function greet(n){ return 'hi ' + n; };\n");
  const root = { files: { "main.js": { size: js.length, offset: "0" } } };
  const json = Buffer.from(JSON.stringify(root));
  const aligned = Math.ceil(json.length / 4) * 4;
  const h = Buffer.alloc(16 + aligned);
  h.writeUInt32LE(4, 0); h.writeUInt32LE(aligned + 8, 4); h.writeUInt32LE(aligned + 4, 8); h.writeUInt32LE(json.length, 12);
  json.copy(h, 16);
  writeFileSync(D("app.asar"), Buffer.concat([h, js]));
}

// SQLite
{
  const db = new DatabaseSync(D("local.sqlite"));
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, plan TEXT); INSERT INTO users(name,plan) VALUES('ada','pro'),('lin','free');");
  db.close();
}

// safetensors: one f32 tensor [2]
{
  const header = Buffer.from(JSON.stringify({ w: { dtype: "F32", shape: [2], data_offsets: [0, 8] } }));
  const padded = Buffer.concat([header, Buffer.alloc((8 - (header.length % 8)) % 8, 0x20)]);
  const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(padded.length));
  const data = Buffer.alloc(8); data.writeFloatLE(1.5, 0); data.writeFloatLE(-2, 4);
  writeFileSync(D("model.safetensors"), Buffer.concat([len, padded, data]));
}

// GGUF v3, two string KVs, no tensors
{
  const str = (s) => { const b = Buffer.from(s); const l = Buffer.alloc(8); l.writeBigUInt64LE(BigInt(b.length)); return Buffer.concat([l, b]); };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const kv = (k, v) => Buffer.concat([str(k), u32(8), str(v)]);
  writeFileSync(D("tiny.gguf"), Buffer.concat([Buffer.from("GGUF"), u32(3), u64(0), u64(2), kv("general.architecture", "llama"), kv("general.name", "tiny")]));
}

// PCAP: two UDP packets
{
  const gh = Buffer.alloc(24);
  gh.writeUInt32LE(0xa1b2c3d4, 0); gh.writeUInt16LE(2, 4); gh.writeUInt16LE(4, 6); gh.writeUInt32LE(65535, 16); gh.writeUInt32LE(1, 20);
  const pkt = (payload, t) => {
    const p = Buffer.from(payload);
    const eth = Buffer.from("ffffffffffff0011223344550800", "hex");
    const ip = Buffer.from("450000000000400040110000c0a80001c0a80002", "hex");
    ip.writeUInt16BE(28 + p.length, 2);
    const udp = Buffer.alloc(8); udp.writeUInt16BE(54321, 0); udp.writeUInt16BE(53, 2); udp.writeUInt16BE(8 + p.length, 4);
    const frame = Buffer.concat([eth, ip, udp, p]);
    const rh = Buffer.alloc(16); rh.writeUInt32LE(t, 0); rh.writeUInt32LE(frame.length, 8); rh.writeUInt32LE(frame.length, 12);
    return Buffer.concat([rh, frame]);
  };
  writeFileSync(D("capture.pcap"), Buffer.concat([gh, pkt("hello", 1), pkt("world", 2)]));
}

// Apple plist (XML)
writeFileSync(D("Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleIdentifier</key>
\t<string>com.example.demo</string>
\t<key>CFBundleVersion</key>
\t<string>1.0</string>
</dict>
</plist>
`);

// UF2: two 256-byte payload blocks for a fake RP2040 image
{
  const blocks = [0, 1].map((i) => {
    const b = Buffer.alloc(512);
    b.writeUInt32LE(0x0a324655, 0); b.writeUInt32LE(0x9e5d5157, 4); b.writeUInt32LE(0x2000, 8);
    b.writeUInt32LE(0x10000000 + i * 256, 12); b.writeUInt32LE(256, 16); b.writeUInt32LE(i, 20); b.writeUInt32LE(2, 24); b.writeUInt32LE(0xe48bff56, 28);
    b.fill(0x11 + i, 32, 288); b.writeUInt32LE(0x0ab16f30, 508);
    return b;
  });
  writeFileSync(D("firmware.uf2"), Buffer.concat(blocks));
}

// GPU PTX
writeFileSync(D("kernel.ptx"), `.version 7.0
.target sm_80
.address_size 64

.visible .entry scale(.param .u64 p, .param .f32 k)
{
\t.reg .b64 %rd<2>;
\t.reg .f32 %f<3>;
\tld.param.u64 %rd1, [p];
\tld.param.f32 %f1, [k];
\tld.global.f32 %f2, [%rd1];
\tmul.f32 %f2, %f2, %f1;
\tst.global.f32 [%rd1], %f2;
\tret;
}
`);

// EVM runtime bytecode (tiny storage setter) as raw bytes
writeFileSync(D("contract.evm"), Buffer.from("6080604052348015600f57600080fd5b50602a60005500", "hex"));

// Plain ZIP archive (stored)
{
  const name = Buffer.from("readme.txt"), body = Buffer.from("plain archive\n");
  const crc = crc32(body);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(body.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(body.length, 24); cd.writeUInt16LE(name.length, 28);
  const local = Buffer.concat([lh, name, body]), central = Buffer.concat([cd, name]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length, 16);
  writeFileSync(D("bundle.zip"), Buffer.concat([local, central, eocd]));
}
void deflateRawSync;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
console.log("ok");
