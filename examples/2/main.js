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
  const r = convert($('a-in').value, $('a-inbase').value, $('a-outbase').value, $('a-ignore').checked, upper);
  $('a-out').value = r.out;
  $('a-in-msg').textContent = r.inErr || r.numErr;
  $('a-out-msg').textContent = r.outErr;
  $('a-in').setAttribute('aria-invalid', String(!!r.numErr));
  $('a-inbase').setAttribute('aria-invalid', String(!!r.inErr));
  $('a-outbase').setAttribute('aria-invalid', String(!!r.outErr));
}

function setUpper(v) {
  upper = v;
  $('a-lower').setAttribute('aria-pressed', String(!v));
  $('a-upper').setAttribute('aria-pressed', String(v));
  render();
}

$('a-in').addEventListener('input', render);
$('a-inbase').addEventListener('input', render);
$('a-outbase').addEventListener('input', render);
$('a-ignore').addEventListener('change', render);
$('a-lower').addEventListener('click', () => setUpper(false));
$('a-upper').addEventListener('click', () => setUpper(true));
$('a-swap').addEventListener('click', () => {
  const out = $('a-out').value;
  const ib = $('a-inbase').value;
  $('a-in').value = out;
  $('a-inbase').value = $('a-outbase').value;
  $('a-outbase').value = ib;
  render();
});

render();
