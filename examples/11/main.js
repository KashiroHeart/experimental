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

/* ============ 画面（翻訳） ============
   - 設定帯の名前（#from_name / #to_name）で折り畳み（#pop_from / #pop_to）を開き、言語を選ぶ。
     同時に開くのは 1 つだけ。領域外のクリック・Esc・同じボタンの再押下で閉じる。
   - 入れ替えは言語を入れ替え、出力を入力へ移す。
   - 入力が変わるたびに翻訳し直す。注意は出力の下に、読むとき → 書くときの順で並べる。 */
(() => {
  const MAX = D.MAX_INPUT;

  const $ = (id) => document.getElementById(id);
  const el = {};
  for (const id of ["from_label", "to_label", "choices_from", "choices_to", "swap", "input", "output", "clear", "count", "warns", "error", "share", "copy"]) el[id] = $(id);

  /* ---- アイコン・コピー ---- */

  const CHECK = '<svg class="yt-icon" width="SIZE" height="SIZE" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  /** コピーの完了表示。1.6 秒だけアイコンを check・文字色を teal-ink にする。 */
  const flashDone = function (btn) {
    const svg = btn.querySelector("svg.yt-icon");
    if (!btn._prev) btn._prev = svg ? svg.outerHTML : null;
    btn.classList.add("is-done");
    if (svg) svg.outerHTML = CHECK.replaceAll("SIZE", svg.getAttribute("width") || "18");
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

  /* ---- 折り畳み ---- */

  const pops = (() => {
    let current = null; // { btn, pop }

    const close = function (focus) {
      if (!current) return;
      const { btn, pop } = current;
      current = null;
      pop.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (focus) btn.focus();
    };

    /* 設定帯の高さは折り返しで変わるので、開くたびに測って真下に置く。 */
    const place = function (pop) {
      const bar = pop.parentElement.querySelector(".yt-tr__bar");
      const top = bar.offsetTop + bar.offsetHeight;
      pop.style.top = top + "px";
      pop.style.maxHeight = "calc(100% - " + top + "px)";
    };

    const open = function (btn, pop) {
      close(false);
      pop.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      place(pop);
      current = { btn, pop };
    };

    for (const btn of document.querySelectorAll("[data-pop]")) {
      const pop = document.getElementById(btn.dataset.pop);
      btn.setAttribute("aria-controls", pop.id);
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", function () {
        if (current && current.pop === pop) close(false);
        else open(btn, pop);
      });
    }
    for (const b of document.querySelectorAll("[data-pop-close]")) b.addEventListener("click", () => close(true));

    document.addEventListener("click", function (e) {
      if (!current) return;
      if (current.pop.contains(e.target) || current.btn.contains(e.target)) return;
      close(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && current) close(true);
    });
    window.addEventListener("resize", () => { if (current) place(current.pop); });

    return { close };
  })();

  /* ---- 言語の候補 ---- */

  for (const box of [el.choices_from, el.choices_to]) {
    for (const lang of D.LANGUAGES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "yt-tr__choice";
      b.dataset.value = lang.id;
      b.setAttribute("aria-pressed", "false");
      b.textContent = lang.name;
      box.append(b);
    }
  }

  const markChoice = function (box, value) {
    for (const b of box.querySelectorAll(".yt-tr__choice")) b.setAttribute("aria-pressed", String(b.dataset.value === value));
  };
  const onChoice = function (box, fn) {
    box.addEventListener("click", function (e) {
      const b = e.target.closest(".yt-tr__choice");
      if (b && box.contains(b)) fn(b.dataset.value);
    });
  };

  const langName = (id) => D.LANGUAGES.find((l) => l.id === id).name;
  const knownLang = (id) => typeof id === "string" && D.LANGUAGES.some((l) => l.id === id);

  /* ---- 翻訳 ---- */

  const state = { from: "java", to: "go" };

  const setWarnings = function (list) {
    for (const p of el.warns.querySelectorAll(".dt-warn")) p.remove();
    for (const w of list) {
      const p = document.createElement("p");
      p.className = "yt-msg yt-msg--warn dt-warn";
      p.setAttribute("data-icon-warn", "");
      p.textContent = w;
      el.warns.append(p);
    }
  };

  const updateLangs = function () {
    el.from_label.textContent = langName(state.from);
    el.to_label.textContent = langName(state.to);
    markChoice(el.choices_from, state.from);
    markChoice(el.choices_to, state.to);
  };

  const translate = function () {
    el.count.textContent = Array.from(el.input.value).length + " / " + MAX;
    const res = D.translate(state.from, state.to, el.input.value);
    el.error.textContent = res.error;
    if (res.error) {
      el.output.value = "ERR";
      setWarnings([]);
      return;
    }
    el.output.value = res.output;
    setWarnings(res.warnings);
  };

  el.input.addEventListener("input", translate);
  onChoice(el.choices_from, function (id) {
    state.from = id;
    updateLangs();
    pops.close(true);
    translate();
  });
  onChoice(el.choices_to, function (id) {
    state.to = id;
    updateLangs();
    pops.close(true);
    translate();
  });
  el.swap.addEventListener("click", function () {
    [state.from, state.to] = [state.to, state.from];
    if (!el.error.textContent) el.input.value = el.output.value;
    updateLangs();
    translate();
  });
  el.clear.addEventListener("click", function () {
    el.input.value = "";
    translate();
    el.input.focus();
  });
  el.copy.addEventListener("click", function () {
    if (!el.error.textContent && el.output.value) copyText(el.output.value, el.copy);
  });

  /* ---- 共有 URL ---- */
  /* f・t 言語 / i 入力 */
  el.share.addEventListener("click", function () {
    const url = location.origin + location.pathname + "?i=" + encodeShare({ f: state.from, t: state.to, i: el.input.value });
    copyText(url, el.share);
  });

  /* ---- 初期状態 ---- */

  el.input.value = "yyyy-MM-dd HH:mm:ss";
  const shared = decodeShare();
  if (shared) {
    if (knownLang(shared.f)) state.from = shared.f;
    if (knownLang(shared.t)) state.to = shared.t;
    if (typeof shared.i === "string") el.input.value = shared.i;
  }

  updateLangs();
  translate();
})();
