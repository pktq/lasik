// Tabs on the install box and copy buttons. The pages read fine without it.
const tabs = [...document.querySelectorAll("#install [role=tab]")];
const select = (tab) => {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
};
tabs.forEach((t, i) => {
  t.addEventListener("click", () => select(t));
  t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; select(n); n.focus(); }
  });
});

for (const b of document.querySelectorAll(".copy")) {
  b.addEventListener("click", () => {
    const lines = b.parentElement.querySelector("pre").innerText.split("\n");
    const text = lines.filter((l) => !l.trim().startsWith("#")).map((l) => l.replace(/\s{2,}#.*$/, "")).join("\n").trim();
    navigator.clipboard?.writeText(text).then(() => {
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = "Copy"), 1500);
    });
  });
}
