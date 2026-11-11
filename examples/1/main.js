const $ = id => document.getElementById(id);
const input = $('input'), output = $('output');
let result = '';

const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
function store(k, v) { try { v === undefined ? null : localStorage.setItem(k, v); return localStorage.getItem(k); } catch { return null; } }
function isDark() { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function paintTheme() { $('themeIcon').innerHTML = isDark() ? SUN : MOON; }
const saved = store('jf-theme'); if (saved) document.documentElement.dataset.theme = saved;
paintTheme();
$('themeBtn').onclick = () => { const t = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = t; store('jf-theme', t); paintTheme(); };

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function highlight(json) {
  return esc(json).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],]/g, (m, str, colon, bool) => {
    if (str) return colon ? `<span class="tk-k">${str}</span><span class="tk-p">${colon}</span>` : `<span class="tk-s">${str}</span>`;
    if (bool) return `<span class="tk-b">${m}</span>`;
    if (m === 'null') return `<span class="tk-null">${m}</span>`;
    if (/[{}\[\],]/.test(m)) return `<span class="tk-p">${m}</span>`;
    return `<span class="tk-n">${m}</span>`;
  });
}
const sortDeep = v => Array.isArray(v) ? v.map(sortDeep)
  : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortDeep(v[k]), o), {}) : v;

function lines(n) { return Array.from({ length: Math.max(n, 1) }, (_, i) => i + 1).join('\n'); }
const bytes = s => { const b = new Blob([s]).size; return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`; };

function locate(text, err) {
  const m = /position (\d+)/.exec(err.message);
  const lc = /line (\d+) column (\d+)/.exec(err.message);
  if (lc) return { line: +lc[1], col: +lc[2] };
  if (!m) return null;
  const before = text.slice(0, +m[1]).split('\n');
  return { line: before.length, col: before.at(-1).length + 1 };
}
function setStatus(el, cls, msg, meta = '') {
  el.className = 'status ' + cls; el.children[1].textContent = msg; el.children[2].textContent = meta;
}
function depth(v) { return v && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0; }

function run(mode = 'format', quiet = false) {
  const text = input.value;
  if (!text.trim()) { result = ''; output.innerHTML = ''; $('outGutter').textContent = '1';
    setStatus($('inStatus'), '', '入力待ち'); setStatus($('outStatus'), '', '—'); return; }
  let data;
  try { data = JSON.parse(text); }
  catch (e) {
    const loc = locate(text, e);
    setStatus($('inStatus'), 'err', (loc ? `${loc.line} 行 ${loc.col} 列: ` : '') + e.message.replace(/^JSON\.parse: /, ''));
    if (!quiet) toast('構文エラーがあります', true);
    return;
  }
  const keys = (function count(v) { return v && typeof v === 'object' ? Object.values(v).reduce((a, x) => a + count(x), Array.isArray(v) ? 0 : Object.keys(v).length) : 0; })(data);
  setStatus($('inStatus'), 'ok', '有効な JSON', `${keys} キー · 深さ ${depth(data)} · ${bytes(text)}`);
  if (mode === 'validate') { if (!quiet) toast('有効な JSON です'); return; }
  if ($('sortKeys').checked) data = sortDeep(data);
  const ind = $('indent').value === 'tab' ? '\t' : +$('indent').value;
  result = mode === 'minify' ? JSON.stringify(data) : JSON.stringify(data, null, ind);
  output.innerHTML = highlight(result);
  const n = result.split('\n').length;
  $('outGutter').textContent = lines(n);
  setStatus($('outStatus'), 'ok', mode === 'minify' ? '圧縮済み' : '整形済み', `${n} 行 · ${bytes(result)}`);
}
let lastMode = 'format';
const act = m => () => { lastMode = m === 'validate' ? lastMode : m; run(m); };
$('formatBtn').onclick = act('format'); $('minifyBtn').onclick = act('minify'); $('validateBtn').onclick = act('validate');
['indent', 'sortKeys'].forEach(id => $(id).onchange = () => run(lastMode, true));

let timer;
input.addEventListener('input', () => {
  $('inGutter').textContent = lines(input.value.split('\n').length);
  clearTimeout(timer);
  timer = setTimeout(() => $('autoFmt').checked ? run(lastMode, true) : run('validate', true), 250);
});
input.addEventListener('scroll', () => $('inGutter').scrollTop = input.scrollTop);
output.addEventListener('scroll', () => $('outGutter').scrollTop = output.scrollTop);
input.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); lastMode = 'format'; run('format'); }
  if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
});
function setInput(v) { input.value = v; input.dispatchEvent(new Event('input')); clearTimeout(timer); run(lastMode, true); }

let tt;
function toast(msg, err) { $('toastMsg').textContent = msg; $('toast').style.background = err ? 'var(--err)' : ''; $('toast').classList.add('show'); clearTimeout(tt); tt = setTimeout(() => $('toast').classList.remove('show'), 1600); }

$('copyBtn').onclick = async () => { if (!result) return toast('コピーする内容がありません', true);
  try { await navigator.clipboard.writeText(result); toast('クリップボードにコピーしました'); } catch { toast('コピーできませんでした', true); } };
$('pasteBtn').onclick = async () => { try { setInput(await navigator.clipboard.readText()); } catch { toast('貼り付けの権限がありません', true); } };
$('clearBtn').onclick = () => { setInput(''); input.focus(); };
$('downloadBtn').onclick = () => { if (!result) return toast('ダウンロードする内容がありません', true);
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([result], { type: 'application/json' })), download: 'formatted.json' });
  a.click(); URL.revokeObjectURL(a.href); };
$('uploadBtn').onclick = () => $('file').click();
const readFile = f => f && f.text().then(setInput);
$('file').onchange = e => readFile(e.target.files[0]);
input.addEventListener('dragover', e => e.preventDefault());
input.addEventListener('drop', e => { e.preventDefault(); readFile(e.dataTransfer.files[0]); });
$('sampleBtn').onclick = () => setInput(JSON.stringify({ name: "json-formatter", version: "1.0.0", private: true,
  author: { name: "Dev", email: null }, tags: ["json", "formatter", "devtools"],
  config: { indent: 2, sortKeys: false, theme: "auto", ratio: 0.75 } }));
