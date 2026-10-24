// ページの移り変わり（映像・理論のページで共通）: 開くと css の page-in で浮かび、ほかのページへの道を押すと暗くしてから移る。
// 暗くし始めに "smf-leave" を送る（映像のページの BGM はこれで小さくする）。外のサイトはそのまま。
// 同じページの中の道（#…、理論のページの目次・参照）は、なめらかにそこまで送る（css の scroll-behavior はブラウザ・OS の設定で切られることがあるので自分で動かす）
"use strict";
(function () {
  const MS = 800;                   // css の body.leaving の transition と同じ
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
    const url = new URL(a.href, location.href);
    if (url.protocol !== location.protocol || url.host !== location.host || !/\.html$/.test(url.pathname)) return;
    if (url.pathname === location.pathname) {
      if (url.hash) glide(e, url.hash);
      return;
    }
    e.preventDefault();
    if (document.body.classList.contains("leaving")) return;
    document.body.classList.add("leaving");
    window.dispatchEvent(new CustomEvent("smf-leave", { detail: { sec: MS / 1000 } }));
    setTimeout(() => (location.href = url.href), MS);
  });
  // 先の要素の scroll-margin-top を引いた所まで、距離に応じた時間（0.45–1.1 秒）で、ゆっくり始めてゆっくり止まる
  function glide(e, hash) {
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault();
    const y0 = window.scrollY, max = document.documentElement.scrollHeight - innerHeight;
    const y1 = Math.max(0, Math.min(max, el.getBoundingClientRect().top + y0 - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0)));
    const ms = Math.min(1100, 450 + Math.abs(y1 - y0) * 0.12), t0 = performance.now();
    history.pushState(null, "", hash);
    const step = (now) => {
      const u = Math.min(1, (now - t0) / ms), w = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      window.scrollTo(0, y0 + (y1 - y0) * w);
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // 戻る・進むで保存されたページに戻ったとき（bfcache）は暗いままなので戻す
  window.addEventListener("pageshow", (e) => { if (e.persisted) document.body.classList.remove("leaving"); });
})();
