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

for (const id of ['b-inbase', 'b-outbase']) {
  const sel = $(id);
  for (let i = 2; i <= 36; i++) sel.add(new Option(String(i), String(i)));
}
$('b-inbase').value = '10';
$('b-outbase').value = '16';

function render() {
  const r = convert($('b-in').value, $('b-inbase').value, $('b-outbase').value, $('b-ignore').checked, upper);
  $('b-out').value = r.out;
  $('b-in-msg').textContent = r.numErr;
  $('b-in').setAttribute('aria-invalid', String(!!r.numErr));
}

function setUpper(v) {
  upper = v;
  $('b-lower').setAttribute('aria-pressed', String(!v));
  $('b-upper').setAttribute('aria-pressed', String(v));
  render();
}

$('b-in').addEventListener('input', render);
$('b-inbase').addEventListener('change', render);
$('b-outbase').addEventListener('change', render);
$('b-ignore').addEventListener('change', render);
$('b-lower').addEventListener('click', () => setUpper(false));
$('b-upper').addEventListener('click', () => setUpper(true));
$('b-swap').addEventListener('click', () => {
  const out = $('b-out').value;
  const ib = $('b-inbase').value;
  $('b-in').value = out;
  $('b-inbase').value = $('b-outbase').value;
  $('b-outbase').value = ib;
  render();
});

render();
