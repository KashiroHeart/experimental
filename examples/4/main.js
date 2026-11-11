function parseBase(s) {
  const t = String(s).trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 2 && n <= 36 ? n : null;
}

function convert(value, inBase, outBase, ignore, upper) {
  const r = { out: '', numErr: '', inErr: '', outErr: '' };
  const bi = parseBase(inBase);
  const bo = parseBase(outBase);
  if (bi === null) r.inErr = '入力基数は 2〜36 の整数で指定してください';
  if (bo === null) r.outErr = '出力基数は 2〜36 の整数で指定してください';
  if (bi === null || bo === null) return r;

  let n = 0n;
  const B = BigInt(bi);
  let any = false;
  const bad = [];
  for (const ch of String(value).toLowerCase()) {
    const d = /^[0-9a-z]$/.test(ch) ? parseInt(ch, 36) : -1;
    if (d >= 0 && d < bi) {
      n = n * B + BigInt(d);
      any = true;
    } else if (!ignore) {
      const shown = ch === ' ' ? '空白' : ch === '\n' ? '改行' : ch.toUpperCase();
      if (!bad.includes(shown)) bad.push(shown);
    }
  }
  if (bad.length) {
    r.numErr = '基数 ' + bi + ' で使えない文字: ' + bad.join(' ');
    return r;
  }
  if (any) {
    const s = n.toString(bo);
    r.out = upper ? s.toUpperCase() : s.toLowerCase();
  }
  return r;
}

const $ = (id) => document.getElementById(id);
let upper = true;

function render() {
  const r = convert($('c-in').value, $('c-inbase').value, $('c-outbase').value, $('c-ignore').checked, upper);
  $('c-out').value = r.out;
  $('c-in-msg').textContent = r.numErr;
  $('c-bar-msg').textContent = [r.inErr, r.outErr].filter(Boolean).join(' / ');
  $('c-in').setAttribute('aria-invalid', String(!!r.numErr));
  $('c-inbase').setAttribute('aria-invalid', String(!!r.inErr));
  $('c-outbase').setAttribute('aria-invalid', String(!!r.outErr));
}

function step(id, d) {
  const b = parseBase($(id).value);
  $(id).value = String(Math.min(36, Math.max(2, (b === null ? 10 : b) + d)));
  render();
}
$('c-inbase-dec').addEventListener('click', () => step('c-inbase', -1));
$('c-inbase-inc').addEventListener('click', () => step('c-inbase', 1));
$('c-outbase-dec').addEventListener('click', () => step('c-outbase', -1));
$('c-outbase-inc').addEventListener('click', () => step('c-outbase', 1));

function setUpper(v) {
  upper = v;
  $('c-lower').setAttribute('aria-pressed', String(!v));
  $('c-upper').setAttribute('aria-pressed', String(v));
  render();
}

$('c-in').addEventListener('input', render);
$('c-inbase').addEventListener('input', render);
$('c-outbase').addEventListener('input', render);
$('c-ignore').addEventListener('change', render);
$('c-lower').addEventListener('click', () => setUpper(false));
$('c-upper').addEventListener('click', () => setUpper(true));
$('c-swap').addEventListener('click', () => {
  const out = $('c-out').value;
  const ib = $('c-inbase').value;
  $('c-in').value = out;
  $('c-inbase').value = $('c-outbase').value;
  $('c-outbase').value = ib;
  render();
});

render();
