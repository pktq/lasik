<p align="center"><a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <b>Español</b></p>

<p align="center">
  <img src="../assets/banner.svg" alt="LASIK" width="100%" />
</p>

<p align="center">
  Desofuscación estática del endurecimiento antiagente.<br />
  LASIK elimina las capas de protección de <a href="https://github.com/qybaihe/bla">BLA</a> para que los agentes de programación y las herramientas de análisis puedan leer el programa real.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lasik-agents"><img src="https://img.shields.io/npm/v/lasik-agents?style=for-the-badge&label=npm&color=22d3ee" alt="npm version" /></a>
  <a href="https://github.com/pktq/lasik/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/pktq/lasik/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI" /></a>
  <a href="../../docs/coverage.md"><img src="https://img.shields.io/badge/BLA_3.2.2-59%2F63_shields_healed-22d3ee?style=for-the-badge" alt="BLA coverage" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-64748b?style=for-the-badge" alt="MIT license" /></a>
</p>

<p align="center">
  <b>0.3:</b> detección estructural. La protección se identifica por lo que hace, no por sus nombres, de modo que también se reparan las compilaciones con nombres cambiados. <a href="#resiliencia">Benchmark</a>
</p>

<p align="center">
  <a href="../how-it-works.md">Cómo funciona</a> ·
  <a href="../benchmark.md">Benchmark</a> ·
  <a href="../../CHANGELOG.md">Registro de cambios</a>
</p>

<br />

<p align="center">
  <img src="../assets/before-after.svg" alt="Las mismas dos funciones de una compilación protegida, antes y después de LASIK" width="100%" />
</p>

LASIK lee una compilación protegida, demuestra qué partes son protección (predicados opacos, cadenas cifradas, código señuelo, comprobaciones de manipulación, relleno binario, texto de inyección de prompts), las elimina y escribe una copia limpia. Nunca ejecuta la entrada.

<p align="center"><img src="../assets/flow.svg" alt="Una versión protegida pasa por lasik heal y después un agente o una herramienta de análisis lee la lógica real" width="100%" /></p>

## Puntos destacados

- **1.262 veces menos tokens** en el corpus público de CrackMes de BLA: de unos 21 millones a 17 mil.
- **Basado en demostraciones.** Una transformación solo se aplica cuando LASIK puede demostrar que conserva el comportamiento. Los archivos sin protección se devuelven idénticos byte a byte.
- **Detección estructural.** La protección se reconoce por su comportamiento, no por los identificadores; un benchmark con compilaciones renombradas se ejecuta en CI.
- **Solo análisis estático.** Sin `eval`, sin sandbox, sin instanciar WebAssembly; seguro con entradas hostiles.
- **Cortafuegos de prompts** para el texto plantado con el fin de dirigir al modelo.
- **21 formatos**: bundles de JavaScript y TypeScript, HTML en línea, WebAssembly, Electron ASAR y fuses, source maps, Python y `.pyc`, binarios nativos ELF/PE/Mach-O, Bun, SQLite, safetensors y GGUF, PCAP, JVM, .NET, BEAM, EVM, PTX, ZIP/APK/DEX, plist, IL2CPP y firmware UF2.
- **Recuperación de nombres** cuando el programa aún publica el nombre original (exports, imports); nombres neutros en el resto de casos.
- **Integración con agentes**: CLI, servidor MCP para Claude Code, Cursor, Codex y otros siete, y una API de biblioteca.

## Instalación

```bash
npm install -g lasik-agents     # or run any command with npx lasik-agents
```

Requiere Node.js 20.19 o posterior. Para compilar desde el código fuente: `git clone https://github.com/pktq/lasik && cd lasik && npm ci && npm run build`.

## Uso

Escanea una compilación y después escribe una copia limpia:

```console
$ lasik scan bench/bla-crackme
Verdict: BLINDED · blindness 100/100 · 15 file(s) carry BLA artifacts
AI-evasion techniques found: 24
Sight restored: 1.8 MB → 37.5 KB, ~21,104,859 → ~16,718 tokens

$ lasik heal ./dist             # writes a cleaned copy to ./dist.lasik
```

Apunta tu agente o herramienta de análisis a la copia reparada, por ejemplo [REA](https://github.com/morluto/rea):

```bash
npx -y rea-agents@latest analyze-javascript-application "$PWD/dist.lasik" --json
```

Otros comandos: `lasik firewall` (elimina las instrucciones plantadas de cualquier texto), `lasik bench`, `lasik doctor`. Añade `--json` o `--md` para informes legibles por máquina y `--fail-on blinded` para usarlo como control en CI.

### En tu agente de programación

```bash
lasik setup                     # registers the MCP server; --dry-run to preview, --remove to undo
```

| Herramienta | |
|---|---|
| `lasik_scan` | Las capas de protección de un archivo o carpeta, una puntuación de ceguera de 0 a 100 y las técnicas encontradas |
| `lasik_read` | Un archivo sin protección, para que el agente lo lea en lugar del original |
| `lasik_heal` | Una copia limpia de una aplicación completa |
| `lasik_firewall` | Las instrucciones plantadas eliminadas de cualquier texto |

El repositorio también incluye una [skill de agente](../../.agents/skills/lasik/SKILL.md) para los agentes que se encuentren con compilaciones protegidas.

## Benchmark

Los CrackMes públicos de BLA, incluidos sin cambios en [`bench/bla-crackme`](../../bench/bla-crackme):

| CrackMe | Archivos | Antes | Después | Tokens (estimados) |
|---|---:|---:|---:|---|
| v6 | 3 | 303 KB | 4.9 KB | 6,954,989 → 1,398 |
| v7 | 5 | 743 KB | 13.6 KB | 197,561 → 3,483 |
| v8 | 3 | 362 KB | 6.7 KB | 6,972,491 → 4,748 |
| v9 | 4 | 381 KB | 7.4 KB | 6,977,670 → 4,941 |

<p align="center"><img src="../assets/tokens.svg" alt="Gráfico de barras en escala logarítmica: tokens estimados por artefacto de cada CrackMe antes y después de LASIK" width="100%" /></p>

<!-- realbench:start -->
On a project we hardened ourselves with the published `bla-agents@3.2.1`, one file per format ([details](../benchmark.md#your-own-code-hardened-by-real-bla-321)):

| BLA run | Files | Original | BLA-hardened | After LASIK | Tokens (estimated) | Result |
|---|---:|---:|---:|---:|---|---|
| Defaults | 21 | 151.9 KB | 31.1 MB | 150.9 KB | 32,154,076 → 152,102 | 21/21 healed, 11 byte-identical |
| All opt-in layers | 21 | 151.9 KB | 31.2 MB | 151.0 KB | 32,178,121 → 152,197 | 21/21 healed, 10 byte-identical |
<!-- realbench:end -->

Las cifras por archivo, el método y sus limitaciones están en [docs/benchmark.md](../benchmark.md). LASIK hace legibles los CrackMes; no publica sus soluciones.

### Resiliencia

`npm run bench:renamed` repara las mismas compilaciones dos veces: tal como se distribuyen y con todos los identificadores generados, comentarios, secciones WASM, nombres de export largos y rutas ASAR reescritos con otros nombres, y con los operandos conmutativos reordenados, sin cambiar el comportamiento. Como la detección es estructural, ambas ejecuciones dan casi el mismo resultado. CI falla si la ejecución con nombres cambiados elimina más de un punto porcentual menos.

<p align="center"><img src="../assets/renamed.svg" alt="Izquierda: ejemplos de lo que el benchmark reescribe con otros nombres. Derecha: tokens restantes por formato; las compilaciones con nombres cambiados se reparan hasta un tamaño casi igual al de las originales" width="100%" /></p>

| Formato | Tal como se distribuye: eliminado | Con nombres cambiados: eliminado |
|---|---:|---:|
| JavaScript / TypeScript | 98.78% | 98.09% |
| HTML | 99.29% | 99.17% |
| WebAssembly | 99.98% | 99.98% |
| Electron ASAR | 99.998% | 99.96% |

## Cómo funciona

<p align="center"><img src="../assets/pipeline.svg" alt="Orden de las pasadas de LASIK: detectar, cortar interbloqueos, eliminar señuelos, plegar hasta el punto fijo, renombrar, cortafuegos, informe" width="100%" /></p>

| Capa | Qué hace LASIK |
|---|---|
| Predicados opacos | Demuestra las condiciones constantes con un análisis de bits conocidos y elimina las ramas muertas |
| Interbloqueos anti-strip | Evalúa la comprobación en un intérprete de un subconjunto cerrado y la pliega antes de quitar nada |
| Literales cifrados y divididos | Decodifica las tablas de cadenas con la clave que se distribuye junto a ellas; vuelve a unir cadenas y enteros divididos |
| Señuelos | Elimina todo lo que no es alcanzable desde los puntos de entrada reales |
| Bloqueos de manipulación y de dominio | Los elimina e informa de las condiciones del bloqueo |
| Ruido en tiempo de ejecución | Elimina la agitación de estado y los bloques de estado que nadie lee |
| Identificadores renombrados | Restaura los nombres que el programa exporta o importa; nombres neutros para el resto |
| Relleno y datos plantados | Elimina el relleno, los trailers y las entradas plantadas en binarios, bases de datos, modelos y archivos, y reconstruye offsets y checksums |
| Instrucciones plantadas | Las elimina con 40 reglas de cortafuegos |

Los detalles están en [docs/how-it-works.md](../how-it-works.md). Dos revisiones de corrección independientes buscaron entradas en las que la reparación cambiara el comportamiento o modificara un archivo sin protección; cada caso encontrado está corregido y fijado en [`tests/soundness.test.ts`](../../tests/soundness.test.ts).

## Cobertura de formatos

<!-- coverage:start -->
Pinned to BLA **3.2.2**. 59/63 BLA shield files fully healed; 44 more emit nothing into artifacts. Full per-file table: [docs/coverage.md](../coverage.md).

| Surface | Status |
|---|---|
| .NET assembly | ✅ healed |
| Android APK | ✅ healed |
| Android DEX | ✅ healed |
| Apple plist | ✅ healed |
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

## Limitaciones

- La información que la protección destruyó (nombres locales, comentarios, source maps originales, secciones sobrescritas) no se puede recuperar; LASIK lo indica en lugar de inventarla.
- Los reparadores están validados con salida real de BLA 3.2.1 para 21 formatos ([tests/fixtures/bla-3.2.1](../../tests/fixtures/bla-3.2.1)); Go, Flutter, Bun, BEAM, APK/DEX e IL2CPP, por ahora, con fixtures construidos a partir del código fuente de BLA.
- Las nuevas técnicas de protección pueden requerir una actualización. Los cambios de BLA se vigilan cada semana ([coverage/bla.json](../../coverage/bla.json)) y las compilaciones protegidas con versiones anteriores siguen siendo compatibles.

## Uso responsable

LASIK es un desofuscador. Úsalo con tu propio software, con malware y muestras de amenazas, en CTFs y en auditorías que estés autorizado a realizar. Quitar la protección de software sobre el que no tienes derechos puede infringir su licencia o leyes como la sección 1201 de la DMCA. Consulta [DISCLAIMER.md](../../DISCLAIMER.md).

## Contribuir

Los informes de errores con una muestra (o la salida de `lasik scan --json`) son la contribución más útil. Consulta [CONTRIBUTING](../../.github/CONTRIBUTING.md).

También disponible en [English](../../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · Español.

## Licencia

[MIT](../../LICENSE). El corpus del benchmark es © BLA Contributors, MIT. LASIK no está afiliado a BLA ni a REA.
