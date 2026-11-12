/* ============ 書式の読み書き（DOM に触らない部分 D） ============
   #10（組み立て）と #11（翻訳）は、この節を同じ内容で持つ（example 同士で JS を共有しないため）。直すときは両方を直す。
   もとはツール置き場の internal/tools/datetime（Go）。文言・挙動はそれを写したもの。

   書式は「部品と文字の列」（[{kind, text}]）を中間表現にする。kind が "lit" なら文字（text）、それ以外は部品の種類。
   - 組み立て（compose）：列 → 全言語の書式。
   - 翻訳（translate）：From の書式を読む → 列 → To の書式で書く。
   1 言語 = makeDialect() の 1 つ。書き出しの表 out（部品 → 書式）、まとめる並び seq、読むときだけの見出し alias、
   エスケープ（escape）、読み方（lex）を持つ。
   - 書けない部品は FALLBACKS の順で近い種類に代用し（「〜で代用」）、代用も無ければ外す（「〜は表せません」）。
   - 読めない指定子は文字のまま残して注意を出す。意味が少し違うものは en(note, …) で「〜として読みました（note）」。
   - 書いた書式は必ず読み直し、元の並びに戻らなければ「一部の文字が日付の部品として読まれます」を出す
     （主に Go）。check が注意を出した言語（Excel）では読み直しの注意は出さない。
   見出しは ASCII だけなので、文字列の位置は UTF-16 の単位のまま扱ってよい（Go のバイト単位と同じ結果になる）。 */
const D = (() => {
  /** 入力の上限（コードポイント数）。組み立ては文字数＋部品の数で数える。 */
  const MAX_INPUT = 1024;

  const ERR_TOO_LONG = "入力は 1024 文字までです。";
  const ERR_LANGUAGE = "言語の指定が不正です。";
  const ERR_KIND = "部品の指定が不正です。";

  const LIT = "lit";

  /* ---- 部品 ---- */

  /** 部品の一覧。並びは部品ボタンの並び。各部品の先頭の種類が既定。
      key はショートカット（Alt＋キー）の KeyboardEvent.code。sample は 2026-03-04（水）09:05:07.123456789 JST を書いたもの。 */
  const GROUPS = [
    { id: "year", name: "年", key: "KeyY", variants: [["year4", "4 桁", "2026"], ["year2", "2 桁", "26"]] },
    { id: "month", name: "月", key: "KeyM", variants: [["month2", "2 桁", "03"], ["month1", "ゼロなし", "3"], ["monthName", "英名", "March"], ["monthAbbr", "英略称", "Mar"]] },
    { id: "day", name: "日", key: "KeyD", variants: [["day2", "2 桁", "04"], ["day1", "ゼロなし", "4"]] },
    { id: "weekday", name: "曜日", key: "KeyW", variants: [["weekdayAbbr", "英略称", "Wed"], ["weekday", "英名", "Wednesday"], ["weekdayNum", "数字（月曜 = 1）", "3"]] },
    { id: "hour", name: "時", key: "KeyH", variants: [["hour2", "24 時間・2 桁", "09"], ["hour1", "24 時間・ゼロなし", "9"], ["hour12_2", "12 時間・2 桁", "09"], ["hour12_1", "12 時間・ゼロなし", "9"]] },
    { id: "ampm", name: "午前午後", key: "KeyP", variants: [["ampm", "AM / PM", "AM"]] },
    { id: "minute", name: "分", key: "KeyN", variants: [["minute2", "2 桁", "05"], ["minute1", "ゼロなし", "5"]] },
    { id: "second", name: "秒", key: "KeyS", variants: [["second2", "2 桁", "07"], ["second1", "ゼロなし", "7"]] },
    { id: "frac", name: "小数秒", key: "KeyF", variants: [["frac3", "ミリ秒（3 桁）", "123"], ["frac6", "マイクロ秒（6 桁）", "123456"], ["frac9", "ナノ秒（9 桁）", "123456789"]] },
    { id: "tz", name: "時差", key: "KeyZ", variants: [["tzColon", "+09:00", "+09:00"], ["tzOffset", "+0900", "+0900"], ["tzName", "略称", "JST"]] },
    { id: "yday", name: "通日", key: "KeyJ", variants: [["yday", "3 桁", "063"]] },
    { id: "week", name: "週", key: "KeyK", variants: [["isoWeek", "ISO 週番号", "10"]] },
    { id: "unix", name: "UNIX 時間", key: "KeyU", variants: [["unix", "秒", "1772582707"]] },
  ].map((g) => ({ ...g, variants: g.variants.map(([kind, name, sample]) => ({ kind, name, sample })) }));

  /** 部品の種類 → { group, variant }。 */
  const KIND_INFO = new Map();
  for (const g of GROUPS) for (const v of g.variants) KIND_INFO.set(v.kind, { group: g, variant: v });

  const validKind = (kind) => KIND_INFO.has(kind);

  /** 注意に使う部品の名前（「時（24 時間・ゼロなし）」）。種類が 1 つしか無い部品は名前だけ。 */
  const label = function (kind) {
    const info = KIND_INFO.get(kind);
    if (!info) return kind;
    if (info.group.variants.length === 1) return info.group.name;
    return info.group.name + "（" + info.variant.name + "）";
  };

  /** 表せない部品の代わりに使う種類の順序。ここに無い部品は代用しない。 */
  const FALLBACKS = {
    month2: ["month1"], month1: ["month2"], monthName: ["monthAbbr"], monthAbbr: ["monthName"],
    day2: ["day1"], day1: ["day2"], weekday: ["weekdayAbbr"], weekdayAbbr: ["weekday"],
    hour2: ["hour1"], hour1: ["hour2"], hour12_2: ["hour12_1"], hour12_1: ["hour12_2"],
    minute2: ["minute1"], minute1: ["minute2"], second2: ["second1"], second1: ["second2"],
    frac3: ["frac6", "frac9"], frac6: ["frac3", "frac9"], frac9: ["frac6", "frac3"],
    tzOffset: ["tzColon"], tzColon: ["tzOffset"],
  };

  /* ---- 部品と文字の列 ---- */

  const k = (kind) => ({ kind, text: "" });
  const l = (text) => ({ kind: LIT, text });
  /** 読むときの見出し 1 つ。toks が空なら、書式としては知っているが部品にできないもの（文字のまま残す）。 */
  const e = (...toks) => ({ toks, note: "" });
  const en = (note, ...toks) => ({ toks, note });

  const sameToken = (a, b) => a.kind === b.kind && a.text === b.text;
  const sameList = (a, b) => a.length === b.length && a.every((t, i) => sameToken(t, b[i]));

  /** 文字を 1 文字ずつに割る（並びの照合を文字の切れ目に左右されなくする）。 */
  const normalize = function (toks) {
    const out = [];
    for (const t of toks) {
      if (t.kind !== LIT) out.push(k(t.kind));
      else for (const ch of t.text) out.push(l(ch));
    }
    return out;
  };

  /** 隣り合う文字をまとめ、空の文字を落とす。 */
  const merge = function (toks) {
    const out = [];
    for (const t of toks) {
      if (t.kind === LIT) {
        if (!t.text) continue;
        const last = out[out.length - 1];
        if (last && last.kind === LIT) {
          last.text += t.text;
          continue;
        }
        out.push(l(t.text));
      } else {
        out.push(k(t.kind));
      }
    }
    return out;
  };

  /** 注意の一覧。同じ文言は 1 度だけ入れる。 */
  const notes = function () {
    const list = [];
    const seen = new Set();
    return {
      add(...ms) {
        for (const m of ms) {
          if (!m || seen.has(m)) continue;
          seen.add(m);
          list.push(m);
        }
      },
      list,
    };
  };

  /** s の位置 i から始まる 1 文字（コードポイント）。 */
  const nextRune = (s, i) => String.fromCodePoint(s.codePointAt(i));
  const isLetterCode = (c) => (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
  const isLetterAt = (s, i) => isLetterCode(s.charCodeAt(i));
  /** ASCII の英字だけ大小を区別しない比較。 */
  const foldEq = function (a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      let x = a.charCodeAt(i);
      let y = b.charCodeAt(i);
      if (x >= 0x41 && x <= 0x5a) x += 0x20;
      if (y >= 0x41 && y <= 0x5a) y += 0x20;
      if (x !== y) return false;
    }
    return true;
  };
  const withTable = (...tables) => Object.assign({}, ...tables);

  const unknownNote = (key) => "「" + key + "」は読めないので文字のまま残しました";

  /** 見出し key を entry として読んだときの注意。 */
  const readNote = function (key, v) {
    if (v.toks.length === 0) return unknownNote(key);
    if (!v.note) return "";
    const names = v.toks.filter((t) => t.kind !== LIT).map((t) => label(t.kind));
    return "「" + key + "」を" + names.join("・") + "として読みました（" + v.note + "）";
  };

  /** 読んだ見出しを toks に足す。部品にできないものは文字のまま残す。 */
  const emit = function (toks, w, key, v) {
    w.add(readNote(key, v));
    if (v.toks.length === 0) toks.push(l(key));
    else toks.push(...v.toks);
  };

  /* ---- 言語 ---- */

  /** 言語 1 つ。spec は { id, name, out, seq, alias, escape, lex, check, finish }。 */
  const makeDialect = function (spec) {
    const d = { seq: [], alias: {}, check: null, finish: null, ...spec };
    d.in = new Map();
    for (const [kind, p] of Object.entries(d.out)) if (!d.in.has(p)) d.in.set(p, e(k(kind)));
    for (const r of d.seq) d.in.set(r.pat, e(...r.toks));
    for (const [key, v] of Object.entries(d.alias)) d.in.set(key, v);
    d.keys = [...d.in.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
    return d;
  };

  /** s の位置 i に合う最も長い見出し。fold なら ASCII の大小を区別しない。 */
  const longest = function (d, s, i, fold) {
    for (const key of d.keys) {
      if (key.length > s.length - i) continue;
      const head = s.slice(i, i + key.length);
      if (head === key || (fold && foldEq(head, key))) return key;
    }
    return "";
  };

  /** kind を書けるか（単独か、まとめる並びの中で）。 */
  const supports = function (d, kind) {
    if (Object.hasOwn(d.out, kind)) return true;
    return d.seq.some((r) => r.toks.some((t) => t.kind === kind));
  };

  /** toks の先頭に合うまとめの並びを探し、[並びの長さ, 書式] を返す。 */
  const matchSeq = function (d, toks) {
    for (const r of d.seq) {
      const n = normalize(r.toks);
      if (n.length <= toks.length && sameList(n, toks.slice(0, n.length))) return [n.length, r.pat];
    }
    return [0, ""];
  };

  /** 既定の組み立て。隣り合う文字をまとめてエスケープし、部品の書式はそのまま並べる。 */
  const joinPieces = function (d, ps) {
    let out = "";
    let run = "";
    for (const p of ps) {
      if (p.lit) {
        run += p.text;
        continue;
      }
      if (run) out += d.escape(run);
      run = "";
      out += p.text;
    }
    if (run) out += d.escape(run);
    return out;
  };

  /** 書式を読む。[toks, 注意]。 */
  const parse = function (d, s) {
    const [toks, w] = d.lex(d, s);
    return [merge(toks), w];
  };

  /** 部品と文字の列を書式にする。[書式, 注意（代用・表せない部品・文字の衝突）]。 */
  const format = function (d, input) {
    const toks = normalize(input);
    const w = notes();

    for (const t of toks) {
      if (t.kind === LIT || supports(d, t.kind)) continue;
      for (const alt of FALLBACKS[t.kind] || []) {
        if (supports(d, alt)) {
          w.add("「" + label(t.kind) + "」は表せないので「" + label(alt) + "」で代用");
          t.kind = alt;
          break;
        }
      }
    }

    let checked = [];
    if (d.check) {
      checked = d.check(toks);
      w.add(...checked);
    }

    const ps = [];
    const expect = [];
    for (let i = 0; i < toks.length; ) {
      const [n, pat] = matchSeq(d, toks.slice(i));
      if (n > 0) {
        ps.push({ text: pat, lit: false });
        expect.push(...toks.slice(i, i + n));
        i += n;
        continue;
      }
      const t = toks[i];
      i++;
      if (t.kind === LIT) {
        ps.push({ text: t.text, lit: true });
        expect.push(t);
        continue;
      }
      if (Object.hasOwn(d.out, t.kind)) {
        ps.push({ text: d.out[t.kind], lit: false });
        expect.push(t);
        continue;
      }
      if (supports(d, t.kind)) w.add("「" + label(t.kind) + "」はこの位置には置けません");
      else w.add("「" + label(t.kind) + "」は表せません");
    }

    const s = (d.finish || joinPieces)(d, ps);

    // 書いた書式を読み直して、文字が部品と読まれないかを確かめる（Go のレイアウトなど）。
    if (checked.length === 0) {
      const [got] = parse(d, s);
      if (!sameList(normalize(got), normalize(expect))) w.add("一部の文字が日付の部品として読まれます");
    }
    return [s, w.list];
  };

  /* ---- % で始まる指定子の言語（C の strftime とその仲間、MySQL の DATE_FORMAT） ----
     読むときは % の位置で見出しの最長一致をとり、どれにも合わなければ % と次の 1 文字を文字のまま残す。 */

  const lexPercent = function (d, s) {
    const toks = [];
    const w = notes();
    for (let i = 0; i < s.length; ) {
      if (s[i] !== "%") {
        const r = nextRune(s, i);
        toks.push(l(r));
        i += r.length;
        continue;
      }
      const key = longest(d, s, i, false);
      if (key) {
        emit(toks, w, key, d.in.get(key));
        i += key.length;
        continue;
      }
      let raw = "%";
      if (i + 1 < s.length) raw += nextRune(s, i + 1);
      w.add(unknownNote(raw));
      toks.push(l(raw));
      i += raw.length;
    }
    return [toks, w.list];
  };

  const escapePercent = (s) => s.replaceAll("%", "%%");

  /** C99 の strftime で書ける部品。 */
  const C99_OUT = {
    year4: "%Y", year2: "%y", month2: "%m", monthName: "%B", monthAbbr: "%b",
    day2: "%d", yday: "%j", weekday: "%A", weekdayAbbr: "%a", weekdayNum: "%u", isoWeek: "%V",
    hour2: "%H", hour12_2: "%I", ampm: "%p", minute2: "%M", second2: "%S",
    tzOffset: "%z", tzName: "%Z",
  };

  const NOTE_SPACE = "空白埋め";
  const NOTE_GNU = "glibc などの拡張";
  const NOTE_LOWER = "小文字";

  /** C99 の strftime の読むときだけの見出し（組み合わせの略記・別名）。 */
  const C99_ALIAS = {
    "%%": e(l("%")),
    "%n": e(l("\n")),
    "%t": e(l("\t")),
    "%h": e(k("monthAbbr")),
    "%e": en(NOTE_SPACE, k("day1")),
    "%F": e(k("year4"), l("-"), k("month2"), l("-"), k("day2")),
    "%T": e(k("hour2"), l(":"), k("minute2"), l(":"), k("second2")),
    "%R": e(k("hour2"), l(":"), k("minute2")),
    "%D": e(k("month2"), l("/"), k("day2"), l("/"), k("year2")),
    "%r": e(k("hour12_2"), l(":"), k("minute2"), l(":"), k("second2"), l(" "), k("ampm")),
    "%c": e(), "%x": e(), "%X": e(), "%C": e(), "%g": e(), "%G": e(),
    "%U": e(), "%W": e(), "%w": e(),
  };

  /** glibc の拡張（Linux の C・Perl・Python では動く）。 */
  const GNU_ALIAS = {
    "%-m": en(NOTE_GNU, k("month1")),
    "%-d": en(NOTE_GNU, k("day1")),
    "%-H": en(NOTE_GNU, k("hour1")),
    "%-I": en(NOTE_GNU, k("hour12_1")),
    "%-M": en(NOTE_GNU, k("minute1")),
    "%-S": en(NOTE_GNU, k("second1")),
    "%k": en(NOTE_SPACE, k("hour1")),
    "%l": en(NOTE_SPACE, k("hour12_1")),
    "%P": en(NOTE_LOWER, k("ampm")),
    "%s": en(NOTE_GNU, k("unix")),
  };

  /** %- でゼロ埋めを外せる言語（Ruby・Rust・Elixir）の部品。 */
  const NOPAD_OUT = { month1: "%-m", day1: "%-d", hour1: "%-H", hour12_1: "%-I", minute1: "%-M", second1: "%-S" };

  const percent = (id, name, out, alias, ...seq) => makeDialect({ id, name, out, alias, seq, escape: escapePercent, lex: lexPercent });

  const dialectC = percent("c", "C / C++ (strftime)", C99_OUT, withTable(C99_ALIAS, GNU_ALIAS));
  const dialectPython = percent("python", "Python (datetime)",
    withTable(C99_OUT, { frac6: "%f", tzColon: "%:z" }),
    withTable(C99_ALIAS, GNU_ALIAS));
  const dialectRuby = percent("ruby", "Ruby (Time#strftime)",
    withTable(C99_OUT, NOPAD_OUT, { frac3: "%L", frac6: "%6N", frac9: "%N", tzColon: "%:z", unix: "%s" }),
    withTable(C99_ALIAS, GNU_ALIAS, {
      "%-m": e(k("month1")), "%-d": e(k("day1")), "%-H": e(k("hour1")), "%-I": e(k("hour12_1")), "%-M": e(k("minute1")), "%-S": e(k("second1")),
      "%3N": e(k("frac3")), "%9N": e(k("frac9")), "%s": e(k("unix")),
    }));
  const dialectPerl = percent("perl", "Perl (POSIX::strftime)", C99_OUT, withTable(C99_ALIAS, GNU_ALIAS));
  const dialectLua = percent("lua", "Lua (os.date)", C99_OUT, C99_ALIAS);
  const dialectR = percent("r", "R (format)", C99_OUT,
    withTable(C99_ALIAS, {
      "%k": en(NOTE_SPACE, k("hour1")),
      "%l": en(NOTE_SPACE, k("hour12_1")),
      "%OS": en("小数秒は options(digits.secs) による", k("second2")),
    }),
    { toks: [k("second2"), l("."), k("frac3")], pat: "%OS3" },
    { toks: [k("second2"), l("."), k("frac6")], pat: "%OS6" });
  const dialectElixir = percent("elixir", "Elixir (Calendar.strftime)",
    withTable(NOPAD_OUT, {
      year4: "%Y", year2: "%y", month2: "%m", monthName: "%B", monthAbbr: "%b",
      day2: "%d", yday: "%j", weekday: "%A", weekdayAbbr: "%a", weekdayNum: "%u",
      hour2: "%H", hour12_2: "%I", ampm: "%p", minute2: "%M", second2: "%S",
      frac3: "%3f", frac6: "%6f", tzOffset: "%z", tzName: "%Z",
    }),
    {
      "%%": e(l("%")),
      "%f": en("桁数は値の精度による", k("frac6")),
      "%P": en(NOTE_LOWER, k("ampm")),
      "%c": e(), "%x": e(), "%X": e(), "%q": e(),
    });
  const dialectRust = percent("rust", "Rust (chrono)",
    withTable(C99_OUT, NOPAD_OUT, { frac3: "%3f", frac6: "%6f", frac9: "%9f", tzColon: "%:z", unix: "%s" }),
    withTable(C99_ALIAS, {
      "%k": en(NOTE_SPACE, k("hour1")),
      "%l": en(NOTE_SPACE, k("hour12_1")),
      "%P": en(NOTE_LOWER, k("ampm")),
      "%f": e(k("frac9")),
      "%.3f": e(l("."), k("frac3")),
      "%.6f": e(l("."), k("frac6")),
      "%.9f": e(l("."), k("frac9")),
      "%.f": en("桁数は値の精度による", l("."), k("frac9")),
      "%+": e(k("year4"), l("-"), k("month2"), l("-"), k("day2"), l("T"), k("hour2"), l(":"), k("minute2"), l(":"), k("second2"), l("."), k("frac9"), k("tzColon")),
    }));
  const dialectMySQL = percent("mysql", "MySQL (DATE_FORMAT)",
    {
      year4: "%Y", year2: "%y", month2: "%m", month1: "%c", monthName: "%M", monthAbbr: "%b",
      day2: "%d", day1: "%e", yday: "%j", weekday: "%W", weekdayAbbr: "%a", isoWeek: "%v",
      hour2: "%H", hour1: "%k", hour12_2: "%h", hour12_1: "%l", ampm: "%p",
      minute2: "%i", second2: "%s", frac6: "%f",
    },
    {
      "%%": e(l("%")),
      "%I": e(k("hour12_2")),
      "%S": e(k("second2")),
      "%T": e(k("hour2"), l(":"), k("minute2"), l(":"), k("second2")),
      "%r": e(k("hour12_2"), l(":"), k("minute2"), l(":"), k("second2"), l(" "), k("ampm")),
      "%D": e(), "%U": e(), "%u": e(), "%V": e(), "%w": e(), "%X": e(), "%x": e(),
    });

  /* ---- PHP (date) ----
     英字 1 文字が指定子。文字は \ でエスケープする（英字と \ だけ。他の記号はそのまま）。 */

  const dialectPHP = makeDialect({
    id: "php", name: "PHP (date)",
    out: {
      year4: "Y", year2: "y", month2: "m", month1: "n", monthName: "F", monthAbbr: "M",
      day2: "d", day1: "j", weekday: "l", weekdayAbbr: "D", weekdayNum: "N", isoWeek: "W",
      hour2: "H", hour1: "G", hour12_2: "h", hour12_1: "g", ampm: "A",
      minute2: "i", second2: "s", frac3: "v", frac6: "u",
      tzOffset: "O", tzColon: "P", tzName: "T", unix: "U",
    },
    alias: {
      a: en(NOTE_LOWER, k("ampm")),
      p: en("UTC は Z", k("tzColon")),
      e: en("タイムゾーン識別子", k("tzName")),
      c: e(k("year4"), l("-"), k("month2"), l("-"), k("day2"), l("T"), k("hour2"), l(":"), k("minute2"), l(":"), k("second2"), k("tzColon")),
      r: e(k("weekdayAbbr"), l(", "), k("day2"), l(" "), k("monthAbbr"), l(" "), k("year4"), l(" "), k("hour2"), l(":"), k("minute2"), l(":"), k("second2"), l(" "), k("tzOffset")),
    },
    escape(s) {
      let out = "";
      for (let i = 0; i < s.length; i++) {
        if (isLetterAt(s, i) || s[i] === "\\") out += "\\";
        out += s[i];
      }
      return out;
    },
    lex(d, s) {
      const toks = [];
      const w = notes();
      for (let i = 0; i < s.length; ) {
        if (s[i] === "\\" && i + 1 < s.length) {
          const r = nextRune(s, i + 1);
          toks.push(l(r));
          i += 1 + r.length;
        } else if (isLetterAt(s, i)) {
          const key = s[i];
          if (d.in.has(key)) emit(toks, w, key, d.in.get(key));
          else {
            w.add(unknownNote(key));
            toks.push(l(key));
          }
          i++;
        } else {
          const r = nextRune(s, i);
          toks.push(l(r));
          i += r.length;
        }
      }
      return [toks, w.list];
    },
  });

  /* ---- Go (time) ----
     参照時刻（Mon Jan 2 15:04:05 MST 2006）で書くレイアウト。エスケープが無いので、
     参照時刻と同じ並びの文字（1・2・Jan・Mon など）は部品として読まれる（format の読み直しで注意を出す）。 */

  const dialectGo = makeDialect({
    id: "go", name: "Go (time)",
    out: {
      year4: "2006", year2: "06", month2: "01", month1: "1", monthName: "January", monthAbbr: "Jan",
      day2: "02", day1: "2", yday: "002", weekday: "Monday", weekdayAbbr: "Mon",
      hour2: "15", hour12_2: "03", hour12_1: "3", ampm: "PM",
      minute2: "04", minute1: "4", second2: "05", second1: "5",
      tzOffset: "-0700", tzColon: "-07:00", tzName: "MST",
    },
    seq: [
      { toks: [l("."), k("frac3")], pat: ".000" },
      { toks: [l("."), k("frac6")], pat: ".000000" },
      { toks: [l("."), k("frac9")], pat: ".000000000" },
      { toks: [l(","), k("frac3")], pat: ",000" },
      { toks: [l(","), k("frac6")], pat: ",000000" },
      { toks: [l(","), k("frac9")], pat: ",000000000" },
    ],
    alias: {
      "_2": en(NOTE_SPACE, k("day1")),
      "__2": en(NOTE_SPACE, k("yday")),
      "pm": en(NOTE_LOWER, k("ampm")),
      "Z0700": en("UTC は Z", k("tzOffset")),
      "Z07:00": en("UTC は Z", k("tzColon")),
      "-07": en("時だけ", k("tzOffset")),
      "Z07": en("時だけ・UTC は Z", k("tzOffset")),
      "-070000": en("秒まで", k("tzOffset")),
      "-07:00:00": en("秒まで", k("tzColon")),
      "Z070000": en("秒まで・UTC は Z", k("tzOffset")),
      "Z07:00:00": en("秒まで・UTC は Z", k("tzColon")),
      ".999": en("末尾の 0 を省く", l("."), k("frac3")),
      ".999999": en("末尾の 0 を省く", l("."), k("frac6")),
      ".999999999": en("末尾の 0 を省く", l("."), k("frac9")),
    },
    escape: (s) => s,
    lex(d, s) {
      const toks = [];
      const w = notes();
      for (let i = 0; i < s.length; ) {
        const key = longest(d, s, i, false);
        if (key) {
          emit(toks, w, key, d.in.get(key));
          i += key.length;
          continue;
        }
        const r = nextRune(s, i);
        toks.push(l(r));
        i += r.length;
      }
      return [toks, w.list];
    },
  });

  /* ---- 英字の繰り返しの数で決まる書式（Unicode LDML 系） ----
     Java・Swift（ICU）・Dart（intl）と、その亜種の C#（.NET）。 */

  /** Java（java.time）で書ける部品。Swift もこれをそのまま使う。 */
  const LDML_OUT = {
    year4: "yyyy", year2: "yy", month2: "MM", month1: "M", monthName: "MMMM", monthAbbr: "MMM",
    day2: "dd", day1: "d", yday: "DDD", weekday: "EEEE", weekdayAbbr: "EEE",
    hour2: "HH", hour1: "H", hour12_2: "hh", hour12_1: "h", ampm: "a",
    minute2: "mm", minute1: "m", second2: "ss", second1: "s",
    frac3: "SSS", frac6: "SSSSSS", frac9: "SSSSSSSSS",
    tzOffset: "xx", tzColon: "xxx", tzName: "zzz",
  };

  const NOTE_UTC_Z = "UTC は Z";
  const NOTE_PADDING = "ゼロ埋めの桁数が違う";

  /** Java と Swift の読むときだけの見出し。 */
  const LDML_ALIAS = {
    y: e(k("year4")), yyy: e(k("year4")),
    u: e(k("year4")), uuu: e(k("year4")), uuuu: e(k("year4")), uu: e(k("year2")),
    L: e(k("month1")), LL: e(k("month2")), LLL: e(k("monthAbbr")), LLLL: e(k("monthName")),
    D: en(NOTE_PADDING, k("yday")), DD: en(NOTE_PADDING, k("yday")),
    E: e(k("weekdayAbbr")), EE: e(k("weekdayAbbr")),
    z: e(k("tzName")), zz: e(k("tzName")), zzzz: en("正式名", k("tzName")),
    VV: en("タイムゾーン ID", k("tzName")),
    Z: e(k("tzOffset")), ZZ: e(k("tzOffset")), ZZZ: e(k("tzOffset")),
    ZZZZZ: en(NOTE_UTC_Z, k("tzColon")), XXX: en(NOTE_UTC_Z, k("tzColon")), XX: en(NOTE_UTC_Z, k("tzOffset")),
    X: en("時だけ・UTC は Z", k("tzOffset")), x: en("時だけ", k("tzOffset")),
    G: e(), Q: e(), q: e(), Y: e(), w: e(), W: e(), e: e(), c: e(),
    k: e(), K: e(), A: e(), n: e(), N: e(), B: e(), S: e(), SS: e(),
  };

  /** 文字の並びを '…' で囲む（' は '' にする）。英字と reserved の記号を含むときだけ囲む。 */
  const quoteLDML = (reserved) => function (s) {
    let need = false;
    for (let i = 0; i < s.length; i++) {
      if (isLetterAt(s, i) || s[i] === "'" || reserved.includes(s[i])) {
        need = true;
        break;
      }
    }
    if (!need) return s;
    if (s.replace(/^'+|'+$/g, "") === "") return "''".repeat(s.length);
    return "'" + s.replaceAll("'", "''") + "'";
  };

  /** '…' で囲む言語（Java・Swift・Dart）の書式を読む。 */
  const lexLDML = function (d, s) {
    const toks = [];
    const w = notes();
    for (let i = 0; i < s.length; ) {
      const c = s[i];
      if (c === "'") {
        if (i + 1 < s.length && s[i + 1] === "'") {
          toks.push(l("'"));
          i += 2;
          continue;
        }
        let b = "";
        let j = i + 1;
        for (; j < s.length; j++) {
          if (s[j] === "'") {
            if (j + 1 < s.length && s[j + 1] === "'") {
              b += "'";
              j++;
              continue;
            }
            break;
          }
          b += s[j];
        }
        if (j >= s.length) w.add("引用符が閉じていません");
        toks.push(l(b));
        i = j + 1;
      } else if (isLetterAt(s, i)) {
        let j = i;
        while (j < s.length && s[j] === c) j++;
        const key = s.slice(i, j);
        if (d.in.has(key)) emit(toks, w, key, d.in.get(key));
        else {
          w.add(unknownNote(key));
          toks.push(l(key));
        }
        i = j;
      } else {
        const r = nextRune(s, i);
        if (d.in.has(r)) emit(toks, w, r, d.in.get(r));
        else toks.push(l(r));
        i += r.length;
      }
    }
    return [toks, w.list];
  };

  const dialectJava = makeDialect({
    id: "java", name: "Java / Kotlin (java.time)",
    out: LDML_OUT,
    alias: withTable(LDML_ALIAS, {
      "[": en("省略できる部分の始まり"), "]": en("省略できる部分の終わり"), "#": e(), "{": e(), "}": e(),
    }),
    escape: quoteLDML("[]{}#"), lex: lexLDML,
  });
  const dialectSwift = makeDialect({
    id: "swift", name: "Swift (DateFormatter)",
    out: LDML_OUT, alias: LDML_ALIAS,
    escape: quoteLDML(""), lex: lexLDML,
  });
  const dialectDart = makeDialect({
    id: "dart", name: "Dart (intl)",
    out: {
      year4: "yyyy", year2: "yy", month2: "MM", month1: "M", monthName: "MMMM", monthAbbr: "MMM",
      day2: "dd", day1: "d", yday: "DDD", weekday: "EEEE", weekdayAbbr: "EEE",
      hour2: "HH", hour1: "H", hour12_2: "hh", hour12_1: "h", ampm: "a",
      minute2: "mm", minute1: "m", second2: "ss", second1: "s", frac3: "SSS",
    },
    alias: {
      y: e(k("year4")), yyy: e(k("year4")),
      L: e(k("month1")), LL: e(k("month2")), LLL: e(k("monthAbbr")), LLLL: e(k("monthName")),
      D: en(NOTE_PADDING, k("yday")), DD: en(NOTE_PADDING, k("yday")),
      E: e(k("weekdayAbbr")), EE: e(k("weekdayAbbr")),
      G: e(), Q: e(), k: e(), K: e(), S: e(), SS: e(),
      z: en("intl では未実装"), Z: en("intl では未実装"), v: e(),
    },
    escape: quoteLDML(""), lex: lexLDML,
  });

  /* ---- C# (.NET) ----
     文字は '…' か "…" で囲むか \ でエスケープする。書式が 1 文字だけなら標準書式と区別するため % を前に付ける。 */

  const CSHARP_RESERVED = "dfFghHKmMstyz";

  const dialectCSharp = makeDialect({
    id: "csharp", name: "C# (.NET)",
    out: {
      year4: "yyyy", year2: "yy", month2: "MM", month1: "M", monthName: "MMMM", monthAbbr: "MMM",
      day2: "dd", day1: "d", weekday: "dddd", weekdayAbbr: "ddd",
      hour2: "HH", hour1: "H", hour12_2: "hh", hour12_1: "h", ampm: "tt",
      minute2: "mm", minute1: "m", second2: "ss", second1: "s",
      frac3: "fff", frac6: "ffffff", tzColon: "zzz",
    },
    alias: {
      yyy: en(NOTE_PADDING, k("year4")), yyyyy: en(NOTE_PADDING, k("year4")),
      y: en("ゼロ埋めなし", k("year2")),
      t: en("1 文字（A / P）", k("ampm")),
      z: en("時だけ・ゼロ埋めなし", k("tzOffset")),
      zz: en("時だけ", k("tzOffset")),
      K: en(NOTE_UTC_Z, k("tzColon")),
      f: e(), ff: e(), ffff: e(), fffff: e(), fffffff: e(),
      F: e(), FF: e(), FFF: e(), FFFF: e(), FFFFF: e(), FFFFFF: e(), FFFFFFF: e(),
      g: e(), gg: e(),
    },
    escape(s) {
      let need = false;
      for (let i = 0; i < s.length; i++) {
        if (isLetterAt(s, i) || "'\"\\%".includes(s[i])) {
          need = true;
          break;
        }
      }
      if (!need) return s;
      return "'" + s.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'";
    },
    finish(d, ps) {
      if (ps.length === 1 && !ps[0].lit && ps[0].text.length === 1) return "%" + ps[0].text;
      return joinPieces(d, ps);
    },
    lex(d, s) {
      const toks = [];
      const w = notes();
      for (let i = 0; i < s.length; ) {
        const c = s[i];
        if (c === "\\" && i + 1 < s.length) {
          const r = nextRune(s, i + 1);
          toks.push(l(r));
          i += 1 + r.length;
        } else if (c === "'" || c === '"') {
          let b = "";
          let j = i + 1;
          for (; j < s.length && s[j] !== c; j++) {
            if (s[j] === "\\" && j + 1 < s.length) j++;
            b += s[j];
          }
          if (j >= s.length) w.add("引用符が閉じていません");
          toks.push(l(b));
          i = j + 1;
        } else if (c === "%" && i + 1 < s.length && isLetterAt(s, i + 1)) {
          i++;
        } else if (isLetterAt(s, i)) {
          let j = i;
          while (j < s.length && s[j] === c) j++;
          const key = s.slice(i, j);
          if (d.in.has(key)) emit(toks, w, key, d.in.get(key));
          else {
            if (CSHARP_RESERVED.includes(c)) w.add(unknownNote(key));
            toks.push(l(key));
          }
          i = j;
        } else {
          const r = nextRune(s, i);
          toks.push(l(r));
          i += r.length;
        }
      }
      return [toks, w.list];
    },
  });

  /* ---- キーワードで書く書式（PostgreSQL・Oracle の to_char / TO_CHAR） ----
     大小を区別せず最長一致で読む。FM はゼロ埋めと名前の空白埋めを外す。
     PostgreSQL は直後の 1 要素だけに、Oracle は以降すべてに効く（もう一度書くと戻る）。文字は "…" で囲む。 */

  const NOTE_PAD9 = "空白で 9 文字に埋まる";
  const NOTE_NO_FM = "ゼロ埋めなし";

  /** キーワード 1 つ。pad は FM なし、fm は FM ありで読んだもの。 */
  const tc = (kw, pad, fm) => ({ kw, pad, fm });
  /** FM の有無で変わらないキーワード。 */
  const same = (kw, v) => tc(kw, v, v);
  /** 書式としては知っているが部品にできないキーワード。 */
  const unknownKW = (...kws) => kws.map((kw) => same(kw, e()));

  /** PostgreSQL と Oracle で同じキーワード。 */
  const TC_COMMON = [
    same("YYYY", e(k("year4"))),
    tc("YY", e(k("year2")), en(NOTE_NO_FM, k("year2"))),
    tc("MM", e(k("month2")), e(k("month1"))),
    tc("MONTH", en(NOTE_PAD9, k("monthName")), e(k("monthName"))),
    same("MON", e(k("monthAbbr"))),
    tc("DDD", e(k("yday")), en(NOTE_NO_FM, k("yday"))),
    tc("DD", e(k("day2")), e(k("day1"))),
    tc("DAY", en(NOTE_PAD9, k("weekday")), e(k("weekday"))),
    same("DY", e(k("weekdayAbbr"))),
    tc("IW", e(k("isoWeek")), en(NOTE_NO_FM, k("isoWeek"))),
    tc("HH24", e(k("hour2")), e(k("hour1"))),
    tc("HH12", e(k("hour12_2")), e(k("hour12_1"))),
    tc("HH", e(k("hour12_2")), e(k("hour12_1"))),
    tc("MI", e(k("minute2")), e(k("minute1"))),
    tc("SS", e(k("second2")), e(k("second1"))),
    same("AM", e(k("ampm"))), same("PM", e(k("ampm"))),
    same("A.M.", en("A.M. の形", k("ampm"))), same("P.M.", en("A.M. の形", k("ampm"))),
    same("TZH:TZM", e(k("tzColon"))),
    same("TZHTZM", e(k("tzOffset"))),
    same("TZH", en("時だけ", k("tzOffset"))),
  ];

  const TC_UNKNOWN_COMMON = [
    "Y,YYY", "YYY", "Y", "IYYY", "IYY", "IY", "I", "SSSSS", "D", "W", "WW", "Q", "RM", "CC", "J",
    "BC", "AD", "B.C.", "A.D.", "TZM",
  ];

  /** 書き出しの書式。FM が要るものは前に FM を付けて書く（Oracle は finish で切り替えに直す）。 */
  const TC_OUT = {
    year4: "YYYY", year2: "YY", month2: "MM", month1: "FMMM", monthName: "FMMonth", monthAbbr: "Mon",
    day2: "DD", day1: "FMDD", yday: "DDD", weekday: "FMDay", weekdayAbbr: "Dy", isoWeek: "IW",
    hour2: "HH24", hour1: "FMHH24", hour12_2: "HH12", hour12_1: "FMHH12", ampm: "AM",
    minute2: "MI", minute1: "FMMI", second2: "SS", second1: "FMSS",
    tzOffset: "TZHTZM", tzColon: "TZH:TZM",
  };

  const toChar = function (id, name, oracle, out, elems, quoteFree, ...indifferent) {
    const pad = new Map();
    const fm = new Map();
    for (const el of elems) {
      pad.set(el.kw, el.pad);
      fm.set(el.kw, el.fm);
    }
    const isIndifferent = new Set(indifferent);
    const spec = { id, name, out, alias: Object.fromEntries(pad) };
    spec.escape = function (s) {
      let need = false;
      for (const r of s) {
        const cp = r.codePointAt(0);
        if ((oracle && !quoteFree.includes(r)) || (cp < 0x80 && (isLetterCode(cp) || r === '"' || r === "\\"))) {
          need = true;
          break;
        }
      }
      if (!need) return s;
      if (oracle) return '"' + s.replaceAll('"', "") + '"';
      return '"' + s.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
    };
    if (oracle) {
      // FM を「以降すべて」の切り替えとして書き直す。FM の有無で変わらない要素では切り替えない。
      spec.finish = function (d, ps) {
        let out = "";
        let run = "";
        let on = false;
        for (const p of ps) {
          if (p.lit) {
            run += p.text;
            continue;
          }
          if (run) out += d.escape(run);
          run = "";
          const want = p.text.startsWith("FM");
          const body = want ? p.text.slice(2) : p.text;
          if (!isIndifferent.has(body.toUpperCase()) && want !== on) {
            out += "FM";
            on = want;
          }
          out += body;
        }
        if (run) out += d.escape(run);
        return out;
      };
    }
    spec.lex = function (d, s) {
      const toks = [];
      const w = notes();
      let on = false;
      for (let i = 0; i < s.length; ) {
        const c = s[i];
        if (c === '"') {
          let b = "";
          let j = i + 1;
          for (; j < s.length && s[j] !== '"'; j++) {
            if (!oracle && s[j] === "\\" && j + 1 < s.length) j++;
            b += s[j];
          }
          if (j >= s.length) w.add("引用符が閉じていません");
          toks.push(l(b));
          i = j + 1;
          continue;
        }
        if (s.length - i >= 2 && foldEq(s.slice(i, i + 2), "FM")) {
          on = oracle ? !on : true;
          i += 2;
          continue;
        }
        if (!oracle && s.length - i >= 2 && foldEq(s.slice(i, i + 2), "TM")) {
          w.add("「TM」（名前を各国語にする）は外しました");
          i += 2;
          continue;
        }
        const key = longest(d, s, i, true);
        if (key) {
          const v = (on ? fm.get(key) : pad.get(key)) || e();
          emit(toks, w, s.slice(i, i + key.length), v);
          i += key.length;
          if (!oracle) on = false;
          continue;
        }
        const r = nextRune(s, i);
        toks.push(l(r));
        i += r.length;
      }
      return [toks, w.list];
    };
    return makeDialect(spec);
  };

  const dialectPostgres = toChar("postgres", "PostgreSQL (to_char)", false,
    withTable(TC_OUT, { weekdayNum: "ID", frac3: "MS", frac6: "US", tzName: "TZ" }),
    [
      ...TC_COMMON,
      same("ID", e(k("weekdayNum"))),
      same("MS", e(k("frac3"))), same("US", e(k("frac6"))),
      same("FF3", e(k("frac3"))), same("FF6", e(k("frac6"))),
      same("TZ", e(k("tzName"))),
      same("OF", en("分が 0 なら時だけ", k("tzColon"))),
      ...unknownKW(...TC_UNKNOWN_COMMON, "SSSS", "FF1", "FF2", "FF4", "FF5"),
    ],
    "");
  const dialectOracle = toChar("oracle", "Oracle (TO_CHAR)", true,
    withTable(TC_OUT, { frac3: "FF3", frac6: "FF6", frac9: "FF9", tzName: "TZD" }),
    [
      ...TC_COMMON,
      same("FF3", e(k("frac3"))), same("FF6", e(k("frac6"))), same("FF9", e(k("frac9"))),
      same("TZD", e(k("tzName"))),
      same("TZR", en("リージョン名", k("tzName"))),
      ...unknownKW(...TC_UNKNOWN_COMMON, "SCC", "FF1", "FF2", "FF4", "FF5", "FF7", "FF8", "FF", "DL", "DS", "TS", "X", "EE", "E"),
    ],
    " -/,.;:", "MON", "DY", "AM", "PM", "YYYY", "TZD", "TZH:TZM", "TZHTZM", "FF3", "FF6", "FF9");

  /* ---- Excel（表示形式） ----
     大小を区別しない英字の繰り返しで書く。m / mm は前に時・後に秒があれば「分」、そうでなければ「月」。
     h / hh は書式のどこかに AM/PM があれば 12 時間制、無ければ 24 時間制。小数秒は ss.000 の形だけ。 */

  const EXCEL_SAFE = "$-+/():!^&'~{}<>= ";

  // 読む途中の仮の部品（並び全体を見てから月 / 分・12 / 24 時間制を決める）。
  const EXCEL_M1 = "_m1";
  const EXCEL_M2 = "_m2";
  const EXCEL_H1 = "_h1";
  const EXCEL_H2 = "_h2";

  const isHour = (kind) => ["hour2", "hour1", "hour12_2", "hour12_1", EXCEL_H1, EXCEL_H2].includes(kind);
  const isSecond = (kind) => kind === "second2" || kind === "second1";

  /** toks[i] の前後で最も近い部品（文字を飛ばす）。無ければ空。 */
  const neighbors = function (toks, i) {
    let prev = "";
    let next = "";
    for (let j = i - 1; j >= 0; j--) {
      if (toks[j].kind !== LIT) {
        prev = toks[j].kind;
        break;
      }
    }
    for (let j = i + 1; j < toks.length; j++) {
      if (toks[j].kind !== LIT) {
        next = toks[j].kind;
        break;
      }
    }
    return [prev, next];
  };

  const minuteContext = function (toks, i) {
    const [prev, next] = neighbors(toks, i);
    return isHour(prev) || isSecond(next);
  };

  const dialectExcel = makeDialect({
    id: "excel", name: "Excel (表示形式)",
    out: {
      year4: "yyyy", year2: "yy", month2: "mm", month1: "m", monthName: "mmmm", monthAbbr: "mmm",
      day2: "dd", day1: "d", weekday: "dddd", weekdayAbbr: "ddd",
      hour2: "hh", hour1: "h", hour12_2: "hh", hour12_1: "h", ampm: "AM/PM",
      minute2: "mm", minute1: "m", second2: "ss", second1: "s",
    },
    seq: [{ toks: [l("."), k("frac3")], pat: ".000" }],
    escape(s) {
      let out = "";
      let q = "";
      const flush = function () {
        if (q) out += '"' + q + '"';
        q = "";
      };
      for (const r of s) {
        if (r === '"') {
          flush();
          out += '\\"';
        } else if (EXCEL_SAFE.includes(r)) {
          flush();
          out += r;
        } else {
          q += r;
        }
      }
      flush();
      return out;
    },
    check(toks) {
      const w = notes();
      const ampm = toks.some((t) => t.kind === "ampm");
      toks.forEach(function (t, i) {
        switch (t.kind) {
          case "hour2":
          case "hour1":
            if (ampm) w.add("AM/PM があると「時」は 12 時間制になります");
            break;
          case "hour12_2":
          case "hour12_1":
            if (!ampm) w.add("AM/PM が無いと「時」は 24 時間制になります");
            break;
          case "minute2":
          case "minute1":
            if (!minuteContext(toks, i)) w.add("前に時・後に秒の無い「分」は「月」と読まれます");
            break;
          case "month2":
          case "month1":
            if (minuteContext(toks, i)) w.add("前に時・後に秒のある「月」は「分」と読まれます");
            break;
          case "frac3":
            if (i < 2 || !sameToken(toks[i - 1], l(".")) || !isSecond(toks[i - 2].kind)) w.add("「小数秒」は秒と「.」の直後にしか置けません");
            break;
        }
      });
      return w.list;
    },
    lex(d, s) {
      const toks = [];
      const w = notes();
      for (let i = 0; i < s.length; ) {
        const c = s[i];
        const lower = s.charCodeAt(i) | 0x20;
        if (c === '"') {
          const j = s.indexOf('"', i + 1);
          if (j < 0) {
            w.add("引用符が閉じていません");
            toks.push(l(s.slice(i + 1)));
            i = s.length;
            continue;
          }
          toks.push(l(s.slice(i + 1, j)));
          i = j + 1;
        } else if (c === "\\" && i + 1 < s.length) {
          const r = nextRune(s, i + 1);
          toks.push(l(r));
          i += 1 + r.length;
        } else if (c === "[") {
          let j = s.indexOf("]", i);
          if (j < 0) j = s.length - 1;
          w.add("「" + s.slice(i, j + 1) + "」は読めないので外しました");
          i = j + 1;
        } else if (s.length - i >= 5 && foldEq(s.slice(i, i + 5), "AM/PM")) {
          toks.push(k("ampm"));
          i += 5;
        } else if (s.length - i >= 3 && foldEq(s.slice(i, i + 3), "A/P")) {
          emit(toks, w, s.slice(i, i + 3), en("1 文字（A / P）", k("ampm")));
          i += 3;
        } else if ("ymdhs".includes(String.fromCharCode(lower)) && isLetterAt(s, i)) {
          let j = i;
          while (j < s.length && (s.charCodeAt(j) | 0x20) === lower) j++;
          const n = j - i;
          let kind = "";
          switch (String.fromCharCode(lower)) {
            case "y": kind = n <= 2 ? "year2" : "year4"; break;
            case "m": kind = [EXCEL_M1, EXCEL_M2, "monthAbbr", "monthName"][Math.min(n, 4) - 1]; break;
            case "d": kind = ["day1", "day2", "weekdayAbbr", "weekday"][Math.min(n, 4) - 1]; break;
            case "h": kind = n === 1 ? EXCEL_H1 : EXCEL_H2; break;
            case "s": kind = n === 1 ? "second1" : "second2"; break;
          }
          if (lower === 0x6d && n > 4) {
            w.add(unknownNote(s.slice(i, j)));
            toks.push(l(s.slice(i, j)));
          } else {
            toks.push(k(kind));
          }
          i = j;
        } else if (c === "." && i + 1 < s.length && s[i + 1] === "0" && toks.length > 0 && isSecond(toks[toks.length - 1].kind)) {
          let j = i + 1;
          while (j < s.length && s[j] === "0") j++;
          if (j - i - 1 === 3) toks.push(l("."), k("frac3"));
          else emit(toks, w, s.slice(i, j), en("3 桁でない", l("."), k("frac3")));
          i = j;
        } else {
          const r = nextRune(s, i);
          if (isLetterAt(s, i)) w.add(unknownNote(r));
          toks.push(l(r));
          i += r.length;
        }
      }
      const ampm = toks.some((t) => t.kind === "ampm");
      toks.forEach(function (t, i) {
        if (t.kind === EXCEL_H1 || t.kind === EXCEL_H2) {
          const one = t.kind === EXCEL_H1;
          t.kind = ampm ? (one ? "hour12_1" : "hour12_2") : (one ? "hour1" : "hour2");
        } else if (t.kind === EXCEL_M1 || t.kind === EXCEL_M2) {
          const one = t.kind === EXCEL_M1;
          t.kind = minuteContext(toks, i) ? (one ? "minute1" : "minute2") : (one ? "month1" : "month2");
        }
      });
      return [toks, w.list];
    },
  });

  /** 対応する言語。並びは表と選択肢の並び。 */
  const DIALECTS = [
    dialectC, dialectPython, dialectRuby, dialectPerl, dialectLua,
    dialectR, dialectElixir, dialectRust,
    dialectPHP, dialectGo,
    dialectJava, dialectCSharp, dialectSwift, dialectDart,
    dialectMySQL, dialectPostgres, dialectOracle, dialectExcel,
  ];
  const LANGUAGES = DIALECTS.map((d) => ({ id: d.id, name: d.name }));
  const lookup = (id) => DIALECTS.find((d) => d.id === id) || null;

  /* ---- 組み立て・翻訳 ---- */

  /** 部品と文字の列から、全言語の書式を作る。{ rows: [{id, name, pattern, warnings}], error }。 */
  const compose = function (tokens) {
    let n = 0;
    for (const t of tokens) {
      if (t.kind === LIT) {
        n += Array.from(t.text).length;
        continue;
      }
      if (!validKind(t.kind)) return { rows: [], error: ERR_KIND };
      n++;
    }
    if (n > MAX_INPUT) return { rows: [], error: ERR_TOO_LONG };
    const toks = tokens.map((t) => (t.kind === LIT ? l(t.text) : k(t.kind)));
    const rows = DIALECTS.map(function (d) {
      const [pattern, warnings] = format(d, toks);
      return { id: d.id, name: d.name, pattern, warnings };
    });
    return { rows, error: "" };
  };

  /** From の書式を読み、To の書式で書き直す。{ output, warnings（読むとき → 書くとき）, error }。 */
  const translate = function (fromId, toId, input) {
    const from = lookup(fromId);
    const to = lookup(toId);
    if (!from || !to) return { output: "", warnings: [], error: ERR_LANGUAGE };
    if (Array.from(input).length > MAX_INPUT) return { output: "", warnings: [], error: ERR_TOO_LONG };
    const [toks, readNotes] = parse(from, input);
    const [output, writeNotes] = format(to, toks);
    const w = notes();
    w.add(...readNotes);
    w.add(...writeNotes);
    return { output, warnings: w.list, error: "" };
  };

  /* ---- 画面向けの列の扱い ---- */

  /** 入力の長さ。文字は 1 文字（コードポイント）ずつ、部品は 1 つで 1 と数える（上限と同じ数え方）。 */
  const countTokens = function (tokens) {
    let n = 0;
    for (const t of tokens) n += t.kind === LIT ? Array.from(t.text).length : 1;
    return n;
  };

  /** 共有 URL に載せる形。文字は文字列、部品は [kind]。 */
  const encodeTokens = (tokens) => merge(tokens).map((t) => (t.kind === LIT ? t.text : [t.kind]));

  /** encodeTokens の逆。知らない部品・型の違う要素があれば undefined（呼び出し側で既定のままにする）。 */
  const decodeTokens = function (value) {
    if (!Array.isArray(value)) return undefined;
    const out = [];
    for (const v of value) {
      if (typeof v === "string") out.push(l(v));
      else if (Array.isArray(v) && v.length === 1 && typeof v[0] === "string" && validKind(v[0])) out.push(k(v[0]));
      else return undefined;
    }
    return merge(out);
  };

  /** 同じ部品の次の種類（末尾の次は先頭）。 */
  const nextVariant = function (kinds, kind) {
    const i = kinds.indexOf(kind);
    return kinds[(i + 1) % kinds.length];
  };

  return {
    MAX_INPUT, LIT, GROUPS, LANGUAGES,
    compose, translate, merge, countTokens, encodeTokens, decodeTokens, nextVariant,
  };
})();

/* ============ 画面（組み立て） ============
   - 入力欄（#editor、contenteditable）に、文字と部品のチップ（span.dt-chip、contenteditable=false）を並べる。
     欄の DOM がそのまま状態で、readEditor() が [{kind, text}] に読み出す。
   - 部品は部品ボタンか Alt＋キー（KeyboardEvent.code）で入れる。直前が同じ部品のチップなら種類を切り替える。
   - チップを押すと種類の候補（#chip_pop）が出る。改行は入れない。貼り付けは文字だけ。
   - チップは Backspace / Delete で 1 つずつ消す（ブラウザ任せにすると末尾のチップを消せないことがある）。
   - 入力が変わるたびに全言語の書式を作り直して表に出す。 */
(() => {
  const MAX = D.MAX_INPUT;
  const LIT = D.LIT;

  const $ = (id) => document.getElementById(id);
  const el = {};
  for (const id of ["parts", "tip_parts", "editor", "clear", "error", "count", "share", "rows", "chip_pop", "chip_delete"]) el[id] = $(id);

  /* ---- アイコン ---- */

  const ICON_PATHS = {
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    warning: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10.5v4M12 17.25v.01"/>',
  };
  const icon = (name, size) =>
    '<svg class="yt-icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICON_PATHS[name] + "</svg>";

  /** コピーの完了表示。1.6 秒だけアイコンを check・文字色を teal-ink にする。 */
  const flashDone = function (btn) {
    const svg = btn.querySelector("svg.yt-icon");
    if (!btn._prev) btn._prev = svg ? svg.outerHTML : null;
    btn.classList.add("is-done");
    if (svg) svg.outerHTML = icon("check", +svg.getAttribute("width") || 18);
    clearTimeout(btn._timer);
    btn._timer = setTimeout(function () {
      const cur = btn.querySelector("svg.yt-icon");
      if (cur && btn._prev) cur.outerHTML = btn._prev;
      btn._prev = null;
      btn.classList.remove("is-done");
    }, 1600);
  };

  const copyText = async function (text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      flashDone(btn);
    } catch {
      /* 書き込めなければ何もしない */
    }
  };

  /* ---- 共有 URL（?i= に JSON → UTF-8 → base64url） ---- */

  const encodeShare = function (obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const decodeShare = function () {
    try {
      const raw = new URLSearchParams(location.search).get("i");
      if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
      const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const obj = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
    } catch {
      return null;
    }
  };

  /* ---- 部品の表 ---- */

  /** group id → { id, name, key, kinds: [kind], names: {kind: 種類名}, box } */
  const groups = new Map();
  /** kind → group */
  const groupOf = new Map();

  const tipLines = [];
  for (const g of D.GROUPS) {
    const keyName = g.key.slice(3);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "yt-btn yt-btn--sm dt-part";
    btn.dataset.group = g.id;
    btn.title = g.name + "（Alt+" + keyName + "）";
    btn.textContent = g.name;
    el.parts.insertBefore(btn, el.parts.querySelector(".dt-parts__tip"));
    tipLines.push("Alt+" + keyName + " " + g.name);

    const box = document.createElement("div");
    box.className = "yt-tr__choices dt-variants";
    box.hidden = true;
    const entry = { id: g.id, name: g.name, key: g.key, kinds: [], names: {}, box };
    for (const v of g.variants) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "yt-tr__choice";
      b.dataset.value = v.kind;
      b.setAttribute("aria-pressed", "false");
      b.textContent = v.name;
      const sample = document.createElement("span");
      sample.className = "dt-sample";
      sample.textContent = v.sample;
      b.append(sample);
      box.append(b);
      entry.kinds.push(v.kind);
      entry.names[v.kind] = v.name;
      groupOf.set(v.kind, entry);
    }
    el.chip_pop.insertBefore(box, el.chip_pop.querySelector(".dt-chippop__foot"));
    groups.set(g.id, entry);
  }
  const groupByKey = new Map([...groups.values()].map((g) => [g.key, g]));
  el.tip_parts.textContent = "ボタンか Alt＋キーで部品を入れます。\n" + tipLines.join("\n") + "\n同じキーを続けて押すと種類が切り替わります。\n入れた部品を押すと種類を選べます。";

  const markChoice = function (box, value) {
    for (const b of box.querySelectorAll(".yt-tr__choice")) b.setAttribute("aria-pressed", String(b.dataset.value === value));
  };

  /* ---- 入力欄 ---- */

  const setChipKind = function (chip, kind) {
    const g = groupOf.get(kind);
    chip.dataset.kind = kind;
    chip.dataset.group = g.id;
    chip.replaceChildren();
    const name = document.createElement("span");
    name.className = "dt-chip__name";
    name.textContent = g.name;
    chip.append(name);
    if (g.kinds.length > 1) {
      const sub = document.createElement("span");
      sub.className = "dt-chip__variant";
      sub.textContent = g.names[kind];
      chip.append(sub);
    }
    chip.title = g.kinds.length > 1 ? g.name + "（" + g.names[kind] + "）" : g.name;
  };

  const makeChip = function (kind) {
    const chip = document.createElement("span");
    chip.className = "dt-chip";
    chip.contentEditable = "false";
    setChipKind(chip, kind);
    return chip;
  };

  /** 入力欄の DOM を [{kind, text}] に読む。ブラウザが足す <br> や <div> は中身だけ見る。 */
  const readEditor = function () {
    const out = [];
    const walk = function (node) {
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) out.push({ kind: LIT, text: n.nodeValue.replace(/[​\n\r]/g, "") });
        else if (n.nodeType === Node.ELEMENT_NODE && n.classList.contains("dt-chip")) out.push({ kind: n.dataset.kind, text: "" });
        else if (n.nodeType === Node.ELEMENT_NODE) walk(n);
      }
    };
    walk(el.editor);
    return D.merge(out);
  };

  const renderEditor = function (tokens) {
    el.editor.replaceChildren();
    for (const t of tokens) el.editor.append(t.kind === LIT ? document.createTextNode(t.text) : makeChip(t.kind));
  };

  /* 部品ボタンを押すとフォーカスが外れるので、入力欄の中の最後のカーソル位置を覚えておく。 */
  let lastRange = null;
  document.addEventListener("selectionchange", function () {
    const sel = getSelection();
    if (sel.rangeCount && el.editor.contains(sel.getRangeAt(0).startContainer)) lastRange = sel.getRangeAt(0).cloneRange();
  });

  const caretRange = function () {
    const sel = getSelection();
    if (sel.rangeCount && el.editor.contains(sel.getRangeAt(0).startContainer)) return sel.getRangeAt(0);
    if (lastRange && el.editor.contains(lastRange.startContainer)) return lastRange;
    const r = document.createRange();
    r.selectNodeContents(el.editor);
    r.collapse(false);
    return r;
  };

  const placeCaret = function (range) {
    el.editor.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    lastRange = range.cloneRange();
  };

  const isBlank = (text) => text.replace(/​/g, "") === "";

  /** カーソルのすぐ前にあるチップ（間に空の文字しか無ければ）。 */
  const chipBeforeCaret = function (range) {
    if (!range.collapsed) return null;
    let node;
    const c = range.startContainer;
    if (c === el.editor) node = el.editor.childNodes[range.startOffset - 1];
    else if (c.nodeType === Node.TEXT_NODE && isBlank(c.nodeValue.slice(0, range.startOffset))) node = c.previousSibling;
    while (node && node.nodeType === Node.TEXT_NODE && isBlank(node.nodeValue)) node = node.previousSibling;
    return node && node.nodeType === Node.ELEMENT_NODE && node.classList.contains("dt-chip") ? node : null;
  };

  /** カーソルのすぐ後ろにあるチップ（間に空の文字しか無ければ）。 */
  const chipAfterCaret = function (range) {
    if (!range.collapsed) return null;
    let node;
    const c = range.startContainer;
    if (c === el.editor) node = el.editor.childNodes[range.startOffset];
    else if (c.nodeType === Node.TEXT_NODE && isBlank(c.nodeValue.slice(range.startOffset))) node = c.nextSibling;
    while (node && node.nodeType === Node.TEXT_NODE && isBlank(node.nodeValue)) node = node.nextSibling;
    return node && node.nodeType === Node.ELEMENT_NODE && node.classList.contains("dt-chip") ? node : null;
  };

  /** チップを消してカーソルをその位置に置く。 */
  const removeChip = function (chip) {
    const r = document.createRange();
    r.setStartBefore(chip);
    r.collapse(true);
    chip.remove();
    placeCaret(r);
    changed();
  };

  /** 部品 g を入れる。直前が同じ部品のチップなら種類を次へ切り替える。 */
  const insertPart = function (g) {
    const range = caretRange();
    const prev = chipBeforeCaret(range);
    if (prev && prev.dataset.group === g.id && g.kinds.length > 1) {
      setChipKind(prev, D.nextVariant(g.kinds, prev.dataset.kind));
      placeCaret(range);
      changed();
      return;
    }
    if (D.countTokens(readEditor()) + 1 > MAX) return;
    range.deleteContents();
    const chip = makeChip(g.kinds[0]);
    range.insertNode(chip);
    const after = document.createRange();
    after.setStartAfter(chip);
    after.collapse(true);
    placeCaret(after);
    changed();
  };

  el.parts.addEventListener("mousedown", function (e) {
    /* 押した瞬間に入力欄のカーソルが消えないようにする。 */
    if (e.target.closest(".dt-part")) e.preventDefault();
  });
  el.parts.addEventListener("click", function (e) {
    const b = e.target.closest(".dt-part");
    if (b) insertPart(groups.get(b.dataset.group));
  });

  el.editor.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && !e.isComposing) {
      const sel = getSelection();
      if (sel.rangeCount) {
        const r = sel.getRangeAt(0);
        const chip = e.key === "Backspace" ? chipBeforeCaret(r) : chipAfterCaret(r);
        if (chip) {
          e.preventDefault();
          removeChip(chip);
          return;
        }
      }
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
      const g = groupByKey.get(e.code);
      if (g) {
        e.preventDefault();
        insertPart(g);
      }
    }
  });

  el.editor.addEventListener("beforeinput", function (e) {
    if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
      e.preventDefault();
      return;
    }
    if (e.inputType.startsWith("insert") && typeof e.data === "string" && e.inputType !== "insertCompositionText") {
      const sel = getSelection();
      const selected = sel.rangeCount ? Array.from(sel.toString()).length : 0;
      if (D.countTokens(readEditor()) - selected + Array.from(e.data).length > MAX) e.preventDefault();
    }
  });

  el.editor.addEventListener("paste", function (e) {
    e.preventDefault();
    let text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
    text = text.replace(/\r\n|\r|\n/g, " ");
    const room = MAX - D.countTokens(readEditor()) + Array.from(getSelection().toString()).length;
    text = Array.from(text).slice(0, Math.max(0, room)).join("");
    if (text) document.execCommand("insertText", false, text);
  });
  el.editor.addEventListener("drop", (e) => e.preventDefault());

  el.editor.addEventListener("input", function () {
    /* 空になったらブラウザが残す <br> を消す（プレースホルダを出すため）。 */
    if (readEditor().length === 0 && el.editor.childNodes.length) el.editor.replaceChildren();
    changed();
  });

  el.clear.addEventListener("click", function () {
    el.editor.replaceChildren();
    lastRange = null;
    changed();
    el.editor.focus();
  });

  /* ---- チップの種類の候補 ---- */

  let openChip = null;

  const closeChipPop = function (focus) {
    if (!openChip) return;
    const chip = openChip;
    openChip = null;
    chip.classList.remove("is-open");
    el.chip_pop.hidden = true;
    if (focus) {
      const r = document.createRange();
      r.setStartAfter(chip);
      r.collapse(true);
      placeCaret(r);
    }
  };

  const openChipPop = function (chip) {
    closeChipPop(false);
    openChip = chip;
    chip.classList.add("is-open");
    for (const g of groups.values()) g.box.hidden = g.id !== chip.dataset.group;
    markChoice(groups.get(chip.dataset.group).box, chip.dataset.kind);
    el.chip_pop.hidden = false;
    /* チップの真下に置く（カードの右端からはみ出さないように寄せる）。 */
    const card = el.chip_pop.offsetParent;
    const cr = card.getBoundingClientRect();
    const r = chip.getBoundingClientRect();
    const width = el.chip_pop.offsetWidth;
    el.chip_pop.style.top = r.bottom - cr.top + 4 + "px";
    el.chip_pop.style.left = Math.max(8, Math.min(r.left - cr.left, cr.width - width - 8)) + "px";
  };

  el.editor.addEventListener("click", function (e) {
    const chip = e.target.closest(".dt-chip");
    if (chip && el.editor.contains(chip)) openChipPop(chip);
  });

  for (const g of groups.values()) {
    g.box.addEventListener("click", function (e) {
      const b = e.target.closest(".yt-tr__choice");
      if (!b || !openChip) return;
      setChipKind(openChip, b.dataset.value);
      markChoice(g.box, b.dataset.value);
      changed();
      closeChipPop(true);
    });
  }

  el.chip_delete.addEventListener("click", function () {
    if (!openChip) return;
    const chip = openChip;
    closeChipPop(false);
    removeChip(chip);
  });

  document.addEventListener("click", function (e) {
    if (!openChip) return;
    if (el.chip_pop.contains(e.target) || openChip.contains(e.target)) return;
    closeChipPop(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openChip) closeChipPop(true);
  });

  /* ---- 結果（言語ごとの書式の表） ---- */

  const renderRows = function (rows) {
    const trs = rows.map(function (row) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = row.name;
      const td = document.createElement("td");
      td.className = "dt-pattern";
      const code = document.createElement("code");
      code.textContent = row.pattern;
      td.append(code);
      const act = document.createElement("td");
      act.className = "dt-act";
      /* 完全には表せないとき：書式を注意色にし、注意文は (!) のツールチップに入れる。
         (!) はコピーの左に置き、ツールチップは左へ開く（右端で切れないように）。 */
      if (row.warnings.length) {
        td.classList.add("is-warn");
        const tipId = "tip_warn_" + row.id;
        const tip = document.createElement("span");
        tip.className = "yt-tip yt-tip--left dt-warntip";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "yt-iconbtn yt-iconbtn--sm";
        btn.setAttribute("aria-label", row.name + " の注意");
        btn.setAttribute("aria-describedby", tipId);
        btn.innerHTML = icon("warning", 16);
        const body = document.createElement("span");
        body.className = "yt-tip__body";
        body.id = tipId;
        body.setAttribute("role", "tooltip");
        body.textContent = row.warnings.join("\n");
        tip.append(btn, body);
        act.append(tip);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "yt-iconbtn";
      btn.setAttribute("aria-label", row.name + " の書式をコピー");
      btn.title = "コピー";
      btn.innerHTML = icon("copy", 18);
      btn.disabled = row.pattern === "";
      btn.addEventListener("click", () => copyText(row.pattern, btn));
      act.append(btn);
      tr.append(th, td, act);
      return tr;
    });
    el.rows.replaceChildren(...trs);
  };

  const changed = function () {
    const tokens = readEditor();
    el.count.textContent = D.countTokens(tokens) + " / " + MAX;
    const res = D.compose(tokens);
    el.error.textContent = res.error;
    if (!res.error) renderRows(res.rows);
  };

  /* ---- 共有 URL ---- */
  /* c 組み立ての並び（encodeTokens） */
  el.share.addEventListener("click", function () {
    const url = location.origin + location.pathname + "?i=" + encodeShare({ c: D.encodeTokens(readEditor()) });
    copyText(url, el.share);
  });

  /* ---- 初期状態 ---- */

  let tokens = [
    { kind: "year4" }, { kind: LIT, text: "-" }, { kind: "month2" }, { kind: LIT, text: "-" }, { kind: "day2" },
    { kind: LIT, text: " " }, { kind: "hour2" }, { kind: LIT, text: ":" }, { kind: "minute2" }, { kind: LIT, text: ":" }, { kind: "second2" },
  ];
  const shared = decodeShare();
  if (shared) tokens = D.decodeTokens(shared.c) ?? tokens;

  renderEditor(tokens);
  changed();
})();
