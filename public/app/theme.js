// Theme switch + persistence. Changing the look is a single attribute flip.
const THEMES = ["blackfyre", "valyria", "wall"];
const KEY = "itqa.theme";
const THEME_COLORS = { blackfyre: "#0b0b0d", valyria: "#efe7d3", wall: "#0f141a" };

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = "blackfyre";
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch {}

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);

  document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.themeBtn === theme));
  });
}

function initTheme() {
  let saved = "blackfyre";
  try { saved = localStorage.getItem(KEY) || "blackfyre"; } catch {}
  applyTheme(saved);

  document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.themeBtn));
  });
}

initTheme();
export { applyTheme, THEMES };
