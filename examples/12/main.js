const $ = id => document.getElementById(id);
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
function store(k, v) { try { if (v !== undefined) localStorage.setItem(k, v); return localStorage.getItem(k); } catch { return null; } }
function isDark() { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function paintTheme() { $('themeIcon').innerHTML = isDark() ? SUN : MOON; }
const saved = store('ds12-theme'); if (saved) document.documentElement.dataset.theme = saved;
paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
$('themeBtn').onclick = () => { const t = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = t; store('ds12-theme', t); paintTheme(); };

// アイコントグルの見本: aria-pressed を切り替える
document.querySelectorAll('.js-press').forEach(b => {
  b.addEventListener('click', () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));
});
