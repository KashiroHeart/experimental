// examples 共通ヘッダー。
// カーソルがページ上端に触れたら出し、ヘッダーから離れたら少し待って隠す。
// hover できない端末では上端の取っ手をタップして開閉する。
(() => {
  const EDGE = 8;         // 上端から何 px 以内で出すか
  const MARGIN = 4;       // ヘッダーの下に設ける遊び
  const HIDE_DELAY = 150; // 離れてから隠すまで（ms）

  const m = location.pathname.match(/\/examples\/(\d+)/);

  const bar = document.createElement('header');
  bar.className = 'xh-bar';
  bar.innerHTML =
    '<nav class="xh-nav" aria-label="サイト">' +
    '<a href="/">トップページ</a>' +
    '<a href="/about">このサイトについて</a>' +
    '</nav>' +
    '<span class="xh-num"></span>';
  bar.querySelector('.xh-num').textContent = m ? '#' + m[1] : '';

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'xh-handle';
  handle.setAttribute('aria-label', 'ナビゲーションを開く');

  document.body.prepend(bar, handle);

  let timer = 0;
  const cancel = () => { clearTimeout(timer); timer = 0; };
  const show = () => { cancel(); bar.classList.add('xh-show'); };
  // 予約済みなら張り直さない（mousemove のたびに延長されると、動かし続ける限り消えない）
  const hide = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; bar.classList.remove('xh-show'); }, HIDE_DELAY);
  };

  document.addEventListener('mousemove', e => {
    const open = bar.classList.contains('xh-show');
    if (e.clientY <= EDGE) show();
    else if (open && e.clientY > bar.offsetHeight + MARGIN) hide();
    else if (open) cancel();
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
