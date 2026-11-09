<p align="center"><a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.es.md">Español</a></p>

<div align="center">

<img src="../assets/banner.svg" alt="LASIK: LLM Agent Sight In Kode" width="100%" />

# LASIK

### BLA ciega a tu agente. LASIK le devuelve la vista.

**LLM Agent Sight In Kode**: un motor estático de desofuscación, CLI y servidor MCP que elimina
el endurecimiento de [BLA](https://github.com/qybaihe/bla) (Blind LLM Agents) para que los agentes de programación y
[REA](https://github.com/morluto/rea) puedan volver a leer el programa real.

[![npm](https://img.shields.io/npm/v/lasik-agents?color=0b7285&label=npm)](https://www.npmjs.com/package/lasik-agents)
[![CI](https://github.com/pktq/lasik/actions/workflows/ci.yml/badge.svg)](https://github.com/pktq/lasik/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.19-339933)](../../package.json)
[![MCP](https://img.shields.io/badge/MCP-server-7c3aed)](#-servidor-mcp)
[![Never runs the target](https://img.shields.io/badge/executes%20target%20code-never-success)](#-modelo-de-seguridad)

</div>

---

**REA** enseñó a los agentes a hacer ingeniería inversa de cualquier cosa. **BLA** respondió envenenando las versiones hasta que esos agentes quedan en bancarrota: trampas de predicados opacos, cadenas cifradas con XOR, código señuelo de "enclave", interbloqueos anti-strip, autosellos, rellenos de WebAssembly de 7 MB y texto escrito para que el modelo se niegue a continuar.

**LASIK** es la cirugía correctiva. Demuestra que los predicados de BLA son constantes, descifra lo que ocultó, corta sus interbloqueos, elimina sus señuelos y censura su cebo de prompts, **sin ejecutar nunca el objetivo**. Después, tu agente lee lo que el programa realmente hace.

<p align="center"><img src="../assets/flow.svg" alt="Una versión endurecida por BLA pasa por lasik heal y después un agente o REA lee la lógica real" width="100%" /></p>

> [!IMPORTANT]
> **Uso defensivo y autorizado.** LASIK lee código endurecido de forma estática y nunca lo ejecuta. Úsalo en software propio, muestras de malware y amenazas, CTF y código que estés autorizado a auditar. Consulta [DISCLAIMER.md](../../DISCLAIMER.md).

## 👓 Antes / después

Antes y después en el CrackMe v6 de BLA:

<p align="center"><img src="../assets/before-after.svg" alt="Fragmento endurecido por BLA de vault.cjs del CrackMe v6 (164 KB) junto a la lógica sanada (5,5 KB)" width="100%" /></p>

Y en todo el corpus de CrackMes de BLA:

<img src="../assets/scan.svg" alt="lasik scan on BLA's CrackMe corpus: blindness 100/100, 21.1M tokens down to 22k" width="100%" />

## ⚡ Inicio rápido en 30 segundos

```bash
# 1. How blind would an agent be?
npx lasik-agents scan ./dist

# 2. Write a cleaned copy next to it (./dist.lasik)
npx lasik-agents heal ./dist

# 3. Point REA (or any coding agent) at the healed copy
npx -y rea-agents@latest analyze-javascript-application "$PWD/dist.lasik" --json
```

Dale a cada agente de programación de tu máquina las herramientas de LASIK (Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, Windsurf, Antigravity, VS Code, Copilot CLI, OpenCode):

```bash
npx lasik-agents setup          # --dry-run to preview, --remove to undo
```

Requiere Node.js ≥ 20.19. Sin dependencias nativas, sin llamadas de red.

## 📊 Resultados en los CrackMes del propio BLA

El corpus de referencia son las salidas publicadas de los CrackMes de BLA v6–v9 (MIT, incluidas sin modificar en [`bench/bla-crackme`](../../bench/bla-crackme)), endurecidas por los propios mantenedores de BLA con la intensidad `bankrupt`. Reprodúcelo con `npm run build && node dist/cli.js bench bench/bla-crackme`.

<p align="center"><img src="../assets/tokens.svg" alt="Gráfico de barras en escala logarítmica: tokens estimados por artefacto CrackMe de BLA antes y después, de 21,1 M a 22 k en total" width="100%" /></p>

<details>
<summary><b>Tabla por artefacto (tamaños, tokens, factores)</b></summary>

| Artefacto | Formato | Antes | Después | Tokens antes → después | Más barato |
|---|---|---:|---:|---:|---:|
| `v6/core.wasm.gz` | wasm | 17.7 KB | 0.1 KB | 6,880,354 → 98 | 70207.7× |
| `v6/panel.html` | html | 124.9 KB | 1.4 KB | 32,035 → 354 | 90.5× |
| `v6/vault.cjs` | javascript | 160.7 KB | 3.4 KB | 42,600 → 946 | 45.0× |
| `v7/cli/meridian.cjs` | javascript | 169.7 KB | 2.2 KB | 44,897 → 569 | 78.9× |
| `v7/core/expr.cjs` | javascript | 147.2 KB | 3.9 KB | 39,135 → 994 | 39.4× |
| `v7/core/license.cjs` | javascript | 169.4 KB | 5.9 KB | 44,823 → 1,524 | 29.4× |
| `v7/core/stats.cjs` | javascript | 125.2 KB | 0.6 KB | 33,515 → 154 | 217.6× |
| `v7/core/units.cjs` | javascript | 131.8 KB | 0.9 KB | 35,191 → 242 | 145.4× |
| `v8/core.wasm.gz` | wasm | 20.9 KB | 1.8 KB | 6,883,663 → 3,506 | 1963.4× |
| `v8/license.cjs` | javascript | 221.2 KB | 3.6 KB | 58,120 → 911 | 63.8× |
| `v8/panel.html` | html | 119.7 KB | 1.3 KB | 30,708 → 331 | 92.8× |
| `v9/core.wasm.gz` | wasm | 20.9 KB | 1.8 KB | 6,883,604 → 3,496 | 1969.0× |
| `v9/license.cjs` | javascript | 196.4 KB | 3.9 KB | 52,019 → 1,013 | 51.4× |
| `v9/panel.html` | html | 123.3 KB | 1.2 KB | 31,594 → 299 | 105.7× |
| `v9/policy.py` | python | 40.6 KB | 0.5 KB | 10,453 → 133 | 78.6× |
| **Total** | | **1.75 MB** | **37 KB** | **21.1 M → 17 k** | **1,262×** |

</details>

En todo el corpus, LASIK pliega **3,011 predicados opacos**, elimina **3,432 ramas muertas**, reúne **2,465 literales divididos**, borra **1,487 declaraciones señuelo** y **750 exportaciones WASM señuelo**, descifra todas las tablas de cadenas XOR, corta **11 interbloqueos anti-strip** y **5 autosellos**, y censura todos los señuelos de prompts. Una ejecución tarda unos 0.3 s por archivo.

El script del panel v6 sanado es la lógica `derive()` de la plantilla publicada línea por línea (salvo los locales renombrados por BLA). Los recuentos de tokens son estimaciones (≈4 caracteres/token para código, 2 para hex/base64, 1 por byte para binarios).

> Política de spoilers: LASIK hace legibles todos los CrackMes. No publica claves ni flags. Resolverlos sigue siendo cosa tuya.

## 🧠 Cómo funciona

BLA apila capas ("Poison → Exhaust → Hallucinate"). LASIK deshace cada una de forma estática e indica con qué certeza.

<p align="center"><img src="../assets/pipeline.svg" alt="Orden de pasadas de LASIK: detectar, cortar interbloqueos, eliminar señuelos, plegar hasta punto fijo, renombrar, firewall, informe" width="100%" /></p>

<details open>
<summary><b>Capa por capa: qué hace BLA y cómo responde LASIK</b></summary>

| Capa de BLA | Qué hace BLA | Contramedida de LASIK | Certeza |
|---|---|---|---|
| **Tarpit** | ~3k predicados opacos con `Math.imul` eligen entre real y señuelo para cada fragmento de cadena, entero y sentencia | Reconoce las 4 familias teórico-numéricas de BLA (cada una es una identidad demostrada sobre int32), y luego un **demostrador de bits conocidos**: calcula qué bits de la semilla de ejecución son fijos y enumera solo los bits de los que depende un predicado | **Prueba exacta** |
| **Entangle: interlock** | El bit bajo de la semilla = `digest(decoyCorpus) === N`, de modo que borrar los señuelos invierte todos los predicados | Reimplementa el digest, lo recalcula sobre el corpus intacto y pliega el bit *antes* de eliminar nada | Exacta |
| **Entangle: self-seal / sidecar** | El archivo calcula el SHA-256 de sí mismo y de sus archivos hermanos, y lanza una excepción ante cualquier edición | Se detecta por su forma y se elimina (sus digests solo alimentaban bits que LASIK ya demostró irrelevantes) | Exacta para la forma de BLA |
| **Entangle: bind-scope** | IIFE de bloqueo por dominio / fecha | Se elimina; se informa del contrato (dominios, ventana de validez) | Huella |
| **Encrypt** | Tablas de keystream XOR de `bla_encrypt_strings`; cadenas y enteros divididos en ≥9 fragmentos opacos | Decodifica la tabla con el keystream que se distribuye junto a ella; reúne los fragmentos una vez plegados los predicados | Exacta |
| **Deceive** | ~140 bloques inyectados: credenciales honeypot, falsos enclaves gRPC, lógica de negocio en la sombra, laberintos de grafos de llamadas, sumideros de tokens BPE, imanes de regex, diagnósticos señuelo, source maps trampa, comentarios revueltos, anclas de mantenimiento `void [decoy]` | Tree-shaking por alcanzabilidad desde los puntos de entrada reales tras el plegado, más un catálogo de huellas de 25 familias de señuelos | Exacta (alcanzabilidad) |
| **Runtime** | Stepper de shadow-heap entretejido en cada función; bloques "Truman show" que sirven un estado de enclave falso a los depuradores | Análisis de sumideros de estado privado: las funciones que solo mutan un estado que nadie más lee no son observables, así que sus llamadas se eliminan | Exacta para estado cerrado |
| **Weave** | Ranuras de estado escritas por el agente que protegen código real con `(slot.epoch & 1) !== 0` y mezclas `x & 0` | Bits conocidos sobre cada escritura de la ranura; cero algebraico | Exacta; el weave de forma libre se etiqueta, no se adivina |
| **Exhaust** | 6.9 MB de relleno de nombres/secciones WASM, 250 exportaciones señuelo, cabeceras ASAR de 16 MiB, 34 centinelas de fuse | Reconstruye WASM (validado), ASAR (offsets reescritos) y las secuencias de fuse dentro de los presupuestos de REA | Exacta |
| **Prompt** | Falsos turnos `system`/chat, cebo de rechazo, afirmaciones de "no hay lógica de negocio", falsos avisos COPPA/IEC 62304, GUIDs canario | **Cortafuegos de prompts**: 40 reglas censuran el texto antes de que lo lea un modelo (conserva el comportamiento en `heal`, censura total en `lasik_read`) | Huella + reglas de frases |

</details>

El orden completo de las pasadas y cada huella están documentados en [`docs/how-it-works.md`](../how-it-works.md).

### Qué lo hace digno de confianza

- **Pruebas en lugar de conjeturas.** El modo predeterminado pliega solo lo que puede demostrar. El plegado heurístico (`--aggressive`) es opcional, se informa por separado y nunca toca parámetros ni entradas. La suite de pruebas lo fija: una verificación de licencia real `(key ^ K) === C` nunca se pliega.
- **El código limpio no se toca.** Los archivos sin evidencia de BLA vuelven byte a byte idénticos; el cortafuegos de prompts solo puede censurar sus comentarios.
- **Sanar conserva el comportamiento.** En la salida de `heal`, el cortafuegos censura solo comentarios y cadenas específicas de BLA; las cadenas *de ejecución* con forma de prompt (por ejemplo, marcadores ChatML en una aplicación de chat real) se informan, no se reescriben. `lasik_read` y `--strict-firewall` ofrecen a los agentes una vista de lectura totalmente censurada.
- **Revisado de forma independiente.** Una revisión adversarial aparte buscó entradas en las que una pasada cambiara el comportamiento y encontró 15; todas están corregidas y fijadas en [`tests/soundness.test.ts`](../../tests/soundness.test.ts) (85 pruebas en total).
- **El orden importa y se hace cumplir.** Los interbloqueos se cortan antes de borrar cualquier señuelo, de modo que el programa sanado conserva la semilla que espera el código real de BLA.

## Cobertura de formatos

<!-- coverage:start -->
Pinned to BLA **3.2.1**. 58/63 BLA shield files fully healed; 44 more emit nothing into artifacts. Full per-file table: [docs/coverage.md](../coverage.md).

| Surface | Status |
|---|---|
| .NET assembly | ✅ healed |
| Android APK | ✅ healed |
| Android DEX | ✅ healed |
| Apple plist | ✅ healed |
| Bind-scope licence lock | 🔎 detect-only |
| Bun standalone | ✅ healed |
| Electron ASAR | ✅ healed |
| Erlang BEAM | ✅ healed |
| EVM bytecode | ✅ healed |
| Firmware UF2 | ✅ healed |
| GPU PTX | ✅ healed |
| JavaScript / HTML | 🟡 partial |
| JVM class | ✅ healed |
| Mobile game (DEX / IL2CPP) | ✅ healed |
| Native ELF / PE / Mach-O | 🟡 partial |
| PCAP | ✅ healed |
| Prompt text | ✅ healed |
| Python | ✅ healed |
| Safetensors / GGUF | ✅ healed |
| Sidecar entanglement | ✅ healed |
| Source maps | ✅ healed |
| SQLite | ✅ healed |
| WebAssembly | ✅ healed |
| ZIP / JAR / APK | ✅ healed |
<!-- coverage:end -->

## 🛡️ Modelo de seguridad

- **LASIK nunca ejecuta el código que lee.** Sin `eval`, sin `vm`, sin `require` del objetivo, sin instanciar WebAssembly (los módulos solo se analizan y se pasan a `WebAssembly.validate`). La evaluación de constantes se ejecuta en el intérprete de AST propio de LASIK para un subconjunto entero cerrado.
- Eso lo hace utilizable con entradas hostiles, incluido malware que adopta BLA para cegar a los analistas de IA.
- Sin acceso a la red, sin telemetría.

## 🔌 Servidor MCP

`npx lasik-agents setup` registra `npx -y lasik-agents mcp` en tus agentes. Herramientas:

| Herramienta | Qué hace |
|---|---|
| `lasik_scan` | Detecta las capas de BLA en un archivo o directorio, puntuación de ceguera de 0 a 100, ahorro de tokens |
| `lasik_read` | Devuelve un archivo JS/TS/HTML sin BLA: lo que el agente debería leer en lugar del original |
| `lasik_heal` | Escribe una copia limpia de una aplicación completa (JS, HTML, ASAR, WASM incl. `.wasm.gz`, source maps, fuses) para REA |
| `lasik_firewall` | Censura los señuelos de prompts de cualquier texto antes de razonar sobre él |

El servidor también le explica al agente cómo reconocer BLA (charla sobre enclaves/TEE, predicados `Math.imul`, tablas XOR, texto de rechazo) para que recurra a LASIK por sí mismo. Hay una [skill de agente](../../.agents/skills/lasik/SKILL.md) para los agentes que cargan skills.

## 🖥️ CLI

```text
lasik scan <path>            Detect BLA hardening and score how blinded an agent would be
lasik heal <path> [-o dir]   Write a cleaned copy (default: <path>.lasik)
lasik firewall [file|-]      Redact LLM-directed decoy text from any text
lasik bench <dir>            Before/after table for every artifact under <dir>
lasik setup | doctor | mcp

--json | --md                Report formats       --aggressive     Opt-in heuristics
--no-firewall --no-rename    Keep text / names    --fail-on <lvl>  CI gate (exit 3)
--strict-firewall            Redact prompt decoys in runtime strings too (read view)
```

Ejemplo de CI: haz fallar un pipeline si una dependencia que incluyes en tu repositorio distribuye código cegado por BLA:

```bash
npx lasik-agents scan vendor/ --fail-on blinded
```

## 📦 Biblioteca

```ts
import { run, healJs, firewallText } from "lasik-agents";

const report = run("./dist", "heal", { outDir: "./dist.lasik" });
console.log(report.verdict, report.blindness, report.totals);

const { code, findings } = healJs(source, { filename: "bundle.js" });
const { text } = firewallText(untrustedString);
```

## 🔬 Límites honestos

- **Los nombres y los comentarios se pierden.** Con `bankrupt`/`maximum`, BLA no deja ninguna pista de los identificadores originales; LASIK renombra los manejadores de `require` según su módulo y restaura la ABI hasheada del panel, nada más. Los comentarios originales y los source maps son irrecuperables. LASIK lo dice en lugar de inventarlos.
- **La sanación de Python** es estructural sobre el texto (el emisor de Python de BLA es regular): se eliminan las guardas tarpit, el churn de ranuras y el preludio antepuesto; lo que LASIK no puede analizar se deja en su sitio con una advertencia.
- **SQLite, safetensors/GGUF, DEX/IL2CPP, binarios nativos**: por ahora solo detección. La sanación de ASAR está probada con archivos sintéticos; todavía no existe ninguna muestra pública de ASAR con BLA.
- **Los nombres de exportación WASM** que BLA renombró a `ops_<hex>_…` siguen renombrados (se informa de ello).
- **Carrera armamentista.** LASIK apunta a BLA ≤ 3.2. Las nuevas capas de BLA requerirán nuevas pasadas; las pruebas (bits conocidos, alcanzabilidad) se trasladan mejor que las huellas.
- **La equivalencia en tiempo de ejecución** se establece de forma estática (pruebas exactas más comparación estructural con las plantillas de CrackMe publicadas por BLA), no ejecutando los objetivos.

## ⚖️ Uso responsable

LASIK es un desofuscador. Úsalo con software que te pertenezca, malware y muestras de amenazas, CTFs y desafíos (como los CrackMes de BLA) y código que estés autorizado a auditar. Eliminar la protección del software de otra persona puede infringir su licencia o leyes como la DMCA §1201 de EE. UU. Consulta [DISCLAIMER.md](../../DISCLAIMER.md).

## ❓ Preguntas frecuentes

<details>
<summary><b>¿Es esto anti-BLA?</b></summary>

Sí. Es el tercer acto: REA hace ingeniería inversa, BLA ciega, LASIK devuelve la vista.

</details>

<details>
<summary><b>¿Por qué querría esto un defensor?</b></summary>

Porque los atacantes también usarán BLA. El malware envuelto en BLA está hecho para que tu analista de IA se niegue, se atasque o agote su presupuesto. LASIK mantiene a tu analista trabajando, su cortafuegos de prompts es una defensa general contra instrucciones plantadas en el código, y cada escaneo informa **"AI-evasion techniques found: N"**: el código que se esfuerza por esconderse del análisis con IA es una señal de riesgo en sí mismo.

</details>

<details>
<summary><b>¿Necesita REA?</b></summary>

No. Cualquier agente de programación puede leer la salida de LASIK o llamar directamente a `lasik_read`. LASIK combina de forma natural con REA para objetivos compilados.

</details>

<details>
<summary><b>¿BLA simplemente lo esquivará con un parche?</b></summary>

Probablemente. Para BLA es barato cambiar las huellas; las pruebas exactas no lo son, porque el programa protegido por BLA todavía tiene que comportarse igual. Esa asimetría es la base sobre la que se construye LASIK.

</details>

## 🤝 Contribuir

¿Una nueva versión de BLA rompió una pasada? Abre un issue con el artefacto (o una reproducción mínima) y la salida de `lasik scan --json`. Consulta [CONTRIBUTING.md](../../CONTRIBUTING.md). Ejecuta `npm test` antes de enviar un PR.

## 📄 Licencia

MIT © LASIK contributors. El corpus de referencia en `bench/bla-crackme` es © BLA Contributors, MIT, incluido sin modificar ([LICENSE-BLA](../../bench/bla-crackme/LICENSE-BLA)). LASIK no está afiliado a BLA ni a REA.
