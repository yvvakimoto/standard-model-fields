// 体積のレイマーチング（WebGL2）: 各場の値を視線方向に足し合わせ、√ をとって色の階調（背景 → 色 → 白）にし、
// 場ごとの色を足し合わせる（加法混色）。データは uint8 の √(値/基準) なので、2 乗して元の値に戻してから足す。
// 座標: データの (x, y, z) → 画面の世界座標 (X, Y, Z) = (z, x, y)（縦 = データの x）
"use strict";

const MAXF = 8;
const MAX_PIXELS = 2.2e6;    // 描く画素の数の上限（1920×1080 ≈ 2.1e6。高解像度の画面では引き伸ばして表示する）

const VS_QUAD = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

function fsVolume() {
  let samplers = "";
  let accum = "";
  for (let i = 0; i < MAXF; i++) {
    samplers += `uniform highp sampler3D uTex${i};\n`;
    // 場ごとの箱（世界の中心 uBoxC、半分の辺 uBoxH。既定は全体の箱）。テクスチャ (s, t, r) = データ (z, y, x) = 世界 (X, Z, Y)
    accum += `      if (uOn[${i}] > 0.5) { vec3 b = (w - uBoxC[${i}]) / uBoxH[${i}];
        float e = max(max(abs(b.x), abs(b.y)), abs(b.z));
        if (e <= 1.0) { vec2 s = texture(uTex${i}, vec3(b.x, b.z, b.y) * 0.5 + 0.5).rg; float q = mix(s.r, s.g, uMix); acc[${i}] += q * q * edgeFade(e, b); } }\n`;
  }
  return `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
${samplers}
uniform float uOn[${MAXF}];
uniform vec3 uColor[${MAXF}];
uniform float uScale[${MAXF}];
uniform vec3 uBoxC[${MAXF}];
uniform float uBoxH[${MAXF}];
uniform float uMix;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uBg;
uniform int uSteps;
uniform float uCut;

vec3 rampColor(float a, vec3 c) {
  a = clamp(a, 0.0, 1.0);
  vec3 w = 0.25 * c + vec3(0.75);
  return a < 0.7 ? mix(uBg, c, a / 0.7) : mix(c, w, (a - 0.7) / 0.3);
}

// 箱の縁を見せない窓（表示だけ。中の値は変えない）: 立方体の縁へ向けて 0.6 → 1 で、中心からの距離でも 0.8 → 1.2 で
// なだらかに 0 へ（輪郭を丸くする）
float edgeFade(float e, vec3 b) { return (1.0 - smoothstep(0.6, 1.0, e)) * (1.0 - smoothstep(0.8, 1.2, length(b))); }

bool hitBox(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 inv = 1.0 / rd;
  vec3 a = (vec3(-1.0) - ro) * inv, b = (vec3(1.0) - ro) * inv;
  vec3 lo = min(a, b), hi = max(a, b);
  t0 = max(max(lo.x, lo.y), lo.z);
  t1 = min(min(hi.x, hi.y), hi.z);
  return t1 > max(t0, 0.0);
}

void main() {
  vec4 p0 = uInvViewProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec4 p1 = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 ro = uCamPos;
  vec3 rd = normalize(p1.xyz / p1.w - p0.xyz / p0.w);
  float t0, t1;
  vec3 col = uBg;
  if (hitBox(ro, rd, t0, t1)) {
    t0 = max(t0, 0.0);
    float dt = (t1 - t0) / float(uSteps);
    float acc[${MAXF}];
    for (int i = 0; i < ${MAXF}; i++) acc[i] = 0.0;
    for (int k = 0; k < 512; k++) {
      if (k >= uSteps) break;
      vec3 w = ro + rd * (t0 + (float(k) + 0.5) * dt);
      // 世界 (X, Y, Z) = データ (z, x, y)。テクスチャ (s, t, r) = データ (z, y, x)（[x][y][z] の並びで z が最も速い）
      if (uCut > 0.5 && uCut < 1.5 && w.z > 0.0) continue;        // 1: 手前半分（データの y > 0）を切り取る
      if (uCut > 1.5 && abs(w.z) > 0.08) continue;                // 2: 中央の薄い板（y ≈ 0）だけ
${accum}
    }
    float nOn = 0.0;
    for (int i = 0; i < ${MAXF}; i++) nOn += uOn[i];
    float wgt = min(1.0, 1.2 / sqrt(max(nOn, 1.0)));   // 重ねる数が多いほど 1 つずつを弱く（白く飽和しないように）
    for (int i = 0; i < ${MAXF}; i++) {
      if (uOn[i] > 0.5) col += (rampColor(sqrt(acc[i] * dt * uScale[i]), uColor[i]) - uBg) * wgt;
    }
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
}

const VS_LINE = `#version 300 es
in vec3 aPos;
uniform mat4 uViewProj;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;
const FS_LINE = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

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

// ---------------------------------------------------------------- 描画器
class VolumeRenderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 が使えません");
    this.gl = gl;
    this.canvas = canvas;
    this.pVol = program(gl, VS_QUAD, fsVolume());
    this.pLine = program(gl, VS_LINE, FS_LINE);
    this.pPoint = program(gl, VS_POINT, FS_POINT);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.lineBuf = gl.createBuffer();
    this.pointBuf = gl.createBuffer();
    this.uloc = new Map();
    this.empty = this.makeVolume(new Uint8Array(1), new Uint8Array(1), 1);
    gl.useProgram(this.pVol);
    for (let i = 0; i < MAXF; i++) gl.uniform1i(this.u(this.pVol, `uTex${i}`), i);
    this.bg = hexToRgb("#07090f");
    this.cam = { azim: 0.52, elev: 0.38, dist: 7.2, pan: [0, 0, 0] };
    this.steps = 160;
  }

  // uniform の場所（プログラムと名前ごとに 1 回だけ問い合わせる）
  u(p, name) {
    let m = this.uloc.get(p);
    if (!m) this.uloc.set(p, (m = {}));
    if (!(name in m)) m[name] = this.gl.getUniformLocation(p, name);
    return m[name];
  }

  // 時刻 k と k + 1 の体積（uint8、長さ n³ の 2 つ）を RG に詰めたテクスチャを作る。場面の切り替えのときに全時刻ぶんを作っておき、
  // 再生中は選んで束ねるだけにする（再生中に中身を差し替えると、まだ描画に使っているテクスチャを待って止まることがある）
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

  // fields: [{on, tex（makeVolume のテクスチャ）, color(rgb), scale, box: [世界の中心, 半分の辺] | undefined}]、mix: 時刻の内挿、
  // points: [{pos(world), color, size, blob}]、lines: [[p, q, rgba]]（任意）
  render(fields, mix, opts) {
    const gl = this.gl;
    // 描く画素の数に上限を置く（レイマーチングの重さは画素の数に比例。格子は 40–56 点なので、これより細かくしても見た目は変わらない）
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / Math.max(cw * ch, 1)));
    const w = Math.floor(cw * dpr), h = Math.floor(ch * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const { vp, eye } = this.viewProj();
    const U = (name) => this.u(this.pVol, name);
    // 体積
    gl.useProgram(this.pVol);
    for (let i = 0; i < MAXF; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_3D, (fields[i] && fields[i].on && fields[i].tex) || this.empty);
    }
    const on = new Float32Array(MAXF), col = new Float32Array(MAXF * 3), sc = new Float32Array(MAXF);
    const bc = new Float32Array(MAXF * 3), bh = new Float32Array(MAXF).fill(1);
    fields.forEach((f, i) => {
      on[i] = f.on ? 1 : 0; col.set(f.color, i * 3); sc[i] = f.scale;
      if (f.box) { bc.set(f.box[0], i * 3); bh[i] = f.box[1]; }
    });
    gl.uniform1fv(U("uOn"), on);
    gl.uniform3fv(U("uColor"), col);
    gl.uniform1fv(U("uScale"), sc);
    gl.uniform3fv(U("uBoxC"), bc);
    gl.uniform1fv(U("uBoxH"), bh);
    gl.uniform1f(U("uMix"), mix);
    gl.uniformMatrix4fv(U("uInvViewProj"), false, M4.invert(vp));
    gl.uniform3fv(U("uCamPos"), eye);
    gl.uniform3fv(U("uBg"), this.bg);
    gl.uniform1i(U("uSteps"), this.steps);
    gl.uniform1f(U("uCut"), opts.cut || 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(this.pVol, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(loc);
    // 線（直方体・点線）
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.pLine);
    gl.uniformMatrix4fv(this.u(this.pLine, "uViewProj"), false, vp);
    const lloc = gl.getAttribLocation(this.pLine, "aPos");
    for (const [pts, rgba] of opts.lines || []) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts.flat()), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(lloc);
      gl.vertexAttribPointer(lloc, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4fv(this.u(this.pLine, "uColor"), rgba);
      gl.drawArrays(gl.LINES, 0, pts.length);
    }
    // 点（● や星）
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
    }
    gl.disable(gl.BLEND);
    return vp;
  }
}

window.VolumeRenderer = VolumeRenderer;
window.hexToRgb = hexToRgb;
