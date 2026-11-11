# CLAUDE.md

<https://sandbox.yoshina.moe/> で公開するデザイン試作サイト。
静的 HTML を nginx がそのまま配信する（アプリのプロセスは無い）。
yoshina.moe 系のサイト（`KashiroHeart/yoshinamoego`）と同じサーバーで動くが、別サイトとして独立している。

## 絶対に崩さないこと

- ビルドステップを作らない（バンドラもトランスパイラもパッケージマネージャも入れない）
- URL は拡張子なし。`/about` → `about.html`（nginx の `try_files $uri $uri.html`）
- example は `examples/<N>/` に置き、`/no.<N>` で見せる（nginx で付け替える。`/examples/…` は `/no.…` へ 301）
  - `/no.1` → `examples/1/index.html`、`/no.1/main.js` → `examples/1/main.js`、`/no.1/foo` → `examples/1/foo.html`
- 内部リンクも拡張子なし・ルート相対で書く（`/about`、`/no.1`、`/no.1/foo`）。
  `/no.1` は末尾スラッシュなしなので、相対パス（`main.css`）は `/main.css` に解決されてしまう。必ず `/no.1/main.css` と書く
- **example 同士で CSS / JS を共有しない。** 各 example は自分のディレクトリの中で完結させる。
  共有してよいのは `assets/examples-header.*`（共通ヘッダー）だけ
- `assets/site.css` / `assets/site.js` はトップと about 専用。example からは読み込まない

## 構成

| パス | URL | 内容 |
| --- | --- | --- |
| `index.html` | `/` | トップページ（タイトル画面と円盤ナビ = examples の一覧） |
| `about.html` | `/about` | このサイトについて |
| `examples/<N>/index.html` | `/no.<N>` | 試作ページ。番号は 1 から欠番なしで増やす |
| `examples/<N>/main.{css,js}` | `/no.<N>/main.{css,js}` | その試作ページのスタイルとスクリプト |
| `examples/<N>/<name>.html` など | `/no.<N>/<name>` | 複数ページの試作なら、2 枚目以降やその他のファイルもこのディレクトリに置く |
| `assets/site.css` | `/assets/site.css` | トップと about のスタイル |
| `assets/site.js` | `/assets/site.js` | トップと about の画面制御（円盤ナビ・ビュー切り替え・pjax） |
| `assets/examples-header.{css,js}` | `/assets/…` | examples 共通ヘッダー（上端にカーソルを寄せると出る） |
| `deploy/nginx.conf.example` | — | nginx の設定例と配置手順。公開しない |

## example を足す

1. `examples/<N>/index.html` を作る。`<head>` に次の 2 行を入れる（これで共通ヘッダーが付く）

   ```html
   <link rel="stylesheet" href="/assets/examples-header.css">
   <script src="/assets/examples-header.js" defer></script>
   ```

   `<title>` は `#<N> <タイトル> | sandbox` に揃える。
   CSS は `examples/<N>/main.css`、JS は `examples/<N>/main.js` に分けて、ルート相対で読み込む
   （HTML に直接書いた方が扱いやすいものは、その限りではない）

   ```html
   <link rel="stylesheet" href="/no.<N>/main.css">
   …
   <script src="/no.<N>/main.js"></script>  <!-- </body> の直前 -->
   ```
2. `index.html` の `<ul class="examples">` の末尾に 1 行足す

   ```html
   <li><a href="/no.<N>" target="_blank"><span class="num">#<N></span><タイトル><span class="arrow" aria-hidden="true">→</span></a></li>
   ```

一覧は円盤ナビとして描かれるが、`site.js` が `<ul class="examples">` の `<li>` を読んで並べるので、
足すのは上の 1 行だけでよい（番号表示の `#01` 形式への整形も `site.js` がする）。

共通ヘッダーは固定配置で重ねるだけで、ページのレイアウトには触らない。
クラス名・CSS 変数は `xh-` 接頭辞なので、example 側では `xh-` を使わない。
ページのテーマ切り替えが `<html data-theme="light|dark">` に従っていれば、ヘッダーの配色も追従する。

## トップと about

- 2 ページは同じ `.stage` の上の「ビュー」として動く。`.stage[data-view]` が `title`（タイトル）/ `nav`（円盤ナビ）/ `about`、
  `[data-prev]` が直前のビュー。見た目とアニメーションは `site.css` が `data-view` / `data-prev` で切り替える
- `/` ⇄ `/about` は pjax。相手のページを fetch し、`.stage` 直下の `data-part="top"` / `data-part="about"` の要素だけを差し込む。
  どちらのページにも `.stage` と `data-part` の構造を崩さずに置くこと
- JS が無いときは `<html class="no-js">` のまま、ふつうの縦並びで表示される

## 確認

`python3 -m http.server` は拡張子なし URL を解決しないので、
`deploy/nginx.conf.example` の 443 側 server ブロックから `listen`・`ssl_*` を外し、
`root` をこのディレクトリにして nginx をローカル起動して確かめる。
