// トップページと「このサイトについて」の画面制御。examples からは読み込まない。
//
// 2 ページは同じ .stage の上の「ビュー」として扱う。
//   .stage[data-view] = title（タイトル）| nav（円盤ナビ）| about（このサイトについて）
//   .stage[data-prev] = 直前のビュー（CSS が遷移アニメーションを出し分けるのに使う）
// / と /about の行き来は pjax: 相手のページを fetch して data-part の要素だけ差し込み、
// history.pushState で URL を変える。見た目の切り替えは site.css が data-view で行う。
(() => {
  'use strict';

  const stage = document.querySelector('.stage');
  if (!stage) return;

  const PART_URL = { top: '/', about: '/about' };
  const DIM = 0.28; // 真横以外の項目名の不透明度
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const partOf = (view) => (view === 'about' ? 'about' : 'top');
  const view = () => stage.dataset.view;

  const titles = { [partOf(view())]: document.title };
  const cache = {};
  let disc = null;
  let lockUntil = 0; // 遷移アニメーション中は入力を受け付けない
  const locked = () => performance.now() < lockUntil;

  function setView(next) {
    const cur = view();
    if (cur === next) return;
    stage.dataset.prev = cur;
    stage.dataset.view = next;
    lockUntil = performance.now() + (reduceMotion.matches ? 150 : 1100);
    if (disc) disc.onView(next);
  }

  // ---------- 円盤 ----------
  function createDisc() {
    const rot = stage.querySelector('.disc-rot');
    const nav = stage.querySelector('.disc-nav');
    const face = stage.querySelector('.disc-face');
    const counter = stage.querySelector('.disc-counter');
    const lis = Array.from(stage.querySelectorAll('.examples li'));
    const links = lis.map((li) => li.querySelector('a'));
    const n = lis.length;
    if (!rot || !nav || !n) return null;
    const max = n - 1;
    const clamp = (v) => Math.max(0, Math.min(max, v));

    lis.forEach((li, i) => {
      const num = li.querySelector('.num');
      if (num) num.textContent = '#' + String(i + 1).padStart(2, '0');
    });
    const ticks = lis.map(() => {
      const t = document.createElement('div');
      t.className = 'disc-tick';
      rot.appendChild(t);
      return t;
    });

    // p は連続値の位置（0 = #01）。mode: idle | free（慣性）| spring（定位置へ吸着）| drag
    let p = 0, vel = 0, target = 0, mode = 'idle', raf = 0;
    let lastInput = 0, settledAt = 0, active = -1;
    let R = 0, gap = 0, step = 0;

    function layout() {
      const w = window.innerWidth, h = window.innerHeight;
      const phone = w < 640, m = Math.min(w, h);
      R = phone ? w * 0.7 : m * 0.62;
      gap = phone ? 28 : 64;
      step = ((phone ? 70 : 104) / R) * 180 / Math.PI; // 項目どうしの角度（弧長が一定になるように）
      const cap = R * (phone ? 0.42 : 0.38); // タイトル画面で見せる円盤の高さ
      const navCx = phone ? -w * 0.38 : m * 0.14;
      const vars = {
        '--R': R + 'px',
        '--gap': gap + 'px',
        '--tx': w / 2 + 'px', '--ty': h - cap + R + 'px', // タイトル: 下中央
        '--nx': navCx + 'px', '--ny': h / 2 + 'px',        // ナビ: 左
        '--ay': h + R + 40 + 'px',                         // about: 画面外の下
        '--cap-y': -R + cap * 0.55 + 'px',
        '--title-h': h - cap + 'px',
        '--title-size': (phone ? 64 : 120) + 'px',
        '--label-size': (phone ? 20 : 34) + 'px',
        '--num-size': (phone ? 12 : 14) + 'px',
        '--label-max': Math.max(160, w - (navCx + R + gap) - (phone ? 16 : 48)) + 'px',
        '--counter-x': (phone ? R * 0.74 : R * 0.42) + 'px',
        '--counter-size': (phone ? 56 : 128) + 'px'
      };
      for (const k in vars) stage.style.setProperty(k, vars[k]);
      ticks.forEach((t, i) => {
        t.style.transform = `rotate(${i * step}deg) translateX(${R - 44}px) translateY(-50%)`;
      });
      render();
    }

    function render() {
      rot.style.transform = nav.style.transform = `rotate(${-p * step}deg)`;
      lis.forEach((li, i) => {
        const d = Math.min(1, Math.abs(i - p));
        li.style.transform = `rotate(${i * step}deg) translateX(${R + gap}px) scale(${(1 - d * 0.18).toFixed(3)}) translateY(-50%)`;
        li.style.opacity = (1 - d * (1 - DIM)).toFixed(3);
      });
      const act = Math.round(clamp(p));
      if (act === active) return;
      active = act;
      lis.forEach((li, i) => {
        const on = i === act;
        li.classList.toggle('is-active', on);
        ticks[i].classList.toggle('is-active', on);
        if (on) links[i].setAttribute('aria-current', 'true');
        else links[i].removeAttribute('aria-current');
      });
      if (counter) counter.textContent = String(act + 1).padStart(2, '0');
    }

    function start() {
      if (!raf) raf = requestAnimationFrame(tick);
    }
    function tick() {
      raf = 0;
      const now = performance.now();
      const out = p < 0 || p > max;
      if (mode === 'free') {
        p += vel;
        vel *= out ? 0.6 : 0.9;
        if (view() === 'nav' && p < -0.3) {
          goTitle();
        } else if (now - lastInput > 90 && Math.abs(vel) < 0.035) {
          mode = 'spring';
          target = clamp(Math.round(p + vel * 3));
        }
      } else if (mode === 'spring') {
        vel = (vel + (target - p) * 0.085) * 0.8;
        p += vel;
        if (Math.abs(target - p) < 0.0008 && Math.abs(vel) < 0.0008) {
          p = target; vel = 0; mode = 'idle'; settledAt = now;
        }
      }
      render();
      if (mode === 'free' || mode === 'spring') start();
    }
    function goTo(i) {
      target = clamp(i);
      mode = 'spring';
      start();
    }
    function goTitle() {
      goTo(Math.round(clamp(p)));
      setView('title');
    }

    function wheel(dy) {
      const now = performance.now();
      // #01 に止まっている状態から上へスクロール → タイトルへ
      if (dy < 0 && mode === 'idle' && p <= 0.001 && now - settledAt > 250) {
        goTitle();
        return;
      }
      vel = Math.max(-0.45, Math.min(0.45, vel + dy * 0.0009));
      mode = 'free';
      lastInput = now;
      start();
    }
    function dragStart() {
      mode = 'drag';
      vel = 0;
    }
    function dragBy(dy) {
      const d = dy / 90;
      p += (p < 0 || p > max) ? d * 0.35 : d;
      vel = d;
      lastInput = performance.now();
      if (p < -0.3) { goTitle(); return false; }
      render();
      return true;
    }
    function dragEnd() {
      mode = 'free';
      lastInput = 0;
      start();
    }
    function key(e) {
      const a = mode === 'spring' ? target : Math.round(clamp(p));
      const up = e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp';
      if (up && a === 0) { e.preventDefault(); goTitle(); return; }
      const map = {
        ArrowDown: a + 1, ArrowRight: a + 1, PageDown: a + 1,
        ArrowUp: a - 1, ArrowLeft: a - 1, PageUp: a - 1,
        Home: 0, End: max
      };
      if (e.key in map) { e.preventDefault(); goTo(map[e.key]); }
    }
    // フォーカス中でない項目のクリックはリンクを開かず、その項目まで回す
    function click(li, e) {
      const i = lis.indexOf(li);
      if (i >= 0 && i !== Math.round(clamp(p))) { e.preventDefault(); goTo(i); }
    }
    function focusItem(li) {
      const i = lis.indexOf(li);
      if (i >= 0 && view() === 'nav') goTo(i);
    }
    function onView(next) {
      if (face) face.tabIndex = next === 'title' ? 0 : -1;
    }

    onView(view());
    layout();
    return { layout, wheel, dragStart, dragBy, dragEnd, key, click, focusItem, goTitle, onView };
  }

  // ---------- pjax ----------
  function fetchPart(part) {
    if (!cache[part]) {
      cache[part] = fetch(PART_URL[part], { headers: { Accept: 'text/html' } })
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then((html) => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const nodes = Array.from(doc.querySelectorAll(`.stage > [data-part="${part}"]`));
          if (!nodes.length) throw new Error('part not found: ' + part);
          return { title: doc.title, nodes };
        });
      cache[part].catch(() => { delete cache[part]; });
    }
    return cache[part];
  }
  const hasPart = (part) => !!stage.querySelector(`:scope > [data-part="${part}"]`);

  async function ensurePart(part) {
    if (hasPart(part)) return;
    const { title, nodes } = await fetchPart(part);
    if (hasPart(part)) return;
    titles[part] = title;
    // トップの要素は先頭、about は末尾へ（今の見た目は data-view のまま。表示は setView で切り替える）
    const ref = part === 'top' ? stage.firstChild : null;
    nodes.forEach((node) => stage.insertBefore(document.importNode(node, true), ref));
    if (part === 'top') disc = createDisc();
  }

  async function navigate(next, push) {
    const part = partOf(next);
    try {
      await ensurePart(part);
    } catch (err) {
      location.href = PART_URL[part];
      return;
    }
    void stage.offsetWidth; // 差し込んだ要素の初期状態を確定させてから切り替える
    setView(next);
    if (titles[part]) document.title = titles[part];
    if (push) history.pushState({ view: next }, '', PART_URL[part]);
    if (next === 'about') {
      const about = stage.querySelector('.view-about');
      if (about) about.scrollTop = 0;
      const heading = stage.querySelector('.about-main h2');
      if (heading) setTimeout(() => heading.focus({ preventScroll: true }), reduceMotion.matches ? 0 : 800);
    }
  }

  // ---------- 入力 ----------
  stage.addEventListener('click', (e) => {
    const pj = e.target.closest('a[data-pjax]');
    if (pj) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (!locked()) navigate(pj.dataset.pjax, true);
      return;
    }
    if (e.target.closest('.disc-face')) {
      if (!locked() && view() === 'title') setView('nav');
      return;
    }
    if (e.target.closest('.back-title')) {
      if (disc && view() === 'nav') disc.goTitle();
      return;
    }
    const li = e.target.closest('.examples li');
    if (li && disc) disc.click(li, e);
  });

  stage.addEventListener('focusin', (e) => {
    const li = e.target.closest('.examples li');
    if (li && disc) disc.focusItem(li);
  });

  stage.addEventListener('wheel', (e) => {
    if (!disc || locked() || view() === 'about') return;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    if (e.deltaMode === 2) dy *= 800;
    if (view() === 'title') {
      if (dy > 0) setView('nav'); // タイトルで下へスクロール → 円盤ナビ
      return;
    }
    disc.wheel(dy);
  }, { passive: true });

  let touchY = null;
  stage.addEventListener('touchstart', (e) => {
    if (!disc || locked() || view() === 'about') return;
    touchY = e.touches[0].clientY;
    if (view() === 'nav') disc.dragStart();
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (touchY == null) return;
    const y = e.touches[0].clientY;
    if (view() === 'title') {
      if (touchY - y > 40) { touchY = null; setView('nav'); }
      return;
    }
    const dy = touchY - y;
    touchY = y;
    if (!disc.dragBy(dy)) touchY = null;
  }, { passive: true });
  const touchEnd = () => {
    if (touchY == null) return;
    touchY = null;
    if (view() === 'nav') disc.dragEnd();
  };
  stage.addEventListener('touchend', touchEnd);
  stage.addEventListener('touchcancel', touchEnd);

  document.addEventListener('keydown', (e) => {
    if (disc && view() === 'nav' && !locked() && !e.altKey && !e.ctrlKey && !e.metaKey) disc.key(e);
  });

  window.addEventListener('resize', () => { if (disc) disc.layout(); });

  window.addEventListener('popstate', () => {
    const next = location.pathname.replace(/\/+$/, '') === PART_URL.about ? 'about' : 'title';
    if (next !== view()) navigate(next, false);
  });

  // ---------- 起動 ----------
  if (hasPart('top')) disc = createDisc();
  history.replaceState({ view: view() }, '');
  // もう片方のページを先に読んでおく（遷移の待ち時間をなくす）
  const other = partOf(view()) === 'top' ? 'about' : 'top';
  setTimeout(() => { fetchPart(other).catch(() => {}); }, 1200);
})();
