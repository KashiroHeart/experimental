// examples 共通ヘッダー。
// カーソルがページ上端に触れたら出し、ヘッダーから離れたら少し待って隠す。
// hover できない端末では上端の取っ手をタップして開閉する。
(() => {
  const EDGE = 8;         // 上端から何 px 以内で出すか
  const MARGIN = 24;      // ヘッダーの下に設ける遊び
  const HIDE_DELAY = 300; // 離れてから隠すまで（ms）

  const m = location.pathname.match(/\/examples\/(\d+)/);

  const bar = document.createElement('header');
  bar.className = 'xh-bar';
  bar.innerHTML =
    '<span class="xh-num"></span>' +
    '<nav class="xh-nav" aria-label="サイト">' +
    '<a href="/">トップページ</a>' +
    '<a href="/about">このサイトについて</a>' +
    '</nav>';
  bar.querySelector('.xh-num').textContent = m ? '#' + m[1] : '';

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'xh-handle';
  handle.setAttribute('aria-label', 'ナビゲーションを開く');

  document.body.prepend(bar, handle);

  let timer = 0;
  const show = () => { clearTimeout(timer); bar.classList.add('xh-show'); };
  const hide = () => { clearTimeout(timer); timer = setTimeout(() => bar.classList.remove('xh-show'), HIDE_DELAY); };

  document.addEventListener('mousemove', e => {
    const open = bar.classList.contains('xh-show');
    if (e.clientY <= EDGE) show();
    else if (open && e.clientY > bar.offsetHeight + MARGIN) hide();
    else if (open) clearTimeout(timer);
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', e => {
    if (e.clientY > EDGE) hide();
  });

  handle.addEventListener('click', () => {
    if (bar.classList.contains('xh-show')) hide(); else show();
  });
  document.addEventListener('touchstart', e => {
    if (!bar.contains(e.target) && e.target !== handle) hide();
  }, { passive: true });
})();
