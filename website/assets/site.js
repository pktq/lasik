// LASIK site behaviour. Everything here enhances content that is already readable without script.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n) => n.toLocaleString("en-US");

// Gentle entrances, once per element.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}, { rootMargin: "0px 0px -6% 0px" });
$$("[data-rise]").forEach((el) => io.observe(el));

// Lens 1 is BLA's output, lens 2 is LASIK's.
const demo = $(".demo");
if (demo) {
  const sizes = { 1: "2,439 bytes", 2: "145 bytes" };
  $$(".lensbtn").forEach((b) => b.addEventListener("click", () => {
    const n = b.dataset.lens;
    demo.dataset.lens = n;
    $$(".lensbtn").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    $("#lens-1").hidden = n !== "1";
    $("#lens-2").hidden = n !== "2";
    $("#lens-size").textContent = sizes[n];
  }));
}

// Results come from results.json, which the build updates; the HTML carries v6 as the fallback.
const loadResults = () => fetch(new URL("assets/results.json", document.baseURI)).then((r) => r.json());
const sum = (files, side, key) => files.reduce((t, f) => t + (f[side] ? f[side][key] : 0), 0);

const tabs = $$(".tabs [role=tab]");
if (tabs.length) {
  const names = (f) => f.map((x) => `<code>${x.file.split("/").pop()}</code>`).join(f.length > 2 ? ", " : " and ");
  const copy = (name, f) => `Version ${name.slice(1)}: ${names(f)}, ${fmt(sum(f, "hardened", "lines"))} lines as shipped, ${fmt(sum(f, "lasik", "lines"))} after LASIK. Token counts are LASIK's estimates, not measured REA runs.`;
  loadResults().then((data) => {
    const show = (name) => {
      const files = data.files.filter((f) => f.set === name);
      const h = sum(files, "hardened", "bytes"), l = sum(files, "lasik", "bytes");
      $("#f-hard").textContent = `${fmt(h)} B`;
      $("#f-lasik").textContent = `${fmt(l)} B`;
      $("#f-ratio").textContent = `${Math.round(h / l)}×`;
      $("#set-desc").innerHTML = copy(name, files);
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.set === name)));
    };
    const T = data.totals;
    if (T && $("#corpus")) $("#corpus").textContent = `Across all ${T.artifacts} hardened files in BLA's CrackMe set: ${fmt(T.bytesBefore)} bytes become ${fmt(T.bytesAfter)}, and an estimated ${(T.tokensBefore / 1e6).toFixed(1)} million tokens become ${Math.round(T.tokensAfter / 1000)} thousand.`;
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => show(t.dataset.set));
      t.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); n.click(); }
      });
    });
  }).catch(() => {});
}

// The command line copies a real command.
const form = $("#cta-form");
if (form) {
  const cmd = () => `npx lasik-agents heal ${(form.path.value.trim() || "./dist").replace(/[^\w./\\:~-]/g, "")}`;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const note = $("#cta-note");
    navigator.clipboard?.writeText(cmd()).then(
      () => { note.innerHTML = `Copied <code>${cmd()}</code>. Then point your agent at the <code>.lasik</code> folder it writes.`; },
      () => { note.innerHTML = `Run <code>${cmd()}</code> in a terminal.`; },
    );
  });
}

// Copy buttons on code blocks.
$$(".code button").forEach((b) => b.addEventListener("click", () => {
  navigator.clipboard?.writeText(b.parentElement.querySelector("pre").innerText.trim()).then(() => {
    b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1600);
  });
}));

// Results page: bars and table from results.json (the table is also in the HTML).
const bars = $("#bars");
if (bars) {
  loadResults().then((data) => {
    const max = Math.max(...data.files.map((f) => f.hardened.bytes));
    bars.innerHTML = data.files.map((f) => `<div><div class="bar__label"><b>${f.set} · ${f.file}</b><span>${fmt(f.hardened.bytes)} → ${fmt(f.lasik.bytes)} B</span></div><div class="bar__track"><i style="width:${(100 * f.hardened.bytes) / max}%"></i><i style="width:${(100 * f.lasik.bytes) / max}%"></i></div></div>`).join("");
  }).catch(() => {});
}
