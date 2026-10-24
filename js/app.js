// Standard Model Fields — 描写のページの操作と状態。データは data/<topic>.js が window.SMV.add で登録する（file:// でも動くよう <script> で読む）
// 説明の文は置かない（theory.html）。操作がなければ各トピックを 分散 → 相関 の順に 1 回ずつ再生して次へ進む
"use strict";

// 場の短い名前（データの label は説明の文なので描写のページでは使わない）
const TOPICS = [
  { id: "ee", name: "電子と電子", fields: { n: "電子", exchange: "交換される光子", photon: "クーロン場", tr: "横の光子", rad: "放射" } },
  { id: "compton", name: "コンプトン散乱", fields: { photon: "光子", electron: "電子", photon_sc: "散乱した光子", electron_sc: "反跳した電子" } },
  { id: "beta", name: "ベータ崩壊", fields: { e: "電子", nu: "反ニュートリノ", n: "中性子", p: "陽子", W: "W" } },
  { id: "osc", name: "ニュートリノ振動", fields: { muon: "μ⁺", mu_flavor: "ν<sub>μ</sub>", tau_flavor: "ν<sub>τ</sub>", nu1: "ν₁", nu2: "ν₂" }, off: ["nu1", "nu2"] },
  { id: "confine", name: "色の閉じ込め", fields: { nq: "クォーク", nqb: "反クォーク", color: "色の電場" } },
  { id: "pion", name: "π 中間子の交換", fields: { nA: "陽子", nB: "中性子", neutral: "π⁰", charged: "π±" } },
  { id: "vacpol", name: "真空偏極", fields: { e: "電子", vneg: "真空・負", vpos: "真空・正" } },
];
// 英語・ドイツ語の名前（並びは TOPICS と同じ: トピック、場）
const NAMES = {
  en: {
    ee: ["electron–electron", { n: "electron", exchange: "exchanged photon", photon: "Coulomb field", tr: "transverse photon", rad: "radiation" }],
    compton: ["Compton scattering", { photon: "photon", electron: "electron", photon_sc: "scattered photon", electron_sc: "recoil electron" }],
    beta: ["beta decay", { e: "electron", nu: "antineutrino", n: "neutron", p: "proton", W: "W" }],
    osc: ["neutrino oscillation", {}],
    confine: ["colour confinement", { nq: "quark", nqb: "antiquark", color: "colour field" }],
    pion: ["pion exchange", { nA: "proton", nB: "neutron" }],
    vacpol: ["vacuum polarization", { e: "electron", vneg: "vacuum −", vpos: "vacuum +" }],
  },
  de: {
    ee: ["Elektron–Elektron", { n: "Elektron", exchange: "Austauschphoton", photon: "Coulomb-Feld", tr: "transversales Photon", rad: "Strahlung" }],
    compton: ["Compton-Streuung", { photon: "Photon", electron: "Elektron", photon_sc: "gestreutes Photon", electron_sc: "gestoßenes Elektron" }],
    beta: ["Betazerfall", { e: "Elektron", nu: "Antineutrino", n: "Neutron", p: "Proton", W: "W" }],
    osc: ["Neutrino-Oszillation", {}],
    confine: ["Farbeinschluss", { nq: "Quark", nqb: "Antiquark", color: "Farbfeld" }],
    pion: ["Pionaustausch", { nA: "Proton", nB: "Neutron" }],
    vacpol: ["Vakuumpolarisation", { e: "Elektron", vneg: "Vakuum −", vpos: "Vakuum +" }],
  },
};
// 画面の文字（data-i18n / data-i18n-label の名前）
const UI_TEXT = {
  ja: { sound: "音", guide: "操作", theory: "理論", free: "分散", cond: "相関", time: "時間", reset: "元の視点に戻す",
        assumed: (n) => `${n}の位置（仮定）`, point: "点", noData: (n) => `data/${n}.js を読めません`, noGL: "この環境では WebGL2 が使えません: " },
  en: { sound: "sound", guide: "controls", theory: "theory", free: "variance", cond: "correlation", time: "time", reset: "reset view",
        assumed: (n) => `${n} (assumed position)`, point: "point", noData: (n) => `cannot read data/${n}.js`, noGL: "WebGL2 is not available here: " },
  de: { sound: "Ton", guide: "Bedienung", theory: "Theorie", free: "Varianz", cond: "Korrelation", time: "Zeit", reset: "Startansicht",
        assumed: (n) => `${n} (angenommener Ort)`, point: "Punkt", noData: (n) => `data/${n}.js nicht lesbar`, noGL: "WebGL2 ist hier nicht verfügbar: " },
};
// 言語: 理論・操作方法のページと同じく localStorage の "smf-lang"。なければブラウザの言語（日本語・ドイツ語、ほかは英語）
let LANG = (() => {
  try { const l = localStorage.getItem("smf-lang"); if (UI_TEXT[l]) return l; } catch (e) { /* 保存できない環境 */ }
  const n = (navigator.language || "ja").slice(0, 2);
  return UI_TEXT[n] ? n : "en";
})();
const T = () => UI_TEXT[LANG];
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii"];
// 選んだ点（位置を仮定した粒子）の色をとる場
const MARK_FIELD = { ee: "n", compton: "photon", confine: "nq", pion: "nA", beta: "e", osc: "muon", vacpol: "e" };
const MARK_COLOR_DEFAULT = "#ff4d6d";
const MARK_SIGMA = 0.025;           // 選んだ点の広がり（箱の半分の辺を 1 として）。点は 4σ までなだらかに消す
const PLAY_SECONDS = 16;            // 全時間を何秒で再生するか
const HOLD_SECONDS = 1.6;           // 最後の時刻で止まっている時間
const AUTO_RESUME = 45;             // 最後の操作からこの秒数で自動の巡回に戻る
const UI_IDLE = 5;                  // マウスが止まってこの秒数で操作の文字を薄く
const FADE_MS = 1400;               // 場面の切り替えの暗転（css の #view の transition と同じ）
const CAM0 = { azim: 0.52, elev: 0.3, dist: 4.6, pan: [0, 0, 0] };
const CAM_RESET_SECONDS = 0.9;      // 座標軸を押してから元の視点に戻るまで
// 座標軸の向き: 物理の x, y, z が世界のどの向きか（world() と同じ並び）
const AXES = [["x", [0, 1, 0]], ["y", [0, 0, 1]], ["z", [1, 0, 0]]];

// ---------------------------------------------------------------- データの登録と読み込み
window.SMV = {
  store: {},
  waits: {},
  add(name, obj) {
    this.store[name] = obj;
    (this.waits[name] || []).forEach((f) => f());
  },
};

function loadScript(name) {
  return new Promise((resolve, reject) => {
    if (window.SMV.store[name]) return resolve(window.SMV.store[name]);
    (window.SMV.waits[name] = window.SMV.waits[name] || []).push(() => resolve(window.SMV.store[name]));
    const s = document.createElement("script");
    s.src = `data/${name}.js`;
    s.onerror = () => reject(new Error(T().noData(name)));
    document.head.appendChild(s);
  });
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 視線方向（データの z）に足し合わせた量の、全時刻での最大（濃さの基準）
function projMax(bytes, nt, n) {
  const n3 = n * n * n, sq = new Float32Array(256);
  for (let i = 0; i < 256; i++) sq[i] = (i / 255) ** 2;
  let m = 1e-12;
  for (let k = 0; k < nt; k++) {
    const off = k * n3;
    for (let xy = 0; xy < n * n; xy++) {
      let s = 0;
      const b = off + xy * n;
      for (let z = 0; z < n; z++) s += sq[bytes[b + z]];
      if (s > m) m = s;
    }
  }
  return m * (2 / n);
}

// 場ごとに: 格子 f.n（既定 meta.n）、時刻の数 f.nt（既定は全部。それより後は 0）、箱 f.box = [データの中心 3, 半分の辺]（既定は全体）
// off: 最初は表示しない場（トピックの off に挙げたもの）
function prepare(raw, off = []) {
  const meta = raw.meta, nt = meta.t.length;
  const fields = Object.entries(raw.fields).map(([key, f]) => {
    const free = b64ToBytes(f.free);
    const cond = f.cond ? b64ToBytes(f.cond) : null;
    const n = f.n || meta.n, fnt = f.nt || nt;
    const box = f.box ? [world(f.box.slice(0, 3), meta.L), f.box[3] / meta.L] : undefined;
    const h = box ? box[1] : 1;                  // 箱が小さいほど視線方向の長さが短い
    return {
      key, label: f.label, color: f.color, rgb: hexToRgb(f.color), free, cond, on: !off.includes(key), n, nt: fnt, box,
      zero: new Uint8Array(n * n * n),
      scale: { free: 1.3 / (projMax(free, fnt, n) * h), cond: cond ? 1.3 / (projMax(cond, fnt, n) * h) : 1 },
    };
  });
  return { meta, fields, nt, markOn: true };
}

// ---------------------------------------------------------------- 状態
const S = {
  topic: null, data: {}, mode: "free", t: 0, playing: true, hold: 0, busy: false,
  lastInput: -1e9, lastCam: -1e9, lastMove: 0, tex: null,
};
const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;
let R;

function cur() { return S.data[S.topic]; }
function topicInfo(id) { return TOPICS.find((x) => x.id === id); }
// いまの言語での名前（訳のない場は日本語の名前。記号の名前 μ⁺, π⁰ などはどの言語でも同じ）
function topicName(id) { return LANG === "ja" ? topicInfo(id).name : NAMES[LANG][id][0]; }
function fieldNames(id) { return LANG === "ja" ? topicInfo(id).fields : { ...topicInfo(id).fields, ...NAMES[LANG][id][1] }; }
function touched() { S.lastInput = now(); }

function frameAt(t) {
  const ts = cur().meta.t;
  if (t <= ts[0]) return [0, 0];
  if (t >= ts[ts.length - 1]) return [ts.length - 2, 1];
  let k = 0;
  while (k < ts.length - 2 && ts[k + 1] <= t) k++;
  return [k, (t - ts[k]) / (ts[k + 1] - ts[k])];
}

// 時間の軸は時刻の番号で等分する（刻みが途中で変わるトピック: 2. は光子の 0.5 刻みの後、分子だけを 5 刻み）
function indexOf(t) { const [k, w] = frameAt(t); return k + w; }
function timeOf(u) {
  const ts = cur().meta.t, k = Math.max(0, Math.min(ts.length - 2, Math.floor(u)));
  return ts[k] + (ts[k + 1] - ts[k]) * Math.max(0, Math.min(1, u - k));
}

// いまのトピック・分散／相関の、場ごと・時刻 k ごとのテクスチャ（k と k + 1 の組）を全部作る。場面の切り替え（暗転の間）にだけ呼び、
// 再生中・場の on/off ではテクスチャを送らない（前のトピックのものは消す）
function buildTextures() {
  const D = cur();
  (S.tex || []).forEach((ts) => ts.forEach((t) => R.deleteVolume(t)));
  S.tex = D.fields.map((f) => {
    const src = S.mode === "cond" ? f.cond : f.free;
    if (!src) return [];
    const n3 = f.n ** 3, at = (j) => (j < f.nt ? src.subarray(j * n3, (j + 1) * n3) : f.zero);
    return Array.from({ length: D.nt - 1 }, (_, k) => R.makeVolume(at(k), at(k + 1), f.n));
  });
}

// データの点 (x, y, z) → 世界 (z, x, y)/L
function world(p, L) { return [p[2] / L, p[0] / L, p[1] / L]; }

function markerAt(t) {
  const m = cur().meta;
  const [k, w] = frameAt(t);
  const a = m.a[k], b = m.a[Math.min(k + 1, m.a.length - 1)];
  return [0, 1, 2].map((i) => a[i] * (1 - w) + b[i] * w);
}

function markColor() {
  const f = cur().fields.find((x) => x.key === MARK_FIELD[S.topic]);
  return f ? f.color : MARK_COLOR_DEFAULT;
}

// ---------------------------------------------------------------- 描画（箱の枠は描かない）
function draw() {
  const D = cur();
  if (!D) return;
  const [k, w] = frameAt(S.t);
  const fields = D.fields.map((f, i) => ({
    on: f.on && (S.mode === "free" || !!f.cond), tex: S.tex[i][k], color: f.rgb, scale: f.scale[S.mode], box: f.box,
  }));
  const points = [];
  const L = D.meta.L;
  const showMark = S.mode === "cond" && D.markOn && !!D.meta.a && S.t >= D.meta.t[1] * 0.5;
  if (showMark) {
    // 選んだ点: 3 次元の分布と同じ書き方の局所的な分布（ガウスの雲、位置を仮定した粒子の色）。点の直径 = 8σ（縁は 0 へなだらかに）
    const a = world(markerAt(S.t), L);
    const c = R.cam;
    const eye = [c.pan[0] + c.dist * Math.cos(c.elev) * Math.sin(c.azim), c.pan[1] + c.dist * Math.sin(c.elev),
      c.pan[2] + c.dist * Math.cos(c.elev) * Math.cos(c.azim)];
    const d = Math.hypot(a[0] - eye[0], a[1] - eye[1], a[2] - eye[2]);
    const pxPerUnit = R.canvas.clientHeight / 2 / (d * Math.tan(0.31));
    points.push({ pos: a, color: hexToRgb(markColor()), size: 8 * MARK_SIGMA * pxPerUnit, blob: true });
  }
  R.render(fields, w, { points });
  const u = indexOf(S.t) / (D.nt - 1);
  $("scrubFill").style.width = `${(u * 100).toFixed(2)}%`;
  if (document.activeElement !== $("time")) $("time").value = Math.round(u * 1000);
}

// ---------------------------------------------------------------- 座標軸（右下）と視点を戻す
function buildAxes() {
  const svg = $("axes"), ns = "http://www.w3.org/2000/svg";
  AXES.forEach(([name]) => {
    const g = document.createElementNS(ns, "g");
    g.innerHTML = `<line x1="0" y1="0"/><text>${name}</text>`;
    svg.appendChild(g);
  });
  svg.addEventListener("click", resetCam);
}

// カメラから見た向きに軸を投影する（右 = 画面の x、上 = 画面の -y、手前ほど濃く）
function drawAxes() {
  const c = R.cam, r = 15;
  const ca = Math.cos(c.azim), sa = Math.sin(c.azim), ce = Math.cos(c.elev), se = Math.sin(c.elev);
  const right = [ca, 0, -sa], up = [-se * sa, ce, -se * ca], back = [ce * sa, se, ce * ca];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const svg = $("axes"), gs = [...svg.children];
  const ps = AXES.map(([, v], i) => ({ g: gs[i], x: dot(v, right), y: -dot(v, up), z: dot(v, back) }));
  ps.sort((a, b) => a.z - b.z).forEach((p) => {
    p.g.parentNode.appendChild(p.g);
    p.g.style.opacity = (0.55 + 0.45 * p.z).toFixed(3);
    const l = p.g.firstChild, t = p.g.lastChild;
    l.setAttribute("x2", (p.x * r).toFixed(2)); l.setAttribute("y2", (p.y * r).toFixed(2));
    t.setAttribute("x", (p.x * (r + 5)).toFixed(2)); t.setAttribute("y", (p.y * (r + 5)).toFixed(2));
  });
  // 置く場所: 元の視点（CAM0）で計算の箱（世界の [-1, 1]³。縁は濃さが 0 へ落ちるので 0.9 倍）の頂点のうち、
  // 画面で最も左下に見えるものの外側。画面の上では動かさない（画面の大きさが変わったときだけ置き直す）
  const W = R.canvas.clientWidth, H = R.canvas.clientHeight, size = svg.clientWidth || 44, m = 12;
  if (S.axesFor === `${W}x${H}`) return;
  S.axesFor = `${W}x${H}`;
  const cam = R.cam;
  R.cam = structuredClone(CAM0);
  const { vp } = R.viewProj();
  R.cam = cam;
  let best = null;
  for (const cx of [-0.9, 0.9]) for (const cy of [-0.9, 0.9]) for (const cz of [-0.9, 0.9]) {
    const q = [0, 1, 2, 3].map((j) => vp[j] * cx + vp[4 + j] * cy + vp[8 + j] * cz + vp[12 + j]);
    const sx = (q[0] / q[3] + 1) / 2 * W, sy = (1 - q[1] / q[3]) / 2 * H;
    if (!best || sy - sx > best[1] - best[0]) best = [sx, sy];
  }
  const x = Math.max(m, Math.min(W - size - m, best[0] - size * 0.5 - 6));
  const y = Math.max(m, Math.min(H - size - m, best[1] - size * 0.5 + 6));
  svg.style.left = `${x.toFixed(1)}px`;
  svg.style.top = `${y.toFixed(1)}px`;
}

function resetCam() {
  touched();
  S.lastCam = now();
  const c = R.cam;
  // 自動の回転で増えた方位角は 1 周ぶんを除いて近い向きから戻す
  const azim = CAM0.azim + ((((c.azim - CAM0.azim) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  S.camReset = { from: { ...structuredClone(c), azim }, u: 0 };
}

function stepCamReset(dt) {
  const q = S.camReset;
  if (!q) return;
  q.u = Math.min(1, q.u + dt / CAM_RESET_SECONDS);
  const w = q.u * q.u * (3 - 2 * q.u), mix = (a, b) => a + (b - a) * w;
  const c = R.cam, f = q.from;
  c.azim = mix(f.azim, CAM0.azim); c.elev = mix(f.elev, CAM0.elev); c.dist = mix(f.dist, CAM0.dist);
  c.pan = f.pan.map((p, i) => mix(p, CAM0.pan[i]));
  S.lastCam = now();
  if (q.u >= 1) S.camReset = null;
}

// ---------------------------------------------------------------- 画面の部品
function buildTopics() {
  const box = $("topics");
  TOPICS.forEach((tp, i) => {
    const b = document.createElement("button");
    b.dataset.id = tp.id;
    b.innerHTML = `<span class="num">${ROMAN[i]}</span><span class="line"></span><span class="name">${topicName(tp.id)}</span>`;
    b.onclick = () => { touched(); if (tp.id !== S.topic) scene(() => show(tp.id, "free")); };
    box.appendChild(b);
  });
}

function buildFields() {
  const D = cur(), box = $("fields"), names = fieldNames(S.topic);
  box.innerHTML = "";
  D.fields.forEach((f) => {
    const el = document.createElement("button");
    el.className = "field";
    el.style.setProperty("--c", f.color);
    if (LANG === "ja") el.title = f.label;          // データの label は日本語の説明
    el.innerHTML = `<span>${names[f.key] || f.label}</span><span class="dot"></span>`;
    el.onclick = () => { touched(); f.on = !f.on; syncFields(); };
    f.el = el;
    box.appendChild(el);
  });
  // 相関の選んだ点（位置を仮定した粒子）も場と同じく表示 / 非表示
  if (D.meta.a) {
    const el = document.createElement("button");
    el.className = "field mark";
    el.style.setProperty("--c", markColor());
    const f = D.fields.find((x) => x.key === MARK_FIELD[S.topic]);
    el.innerHTML = `<span>${T().assumed(f ? names[f.key] || f.label : T().point)}</span><span class="dot"></span>`;
    el.onclick = () => { touched(); if (S.mode === "cond") { D.markOn = !D.markOn; syncFields(); } };
    D.markEl = el;
    box.appendChild(el);
  }
  syncFields();
}

// 言語を切り替える（読み直さないので、再生・視点・音はそのまま）。選んだ言語は説明のページと共有する
function setLang(lang, save) {
  LANG = lang;
  document.documentElement.lang = lang;
  if (save) try { localStorage.setItem("smf-lang", lang); } catch (e) { /* 保存できない環境 */ }
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = T()[el.dataset.i18n]));
  document.querySelectorAll("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", T()[el.dataset.i18nLabel]));
  const page = (p) => (lang === "ja" ? `${p}.html` : `${p}.${lang}.html`);
  $("toGuide").href = page("guide");
  $("toTheory").href = page("theory");
  document.querySelectorAll("#langs button").forEach((b) => b.classList.toggle("on", b.dataset.lang === lang));
  document.querySelectorAll("#topics button").forEach((b) => (b.querySelector(".name").textContent = topicName(b.dataset.id)));
  if (cur()) buildFields();
}

function syncFields() {
  cur().fields.forEach((f) => {
    f.el.classList.toggle("off", !f.on);
    f.el.classList.toggle("muted", S.mode === "cond" && !f.cond);
  });
  const D = cur();
  if (D.markEl) {
    D.markEl.classList.toggle("off", !D.markOn);
    D.markEl.classList.toggle("hidden", S.mode !== "cond");
  }
}

async function ensure(id) {
  if (S.data[id]) return true;
  $("loading").classList.remove("hidden");
  try {
    S.data[id] = prepare(await loadScript(id), topicInfo(id).off);
    // 元の base64 の文字列（1 トピック 15–25 MB）は復号したら捨てる（巡回でトピックが増えるとメモリが膨らみ、GC で止まる）
    delete window.SMV.store[id];
    delete window.SMV.waits[id];
    document.querySelectorAll(`script[src="data/${id}.js"]`).forEach((s) => s.remove());
    return true;
  } catch (e) {
    showError(e.message);
    return false;
  } finally {
    $("loading").classList.add("hidden");
  }
}

// 場面（トピックと分散／相関）を切り替えて最初の時刻から
async function show(id, mode) {
  if (!(await ensure(id))) return;
  const changed = id !== S.topic;
  S.topic = id;
  S.mode = mode;
  S.t = cur().meta.t[0];
  S.hold = 0;
  buildTextures();
  document.querySelectorAll("#topics button").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  if (changed) buildFields(); else syncFields();
}

// 暗転して切り替える
async function scene(fn) {
  if (S.busy) return;
  S.busy = true;
  $("view").classList.add("dim");
  await new Promise((r) => setTimeout(r, FADE_MS));
  await fn();
  $("view").classList.remove("dim");
  S.busy = false;
}

// 自動の巡回: 分散 → 相関 → 次のトピックの分散
function advance() {
  if (S.mode === "free") return scene(() => show(S.topic, "cond"));
  const i = TOPICS.findIndex((x) => x.id === S.topic);
  return scene(() => show(TOPICS[(i + 1) % TOPICS.length].id, "free"));
}

function showError(msg) {
  const e = $("error");
  e.textContent = msg;
  e.classList.remove("hidden");
  setTimeout(() => e.classList.add("hidden"), 6000);
}

// ---------------------------------------------------------------- BGM（endless-preludes「Drifting Prelude」、CC BY 4.0）
const BGM = {
  el: null, want: true, fade: null,
  init() {
    this.el = $("bgm");
    try { this.want = localStorage.getItem("smf.sound") !== "off"; } catch (e) { /* 保存できない環境 */ }
    this.el.volume = 0;
    this.label();
    if (this.want) this.start();
    const kick = () => { if (this.want && this.el.paused) this.start(); };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
  },
  start() {
    const p = this.el.play();
    if (p) p.then(() => { this.ramp(0.55, 5); this.label(); }).catch(() => this.label());
  },
  ramp(to, sec) {
    clearInterval(this.fade);
    const from = this.el.volume, t0 = now();
    this.fade = setInterval(() => {
      const u = Math.min(1, (now() - t0) / sec);
      this.el.volume = from + (to - from) * u;
      if (u >= 1) { clearInterval(this.fade); if (to === 0) this.el.pause(); }
    }, 50);
  },
  toggle() {
    this.want = !this.want;
    try { localStorage.setItem("smf.sound", this.want ? "on" : "off"); } catch (e) { /* 保存できない環境 */ }
    if (this.want) this.start(); else this.ramp(0, 1.2);
    this.label();
  },
  label() { $("soundState").textContent = this.want && !this.el.paused ? "on" : "off"; },
};

// ---------------------------------------------------------------- 操作
function bindUI() {
  document.querySelectorAll("#mode button").forEach((b) => (b.onclick = () => {
    touched();
    if (b.dataset.mode !== S.mode) scene(() => show(S.topic, b.dataset.mode));
  }));
  $("sound").onclick = (e) => { e.stopPropagation(); BGM.toggle(); };
  document.querySelectorAll("#langs button").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); touched(); setLang(b.dataset.lang, true); }));
  $("time").oninput = (e) => { touched(); S.hold = 0; S.t = timeOf((e.target.value / 1000) * (cur().nt - 1)); };
  window.addEventListener("keydown", (e) => {
    const D = cur();
    if (!D) return;
    touched();
    if (e.code === "Space") { e.preventDefault(); S.playing = !S.playing; }
    if (e.code === "ArrowRight") S.t = timeOf(Math.min(D.nt - 1, indexOf(S.t) + 1));
    if (e.code === "ArrowLeft") S.t = timeOf(Math.max(0, indexOf(S.t) - 1));
  });
  // 操作の文字は、マウスが止まると薄くする
  window.addEventListener("pointermove", () => { S.lastMove = now(); document.body.classList.remove("idle"); });
  // カメラ（回転・平行移動・拡大。箱の中にも入れる）
  const cv = $("view");
  let drag = null;
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("pointerdown", (e) => { S.camReset = null; drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointerup", () => (drag = null));
  cv.addEventListener("dblclick", resetCam);
  cv.addEventListener("pointermove", (e) => {
    if (!drag) return;
    S.lastCam = now();
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    const c = R.cam;
    if (drag.pan) {
      const s = c.dist * 0.0015;
      const right = [Math.cos(c.azim), 0, -Math.sin(c.azim)];
      c.pan = [c.pan[0] - right[0] * dx * s, c.pan[1] + dy * s, c.pan[2] - right[2] * dx * s];
    } else {
      c.azim -= dx * 0.006;
      c.elev = Math.max(-1.45, Math.min(1.45, c.elev + dy * 0.006));
    }
  });
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    S.camReset = null;
    S.lastCam = now();
    R.cam.dist = Math.max(0.4, Math.min(12, R.cam.dist * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });
}

let last = performance.now();
function loop(ms) {
  const dt = Math.min(0.1, (ms - last) / 1000);
  last = ms;
  const D = cur(), t = now();
  if (t - S.lastMove > UI_IDLE) document.body.classList.add("idle");
  // カメラは触っていなければゆっくり回る
  if (t - S.lastCam > 8) R.cam.azim += 0.035 * dt;
  stepCamReset(dt);
  if (D && S.playing && !S.busy) {
    const end = D.nt - 1;
    const u = indexOf(S.t) + (end / PLAY_SECONDS) * dt;
    if (u < end) S.t = timeOf(u);
    else {
      S.t = D.meta.t[end];
      S.hold += dt;
      if (S.hold > HOLD_SECONDS) {
        if (t - S.lastInput > AUTO_RESUME) advance();
        else { S.t = D.meta.t[0]; S.hold = 0; }
      }
    }
  }
  try { draw(); drawAxes(); } catch (e) { console.error(e); }
  requestAnimationFrame(loop);
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    R = new VolumeRenderer($("view"));
  } catch (e) {
    showError(T().noGL + e.message);
    return;
  }
  Object.assign(R.cam, structuredClone(CAM0));
  buildTopics();
  setLang(LANG, false);
  buildAxes();
  bindUI();
  BGM.init();
  const h = location.hash.slice(1);
  $("view").classList.add("dim");
  await show(topicInfo(h) ? h : TOPICS[0].id, "free");
  requestAnimationFrame(() => $("view").classList.remove("dim"));
  requestAnimationFrame(loop);
});
