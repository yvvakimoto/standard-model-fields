// 体積の描画（WebGL2）: 各場の値を視線方向に足し合わせ、√ をとって色の階調（背景 → 色 → 白）にし、
// 場ごとの色を足し合わせる（加法混色）。データは uint8 の √(値/基準) なので、2 乗して元の値に戻してから足す。
// 座標: データの (x, y, z) → 画面の世界座標 (X, Y, Z) = (z, x, y)（縦 = データの x）
//
// 足し合わせは吸収のない線形の積分なので、2 段に分ける（描く量は変えずに、計算を格子の細かさに合わせる）:
//   1. 積分: 場ごとの視線の積分の √ を、格子の 1 セルが数画素になる小さな画面に書く（8 つの場 = RGBA 2 枚。縁の外に 1 画素の余白）。
//      各場は自分の箱のうち値が 0 でない範囲（時刻ごとに CPU で求めた直方体）だけを、自分のセルの半分の刻みでたどる
//   2. 合成: 1. を画面の大きさに双一次で引き伸ばし、色の階調にする。√ の後で引き伸ばすのは、淡い縁で √ が急に立ち上がり、
//      線形の量の内挿の誤差を拡大するため（ガウスの裾 e^{-r²} の √ は e^{-r²/2} で、なだらか）
// 元の全画面の計算との差は、平均 0.01/255、99.9 % の画素で 1/255 以下（tools/bench_render.py）
"use strict";

const MAXF = 8;
const MAX_STEPS = 320;

const VS_QUAD = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// 1. 積分。out0 = 場 0–3、out1 = 場 4–7 の √(s_i ∫ v_i W dℓ)（uLinear = 0 = 8 bit のときは 1 で切る）。
//    この画面は画面の縁の外へ uPad 倍だけ広く（引き伸ばすとき縁で値を延ばさないように）
function fsIntegrate() {
  let samplers = "", calls = "";
  for (let i = 0; i < MAXF; i++) {
    samplers += `uniform highp sampler3D uTex${i};\n`;
    calls += `  if (uOn[${i}] > 0.5) a[${i}] = uScale[${i}] * march(uTex${i}, ro, rd, uBoxC[${i}], uBoxH[${i}], uLo[${i}], uHi[${i}], uStep[${i}]);\n`;
  }
  return `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
layout(location = 0) out vec4 out0;
layout(location = 1) out vec4 out1;
${samplers}
uniform float uOn[${MAXF}];
uniform float uScale[${MAXF}];
uniform vec3 uBoxC[${MAXF}];
uniform float uBoxH[${MAXF}];
uniform vec3 uLo[${MAXF}];
uniform vec3 uHi[${MAXF}];
uniform float uStep[${MAXF}];
uniform float uMix;
uniform float uLinear;
uniform vec2 uPad;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;

// 箱の縁を見せない窓（表示だけ。中の値は変えない）: 立方体の縁へ向けて 0.6 → 1 で、中心からの距離でも 0.8 → 1.2 で
// なだらかに 0 へ（輪郭を丸くする）
float edgeFade(float e, vec3 b) { return (1.0 - smoothstep(0.6, 1.0, e)) * (1.0 - smoothstep(0.8, 1.2, length(b))); }

// 世界の直方体 [lo, hi]（場の箱のうち値が 0 でない範囲）の中だけを、刻み step 以下の等しい間隔でたどる（中点の和）
float march(highp sampler3D tex, vec3 ro, vec3 rd, vec3 c, float h, vec3 lo, vec3 hi, float step) {
  vec3 inv = 1.0 / rd;
  vec3 ta = (lo - ro) * inv, tb = (hi - ro) * inv;
  vec3 mn = min(ta, tb), mx = max(ta, tb);
  float t0 = max(max(max(mn.x, mn.y), mn.z), 0.0);
  float t1 = min(min(mx.x, mx.y), mx.z);
  if (t1 <= t0) return 0.0;
  int n = int(clamp(ceil((t1 - t0) / step), 1.0, float(${MAX_STEPS})));
  float dt = (t1 - t0) / float(n);
  float s = 0.0;
  for (int k = 0; k < ${MAX_STEPS}; k++) {
    if (k >= n) break;
    vec3 b = (ro + rd * (t0 + (float(k) + 0.5) * dt) - c) / h;
    // テクスチャ (s, t, r) = データ (z, y, x) = 世界 (X, Z, Y)
    vec2 v = texture(tex, vec3(b.x, b.z, b.y) * 0.5 + 0.5).rg;
    float q = mix(v.r, v.g, uMix);
    s += q * q * edgeFade(max(max(abs(b.x), abs(b.y)), abs(b.z)), b);
  }
  return s * dt;
}

void main() {
  vec2 ndc = (vUv * 2.0 - 1.0) * uPad;
  vec4 p0 = uInvViewProj * vec4(ndc, -1.0, 1.0);
  vec4 p1 = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 ro = uCamPos;
  vec3 rd = normalize(p1.xyz / p1.w - p0.xyz / p0.w);
  float a[${MAXF}];
  for (int i = 0; i < ${MAXF}; i++) a[i] = 0.0;
${calls}
  vec4 A = vec4(a[0], a[1], a[2], a[3]), B = vec4(a[4], a[5], a[6], a[7]);
  A = sqrt(A); B = sqrt(B);
  if (uLinear < 0.5) { A = min(A, 1.0); B = min(B, 1.0); }
  out0 = A;
  out1 = B;
}`;
}

// 2. 合成: 積分の √ を双一次で引き伸ばして色の階調にし、場の色を足す（3 次の B スプラインはぼかす分だけかえって差が大きい）
const FS_COMPOSE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uA;
uniform sampler2D uB;
uniform vec2 uPad;
uniform float uOn[${MAXF}];
uniform vec3 uColor[${MAXF}];
uniform vec3 uBg;
uniform float uWgt;

vec3 rampColor(float a, vec3 c) {
  a = clamp(a, 0.0, 1.0);
  vec3 w = 0.25 * c + vec3(0.75);
  return a < 0.7 ? mix(uBg, c, a / 0.7) : mix(c, w, (a - 0.7) / 0.3);
}

void main() {
  vec2 uv = (vUv - 0.5) / uPad + 0.5;
  vec4 A = texture(uA, uv), B = texture(uB, uv);
  float a[${MAXF}] = float[${MAXF}](A.x, A.y, A.z, A.w, B.x, B.y, B.z, B.w);
  vec3 col = uBg;
  for (int i = 0; i < ${MAXF}; i++) {
    if (uOn[i] > 0.5) col += (rampColor(a[i], uColor[i]) - uBg) * uWgt;
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const VS_POINT = `#version 300 es
in vec3 aPos;
uniform mat4 uViewProj;
uniform float uSize;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); gl_PointSize = uSize; }`;
const FS_POINT = `#version 300 es
precision mediump float;
uniform vec3 uColor;
uniform vec3 uBg;
uniform float uBlob;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r = length(d);
  if (r > 1.0) discard;
  if (uBlob > 0.5) {
    // 局所的な分布: 3 次元のガウスの投影（点の直径 = 8σ、縁で 0 へなだらかに）を、場と同じ √ と色の階調で。加法で重ねる
    float rs = 4.0 * r;
    float a = sqrt(exp(-0.5 * rs * rs)) * (1.0 - smoothstep(0.6, 1.0, r));
    vec3 w = 0.25 * uColor + vec3(0.75);
    vec3 c = a < 0.7 ? mix(uBg, uColor, a / 0.7) : mix(uColor, w, (a - 0.7) / 0.3);
    outColor = vec4(max(c - uBg, 0.0), 1.0);
    return;
  }
  float core = smoothstep(0.32, 0.18, r);
  float glow = exp(-r * r * 5.0) * 0.85;
  vec3 c = mix(uColor * glow, vec3(1.0), core);
  outColor = vec4(c, max(core, glow));
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// ---------------------------------------------------------------- 行列（列優先）
const M4 = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
    return o;
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(eye, at, up) {
    const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  },
  invert(m) {
    const inv = new Float32Array(16);
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
    let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    det = 1 / det;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  },
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function hexToRgb(h) {
  h = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

// 体積（uint8、長さ n³、[x][y][z] で z が最も速い）の値が 0 でない範囲 → 箱の座標 [-1, 1]³ の直方体（世界の向き X, Y, Z）。
// テクスチャの一次の内挿はセルの中心の間でつながるので、両側に 1 セルぶん広げる。すべて 0 なら null
function volumeBounds(a, n) {
  let x0 = n, x1 = -1, y0 = n, y1 = -1, z0 = n, z1 = -1;
  for (let x = 0, j = 0; x < n; x++) for (let y = 0; y < n; y++) {
    let lo = -1, hi = -1;
    for (let z = 0; z < n; z++, j++) if (a[j]) { if (lo < 0) lo = z; hi = z; }
    if (lo < 0) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (lo < z0) z0 = lo;
    if (hi > z1) z1 = hi;
  }
  if (x1 < 0) return null;
  const b = (i0, i1) => [Math.max(-1, (2 * i0 - 1) / n - 1), Math.min(1, (2 * i1 + 3) / n - 1)];
  const [X, Y, Z] = [b(z0, z1), b(x0, x1), b(y0, y1)];    // 世界 (X, Y, Z) = データ (z, x, y)
  return [[X[0], Y[0], Z[0]], [X[1], Y[1], Z[1]]];
}

// ---------------------------------------------------------------- 描画器
class VolumeRenderer {
  constructor(canvas) {
    // 体積は全画面の四角形なので、多重標本化の縁の平滑化は効かない（重いだけなので切る）。2 つの GPU があれば速い方を
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 が使えません");
    this.gl = gl;
    this.canvas = canvas;
    this.pInt = program(gl, VS_QUAD, fsIntegrate());
    this.pComp = program(gl, VS_QUAD, FS_COMPOSE);
    this.pPoint = program(gl, VS_POINT, FS_POINT);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.pointBuf = gl.createBuffer();
    this.uloc = new Map();
    this.empty = this.makeVolume(new Uint8Array(1), new Uint8Array(1), 1);
    gl.useProgram(this.pInt);
    for (let i = 0; i < MAXF; i++) gl.uniform1i(this.u(this.pInt, `uTex${i}`), i);
    gl.useProgram(this.pComp);
    gl.uniform1i(this.u(this.pComp, "uA"), 0);
    gl.uniform1i(this.u(this.pComp, "uB"), 1);
    // 積分を書く画面: 半精度の浮動小数点に描けるなら線形の量のまま、描けなければ 8 bit に √ で
    this.linear = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    this.fbo = gl.createFramebuffer();
    this.acc = [gl.createTexture(), gl.createTexture()];
    this.accSize = [0, 0];
    this.bg = hexToRgb("#07090f");
    this.cam = { azim: 0.52, elev: 0.38, dist: 7.2, pan: [0, 0, 0] };
    this.setQuality({ maxPixels: 4e6, maxDpr: 2, cellPx: 3, rate: 2 });
    this.stats = { w: 0, h: 0 };
  }

  // 描画の細かさ: 画面に描く画素の数の上限 maxPixels と密度の上限 maxDpr（合成だけに効く。軽い）、
  // 積分の画面で格子の 1 セルが占める画素の数 cellPx、視線に沿って 1 セルあたりの標本の数 rate
  setQuality(q) { Object.assign(this, { maxPixels: q.maxPixels, maxDpr: q.maxDpr, cellPx: q.cellPx, rate: q.rate }); }

  // uniform の場所（プログラムと名前ごとに 1 回だけ問い合わせる）
  u(p, name) {
    let m = this.uloc.get(p);
    if (!m) this.uloc.set(p, (m = {}));
    if (!(name in m)) m[name] = this.gl.getUniformLocation(p, name);
    return m[name];
  }

  // 時刻 k と k + 1 の体積（uint8、長さ n³ の 2 つ）を RG に詰めたテクスチャを作る。場面の切り替えのときに全時刻ぶんを作っておき、
  // 再生中は選んで束ねるだけにする（再生中に中身を差し替えると、まだ描画に使っているテクスチャを待って止まることがある）。
  // 値が 0 でない範囲（2 つの時刻の和、箱の座標）を tex.bounds に付ける（null = すべて 0）
  makeVolume(a, b, n) {
    const gl = this.gl, n3 = n * n * n;
    if (!this.rgBuf || this.rgBuf.length !== 2 * n3) this.rgBuf = new Uint8Array(2 * n3);
    const rg = this.rgBuf;
    for (let j = 0; j < n3; j++) { rg[2 * j] = a[j]; rg[2 * j + 1] = b[j]; }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // データは [x][y][z]（z が最も速い）なので、テクスチャの (s, t, r) = データの (z, y, x)。シェーダの tc はこれに合わせてある
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG8, n, n, n, 0, gl.RG, gl.UNSIGNED_BYTE, rg);
    const ba = volumeBounds(a, n), bb = a === b ? ba : volumeBounds(b, n);
    t.bounds = !ba ? bb : !bb ? ba : [ba[0].map((v, i) => Math.min(v, bb[0][i])), ba[1].map((v, i) => Math.max(v, bb[1][i]))];
    t.n = n;
    return t;
  }

  deleteVolume(t) { this.gl.deleteTexture(t); }

  viewProj() {
    const c = this.cam, aspect = this.canvas.width / this.canvas.height;
    const eye = [c.pan[0] + c.dist * Math.cos(c.elev) * Math.sin(c.azim), c.pan[1] + c.dist * Math.sin(c.elev),
      c.pan[2] + c.dist * Math.cos(c.elev) * Math.cos(c.azim)];
    const view = M4.lookAt(eye, c.pan, [0, 1, 0]);
    const proj = M4.perspective(0.62, aspect, 0.05, 50);
    return { vp: M4.mul(proj, view), eye };
  }

  // 積分を書く 2 枚のテクスチャを w × h に
  sizeAcc(w, h) {
    const gl = this.gl;
    if (this.accSize[0] === w && this.accSize[1] === h) return;
    this.accSize = [w, h];
    for (const t of this.acc) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      if (this.linear) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.acc[0], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.acc[1], 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (this.linear && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      this.linear = false;                        // 浮動小数点に描けない環境では 8 bit に
      this.accSize = [0, 0];
      this.sizeAcc(w, h);
    }
  }

  // fields: [{on, tex（makeVolume のテクスチャ）, color(rgb), scale, box: [世界の中心, 半分の辺] | undefined}]、mix: 時刻の内挿、
  // points: [{pos(world), color, size, blob}]
  render(fields, mix, opts) {
    const gl = this.gl;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr, Math.sqrt(this.maxPixels / Math.max(cw * ch, 1)));
    const W = Math.max(1, Math.floor(cw * dpr)), H = Math.max(1, Math.floor(ch * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const { vp, eye } = this.viewProj();

    // 場ごとの描く範囲（世界の直方体）と刻み。積分の画面の高さは、箱の最も遠い所で 1 セルが cellPx 画素になるように
    const on = new Float32Array(MAXF), sc = new Float32Array(MAXF), bc = new Float32Array(MAXF * 3), bh = new Float32Array(MAXF).fill(1);
    const lo = new Float32Array(MAXF * 3), hi = new Float32Array(MAXF * 3), st = new Float32Array(MAXF).fill(1);
    const shown = new Float32Array(MAXF), col = new Float32Array(MAXF * 3);
    let need = 64, nOn = 0, rect = null;
    fields.forEach((f, i) => {
      col.set(f.color, i * 3);
      if (!f.on) return;
      shown[i] = 1;
      nOn++;
      const t = f.tex, c = f.box ? f.box[0] : [0, 0, 0], h = f.box ? f.box[1] : 1;
      if (!t || !t.bounds) return;                // 表示するが、いまの 2 つの時刻ですべて 0
      const cell = (2 * h) / t.n;
      on[i] = 1; sc[i] = f.scale; bc.set(c, i * 3); bh[i] = h; st[i] = cell / this.rate;
      for (let k = 0; k < 3; k++) { lo[i * 3 + k] = c[k] + h * t.bounds[0][k]; hi[i * 3 + k] = c[k] + h * t.bounds[1][k]; }
      const far = Math.hypot(eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]) + h * Math.sqrt(3);
      need = Math.max(need, (this.cellPx * 2 * far * Math.tan(0.31)) / cell);
      rect = unionRect(rect, vp, lo.subarray(i * 3, i * 3 + 3), hi.subarray(i * 3, i * 3 + 3));
    });
    const s = Math.min(1, need / H);
    const w = Math.max(1, Math.ceil(W * s)) + 2, h = Math.max(1, Math.ceil(H * s)) + 2;
    const pad = [w / (w - 2), h / (h - 2)];       // 両側に 1 画素の余白
    this.stats = { w, h };
    // 映る四角（画面の -1..1）→ 積分の画面の画素（x0..x1）、画面の画素（X0..X1）。積分の 2 画素ぶん広げる
    const px = (v, n, p) => (v / p * 0.5 + 0.5) * n, r = rect || [0, 0, 0, 0];
    const x0 = Math.max(0, Math.floor(px(r[0], w, pad[0])) - 2), y0 = Math.max(0, Math.floor(px(r[1], h, pad[1])) - 2);
    const x1 = Math.min(w, Math.ceil(px(r[2], w, pad[0])) + 2), y1 = Math.min(h, Math.ceil(px(r[3], h, pad[1])) + 2);
    const X0 = Math.max(0, Math.floor(px(r[0], W, 1) - (2 * W) / w)), Y0 = Math.max(0, Math.floor(px(r[1], H, 1) - (2 * H) / h));
    const X1 = Math.min(W, Math.ceil(px(r[2], W, 1) + (2 * W) / w)), Y1 = Math.min(H, Math.ceil(px(r[3], H, 1) + (2 * H) / h));

    // 1. 積分（値が 0 でない範囲が画面に映る四角の中だけ。外は 0）
    this.sizeAcc(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (rect && x1 > x0 && y1 > y0) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x0, y0, x1 - x0, y1 - y0);
      gl.useProgram(this.pInt);
      const U = (name) => this.u(this.pInt, name);
      for (let i = 0; i < MAXF; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_3D, (on[i] && fields[i].tex) || this.empty);
      }
      gl.uniform1fv(U("uOn"), on);
      gl.uniform1fv(U("uScale"), sc);
      gl.uniform3fv(U("uBoxC"), bc);
      gl.uniform1fv(U("uBoxH"), bh);
      gl.uniform3fv(U("uLo"), lo);
      gl.uniform3fv(U("uHi"), hi);
      gl.uniform1fv(U("uStep"), st);
      gl.uniform1f(U("uMix"), mix);
      gl.uniform1f(U("uLinear"), this.linear ? 1 : 0);
      gl.uniform2fv(U("uPad"), pad);
      gl.uniformMatrix4fv(U("uInvViewProj"), false, M4.invert(vp));
      gl.uniform3fv(U("uCamPos"), eye);
      this.drawQuad(this.pInt);
      gl.disable(gl.SCISSOR_TEST);
    }

    // 2. 合成（画面の大きさで）。積分が 0 の所は背景の色そのものなので、映る四角の外は塗るだけ
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (rect && X1 > X0 && Y1 > Y0) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(X0, Y0, X1 - X0, Y1 - Y0);
      gl.useProgram(this.pComp);
      const C = (name) => this.u(this.pComp, name);
      for (let i = 0; i < 2; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, this.acc[i]);
      }
      gl.uniform1fv(C("uOn"), shown);
      gl.uniform3fv(C("uColor"), col);
      gl.uniform3fv(C("uBg"), this.bg);
      gl.uniform1f(C("uWgt"), Math.min(1, 1.2 / Math.sqrt(Math.max(nOn, 1))));   // 重ねる数が多いほど 1 つずつを弱く（白く飽和しないように）
      gl.uniform2fv(C("uPad"), pad);
      this.drawQuad(this.pComp);
      gl.disable(gl.SCISSOR_TEST);
    }

    // 点（相関の選んだ点）
    gl.enable(gl.BLEND);
    gl.useProgram(this.pPoint);
    gl.uniformMatrix4fv(this.u(this.pPoint, "uViewProj"), false, vp);
    const ploc = gl.getAttribLocation(this.pPoint, "aPos");
    for (const p of opts.points || []) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(p.pos), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(ploc);
      gl.vertexAttribPointer(ploc, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(this.u(this.pPoint, "uColor"), p.color);
      gl.uniform3fv(this.u(this.pPoint, "uBg"), this.bg);
      gl.uniform1f(this.u(this.pPoint, "uBlob"), p.blob ? 1 : 0);
      gl.uniform1f(this.u(this.pPoint, "uSize"), Math.min(p.size * dpr, 512));
      if (p.blob) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, 1);
      gl.disableVertexAttribArray(ploc);
    }
    gl.disable(gl.BLEND);
    return vp;
  }

  drawQuad(p) {
    const gl = this.gl, loc = gl.getAttribLocation(p, "aPos");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(loc);
  }
}

// 世界の直方体 [lo, hi] が画面（-1..1）に映る四角を r に合わせる。頂点がカメラの後ろ・近すぎるなら画面全体
function unionRect(r, vp, lo, hi) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const p = [k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]];
    const q = [0, 1, 3].map((j) => vp[j] * p[0] + vp[4 + j] * p[1] + vp[8 + j] * p[2] + vp[12 + j]);
    if (q[2] <= 0.05) return [-1, -1, 1, 1];
    const x = q[0] / q[2], y = q[1] / q[2];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (r) { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); }
  return [Math.max(-1, x0), Math.max(-1, y0), Math.min(1, x1), Math.min(1, y1)];
}

window.VolumeRenderer = VolumeRenderer;
window.hexToRgb = hexToRgb;
