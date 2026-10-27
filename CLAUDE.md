# CLAUDE.md

<https://sandbox.yoshina.moe/> で公開するデザイン試作サイト。
静的 HTML を nginx がそのまま配信する（アプリのプロセスは無い）。
yoshina.moe 系のサイト（`KashiroHeart/yoshinamoego`）と同じサーバーで動くが、別サイトとして独立している。

## 絶対に崩さないこと

- ビルドステップを作らない（バンドラもトランスパイラもパッケージマネージャも入れない）
- URL は拡張子なし。`/examples/1` → `examples/1.html`（nginx の `try_files $uri $uri.html`）
- 内部リンクも拡張子なし・ルート相対で書く（`/about`、`/examples/1`）
- **example 同士で CSS / JS を共有しない。** 各 example は 1 枚の HTML で完結させる。
  共有してよいのは `assets/examples-header.*`（共通ヘッダー）だけ
- `assets/site.css` はトップと about 専用。example からは読み込まない

## 構成

| パス | URL | 内容 |
| --- | --- | --- |
| `index.html` | `/` | トップページ（examples の一覧） |
| `about.html` | `/about` | このサイトについて |
| `examples/<N>.html` | `/examples/<N>` | 試作ページ。番号は 1 から欠番なしで増やす |
| `assets/site.css` | `/assets/site.css` | トップと about のスタイル |
| `assets/examples-header.{css,js}` | `/assets/…` | examples 共通ヘッダー（上端にカーソルを寄せると出る） |
| `deploy/nginx.conf.example` | — | nginx の設定例と配置手順。公開しない |

## example を足す

1. `examples/<N>.html` を作る。`<head>` に次の 2 行を入れる（これで共通ヘッダーが付く）

   ```html
   <link rel="stylesheet" href="/assets/examples-header.css">
   <script src="/assets/examples-header.js" defer></script>
   ```

   `<title>` は `#<N> <タイトル> | sandbox` に揃える。
2. `index.html` の `<ul class="examples">` の末尾に 1 行足す

   ```html
   <li><a href="/examples/<N>"><span class="num">#<N></span><タイトル><span class="arrow" aria-hidden="true">→</span></a></li>
   ```

共通ヘッダーは固定配置で重ねるだけで、ページのレイアウトには触らない。
クラス名・CSS 変数は `xh-` 接頭辞なので、example 側では `xh-` を使わない。
ページのテーマ切り替えが `<html data-theme="light|dark">` に従っていれば、ヘッダーの配色も追従する。

## 確認

`python3 -m http.server` は拡張子なし URL を解決しないので、
`deploy/nginx.conf.example` の 443 側 server ブロックから `listen`・`ssl_*` を外し、
`root` をこのディレクトリにして nginx をローカル起動して確かめる。
