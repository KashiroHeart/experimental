const GOJU = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
const IROHA = 'いろはにほへとちりぬるをわかよたれそつねならむうゐのおくやまけふこえてあさきゆめみしゑひもせす';
const CYR = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
const HEB = 'אבגדהוזחטיכלמנסעפצקרשת';
const SMALL_KANA = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ', 'ゕ': 'か', 'ゖ': 'け' };
const HEB_FINAL = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

// 表配列と、1 文字を表の位置に引く関数を作る
function makeTable(tbl, opt) {
  let chars;
  let fold = (c) => c;
  let cased = false;
  if (tbl === 'latin') {
    chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    fold = (c) => c.toUpperCase();
    cased = true;
  } else if (tbl === 'goju' || tbl === 'iroha') {
    chars = tbl === 'goju' ? GOJU : IROHA + (opt.n ? 'ん' : '');
    fold = (c) => {
      const cp = c.codePointAt(0);
      if (cp >= 0x30a1 && cp <= 0x30f6) c = String.fromCodePoint(cp - 0x60); // カタカナ → ひらがな
      return SMALL_KANA[c] || c;
    };
  } else if (tbl === 'cyr') {
    chars = opt.yo ? CYR.replace('Е', 'ЕЁ') : CYR;
    fold = (c) => {
      c = c.toUpperCase();
      return !opt.yo && c === 'Ё' ? 'Е' : c;
    };
    cased = true;
  } else {
    chars = HEB;
    fold = (c) => HEB_FINAL[c] || c;
  }
  chars = [...chars];
  const index = new Map(chars.map((c, i) => [c, i]));
  const look = (c) => {
    const i = index.get(fold(c));
    return i === undefined ? null : { i, upper: cased && c !== c.toLowerCase() };
  };
  return { tbl, chars, look };
}

// 基底文字＋結合文字のまとまりを 1 単位として表に引く。
// 合成済みの 1 文字（й、ё など）で引けなければ、基底文字だけで引いて結合文字（濁点など）は付けたまま返す
function lookCluster(t, cl) {
  const c = cl.normalize('NFC');
  if ([...c].length === 1) {
    const hit = t.look(c);
    if (hit) return { ...hit, marks: '' };
  }
  const base = String.fromCodePoint(cl.codePointAt(0));
  const hit = t.look(base);
  return hit ? { ...hit, marks: cl.slice(base.length) } : null;
}

function clusters(s) {
  return s.normalize('NFD').match(/\P{M}\p{M}*|\p{M}+/gu) || [];
}

function vigenere(text, key, t, o) {
  const r = { out: '', keyErr: false };
  const k = [];
  for (const cl of clusters(key)) {
    if (/^\s$/.test(cl)) continue;
    const hit = lookCluster(t, cl);
    if (!hit) {
      r.keyErr = true;
      return r;
    }
    k.push(hit.i);
  }
  if (!k.length) return r;

  const n = t.chars.length;
  let j = 0;
  let out = '';
  for (const cl of clusters(text)) {
    const hit = lookCluster(t, cl);
    if (!hit) {
      if (!o.drop) out += cl;
      continue;
    }
    const s = k[j++ % k.length];
    let ch = t.chars[(hit.i + (o.decrypt ? n - s : s)) % n];
    if (t.tbl === 'latin') ch = o.lower ? ch.toLowerCase() : ch;
    else if (t.tbl === 'cyr' && !hit.upper) ch = ch.toLowerCase();
    out += ch + hit.marks;
  }
  r.out = out.normalize('NFC');
  return r;
}

const $ = (id) => document.getElementById(id);
const checked = (name) => document.querySelector('input[name="' + name + '"]:checked').value;
let decrypt = false;

function options() {
  return {
    tbl: checked('tbl'),
    n: $('opt-n').checked,
    yo: $('opt-yo').checked,
    lower: checked('case') === 'lower',
    drop: checked('miss') === 'drop',
    decrypt,
  };
}

// 表見本: 先頭 5 行 × 5 列、⋯、最終行 / 列
function renderSample(t, lower) {
  const n = t.chars.length;
  const ch = (i) => (lower ? t.chars[i % n].toLowerCase() : t.chars[i % n]);
  const pick = [0, 1, 2, 3, 4, -1, n - 1];
  const cell = (tag, text, attrs) => '<' + tag + (attrs || '') + (text === '⋯' ? ' class="dots"' : '') + '>' + text + '</' + tag + '>';
  let head = cell('th', '', ' scope="col"');
  for (const c of pick) head += cell('th', c < 0 ? '⋯' : ch(c), ' scope="col"');
  let body = '';
  for (const r of pick) {
    let row = cell('th', r < 0 ? '⋯' : ch(r), ' scope="row"');
    for (const c of pick) row += cell('td', r < 0 || c < 0 ? '⋯' : ch(r + c));
    body += '<tr>' + row + '</tr>';
  }
  $('sample').innerHTML = '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>';
}

function render() {
  const o = options();
  const t = makeTable(o.tbl, o);
  const r = vigenere($('src').value, $('key').value, t, o);
  $('dst').value = r.out;
  $('key').setCustomValidity(r.keyErr ? '鍵に、表にない文字が含まれています。' : '');
  $('key').setAttribute('aria-invalid', String(r.keyErr));

  const from = decrypt ? '暗号文' : '平文';
  const to = decrypt ? '平文' : '暗号文';
  $('src-tag').textContent = from;
  $('dst-tag').textContent = to;
  if ($('dir-from')) {
    $('dir-from').textContent = from;
    $('dir-to').textContent = to;
    $('dir-mode').textContent = decrypt ? '(復号)' : '(暗号化)';
  }
  renderSample(t, o.tbl === 'latin' && o.lower);
}

$('src').addEventListener('input', render);
$('key').addEventListener('input', render);
document.addEventListener('change', (e) => {
  if (e.target.matches('input[type="radio"], input[type="checkbox"]')) render();
});
$('swap').addEventListener('click', () => {
  $('src').value = $('dst').value;
  decrypt = !decrypt;
  render();
});

render();
