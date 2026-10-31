export type Theme = "system" | "light" | "dark";

export function getTheme(): Theme {
  try { const t = localStorage.getItem("keel-theme"); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; }
}
export function setTheme(t: Theme) {
  try { if (t === "system") localStorage.removeItem("keel-theme"); else localStorage.setItem("keel-theme", t); } catch { /* private mode */ }
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
