// 説明のページの傍注: 参照（a.ref。式・仮定・定義・小節）にマウスを重ねると、参照の先を右の余白に出す。
// 余白が狭いときは画面の下に出す。押せばふつうの道として先へ移る
(function () {
  "use strict";
  var MIN_W = 220, MAX_W = 320, GAP = 40;
  var note = document.createElement("aside");
  note.className = "sidenote";
  note.setAttribute("aria-hidden", "true");
  document.body.appendChild(note);
  var article = document.querySelector("article");
  var current = null, showTimer = 0, hideTimer = 0;

  // 参照の先の中身: 式はその式、仮定・定義は段落と続く式、小節は見出しと最初の段落
  function content(id) {
    var t = document.getElementById(id);
    if (!t) return null;
    var parts = [t];
    if (t.tagName === "P") {
      for (var s = t.nextElementSibling; s && s.classList.contains("eq"); s = s.nextElementSibling) parts.push(s);
    } else if (t.tagName === "H3") {
      var p = t.nextElementSibling;
      while (p && p.tagName !== "P" && p.tagName !== "H3") p = p.nextElementSibling;
      if (p && p.tagName === "P") parts.push(p);
    }
    var frag = document.createDocumentFragment();
    parts.forEach(function (el) {
      var c = el.cloneNode(true);
      c.removeAttribute("id");
      c.querySelectorAll("[id]").forEach(function (x) { x.removeAttribute("id"); });
      frag.appendChild(c);
    });
    return frag;
  }

  // 傍注の幅に収まらない式は縮める（KaTeX は横に長い式を折り返さない）
  function fit() {
    note.querySelectorAll(".katex-display").forEach(function (d) {
      d.style.zoom = "";
      var k = d.querySelector(".katex");
      var w = note.clientWidth - parseFloat(getComputedStyle(note).paddingLeft) - parseFloat(getComputedStyle(note).paddingRight);
      if (k && k.scrollWidth > w) d.style.zoom = (w / k.scrollWidth).toFixed(3);
    });
  }

  function place(a) {
    var r = a.getBoundingClientRect(), ar = article.getBoundingClientRect();
    var room = window.innerWidth - ar.right - GAP - 24;
    if (room >= MIN_W) {
      note.classList.remove("bottom");
      note.style.width = Math.min(MAX_W, room) + "px";
      note.style.left = (ar.right + GAP + window.scrollX) + "px";
      fit();
      var h = note.offsetHeight;
      var top = Math.min(r.top - 4, window.innerHeight - 16 - h);
      note.style.top = (Math.max(top, 84) + window.scrollY) + "px";
    } else {
      note.classList.add("bottom");
      note.style.width = note.style.left = note.style.top = "";
      fit();
    }
  }

  function show(a) {
    clearTimeout(hideTimer);
    if (current === a) return;
    var frag = content(decodeURIComponent(a.hash.slice(1)));
    if (!frag) return;
    if (current) current.classList.remove("on");
    current = a;
    a.classList.add("on");
    note.textContent = "";
    note.appendChild(frag);
    place(a);
    note.classList.add("show");
  }

  function hide() {
    clearTimeout(showTimer);
    hideTimer = setTimeout(function () {
      note.classList.remove("show");
      if (current) current.classList.remove("on");
      current = null;
    }, 160);
  }

  document.querySelectorAll("a.ref").forEach(function (a) {
    a.addEventListener("mouseenter", function () { clearTimeout(showTimer); showTimer = setTimeout(function () { show(a); }, 90); });
    a.addEventListener("mouseleave", hide);
    a.addEventListener("focus", function () { show(a); });
    a.addEventListener("blur", hide);
    a.addEventListener("click", function () { hide(); });
  });
  window.addEventListener("resize", function () { if (current) place(current); });
})();
