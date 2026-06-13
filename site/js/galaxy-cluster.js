/* ============================================================
   galaxy-cluster.js — @danfrank · THE CLUSTER
   <galaxy-cluster> — full-screen living galaxy cluster.
   Primary path: WebGL2, ~50k GPU particles (transform-feedback
   ping-pong, zero CPU physics). Fallback path: Canvas2D, ~7k
   CPU particles with identical forces — no GPU required.
   A central black hole wears the "@danfrank" wordmark as a
   particle constellation; spiral arms, satellite galaxies and
   energy streams orbit it.
   Cursor = gravity well. Drag = grab + flick matter.
   Click = neon shockwave. Click+hold = spiral vortex.
   Game mechanic: stirring matter near the core charges the
   breach. Emits:
     document CustomEvent 'void:charge'       {level: 0..1}
     document CustomEvent 'void:fluid-failed' (no canvas at all —
       legacy event name kept so the host shell needs no change)
   attrs: intensity        0..1+  overall energy / glow
          hue-shift        -1..1  rotates the neon ramp (weather mood)
          flow             0..3   disc rotation speed multiplier
          storm            0..1   ambient core vortex strength
   All four smooth toward their targets, so callers can set them
   every frame (e.g. the WEATHER module needle) without popping.
   ============================================================ */
(function () {
  'use strict';
  if (window.__galaxyClusterDefined) return;
  window.__galaxyClusterDefined = true;

  /* ---------- GPU: particle physics (transform feedback) ---------- */

  var VS_UPDATE = [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec4 aPosVel;',   /* xy pos · zw vel  (world: y∈[-1,1], x∈[-a,a]) */
    'layout(location=1) in vec4 aHomeCtr;',  /* xy home/start · zw galaxy-center/stream-end */
    'layout(location=2) in vec4 aMeta;',     /* hue · size · phase · type(0 disc,1 wordmark,2 stream) */
    'out vec4 vPosVel;',
    'uniform float uDt;',
    'uniform float uTime;',
    'uniform float uIntensity;',
    'uniform vec2 uMouse;',
    'uniform vec2 uMouseVel;',
    'uniform float uHover;',
    'uniform float uVortex;',
    'uniform vec2 uShock;',
    'uniform float uShockT;',
    'uniform float uShockAmp;',
    'uniform float uFlow;',
    'uniform float uStorm;',
    'void main(){',
    '  vec2 pos = aPosVel.xy, vel = aPosVel.zw;',
    '  float ph = aMeta.z, type = aMeta.w;',
    '  float dt = clamp(uDt, 0.001, 0.033);',
    '  vec2 home; float spring; float damp;',
    '  if (type > 1.5) {',
    '    /* energy stream: matter flows core → satellite along a bent path */',
    '    float s = fract(ph + uTime * (0.05 + 0.06 * fract(ph * 7.31)));',
    '    vec2 a = aHomeCtr.xy, b = aHomeCtr.zw;',
    '    vec2 ab = b - a;',
    '    vec2 perp = vec2(-ab.y, ab.x) / (length(ab) + 1e-5);',
    '    float bend = (fract(ph * 13.7) - 0.5) * 0.7;',
    '    home = mix(a, b, s) + perp * (sin(s * 3.14159) * bend + 0.014 * sin(uTime * 1.4 + ph * 43.0));',
    '    spring = 9.0; damp = 3.2;',
    '  } else if (type > 0.5) {',
    '    /* wordmark constellation: tight spring + shimmer */',
    '    home = aHomeCtr.xy + 0.0055 * vec2(sin(uTime * 1.8 + ph * 37.0), cos(uTime * 1.3 + ph * 21.0));',
    '    spring = 55.0; damp = 5.2;',
    '  } else {',
    '    /* galaxy disc: home orbits its center, differential rotation winds the arms */',
    '    vec2 c = aHomeCtr.zw;',
    '    vec2 rel = aHomeCtr.xy - c;',
    '    float r = length(rel) + 1e-4;',
    '    float ang = mod((0.16 + 0.42 / (r + 0.16)) * uTime * (0.4 + 0.6 * uIntensity) * uFlow, 6.2831853);',
    '    float cs = cos(ang), sn = sin(ang);',
    '    home = c + mat2(cs, sn, -sn, cs) * rel;',
    '    spring = 2.2; damp = 1.6;',
    '  }',
    '  vec2 acc = (home - pos) * spring;',
    '  /* magnetic cursor gravity */',
    '  vec2 md = uMouse - pos;',
    '  float mr = length(md) + 1e-4;',
    '  vec2 mdir = md / mr;',
    '  acc += mdir * uHover * 38.0 * exp(-mr * 2.6);',
    '  /* hold = spiral vortex: spin + suck */',
    '  float vfall = exp(-mr * 1.5) * uVortex;',
    '  acc += (vec2(-mdir.y, mdir.x) * 210.0 + mdir * 70.0) * vfall;',
    '  /* ambient storm: weather-driven vortex around the core */',
    '  if (uStorm > 0.001) {',
    '    float cr = length(pos) + 1e-4;',
    '    vec2 cdir = pos / cr;',
    '    float sfall = exp(-cr * 1.1) * uStorm;',
    '    acc += (vec2(-cdir.y, cdir.x) * 95.0 - cdir * 18.0) * sfall;',
    '  }',
    '  /* click = expanding shockwave ring; wordmark particles are nearly immune */',
    '  vec2 sd = pos - uShock;',
    '  float sr = length(sd) + 1e-4;',
    '  float ring = exp(-pow((sr - uShockT * 2.4) * 7.0, 2.0)) * exp(-uShockT * 2.6) * uShockAmp;',
    '  float shockMult = (type > 0.5 && type < 1.5) ? 0.05 : 1.0;',
    '  acc += (sd / sr) * ring * 100.0 * shockMult;',
    '  vel += acc * dt;',
    '  /* flick / throw momentum from cursor velocity */',
    '  vel += uMouseVel * exp(-mr * 8.0) * (dt * 60.0) * 0.09;',
    '  vel *= exp(-damp * dt);',
    '  float spd = length(vel);',
    '  if (spd > 6.0) vel *= 6.0 / spd;',
    '  pos += vel * dt;',
    '  vPosVel = vec4(pos, vel);',
    '}'
  ].join('\n');

  var FS_UPDATE = [
    '#version 300 es',
    'precision mediump float;',
    'void main(){}'
  ].join('\n');

  var VS_RENDER = [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec4 aPosVel;',
    'layout(location=1) in vec4 aMeta;',
    'uniform float uAspect;',
    'uniform float uPx;',
    'uniform float uTime;',
    'uniform float uIntensity;',
    'uniform float uHueShift;',
    'out vec3 vColor;',
    'out float vGlow;',
    /* the four site neons, blended on a loop: cyan→magenta→purple→green→cyan */
    'vec3 neon(float h){',
    '  h = fract(h) * 4.0;',
    '  vec3 c0 = vec3(0.0, 0.94, 1.0);',
    '  vec3 c1 = vec3(1.0, 0.176, 0.584);',
    '  vec3 c2 = vec3(0.482, 0.176, 1.0);',
    '  vec3 c3 = vec3(0.0, 1.0, 0.616);',
    '  if (h < 1.0) return mix(c0, c1, h);',
    '  if (h < 2.0) return mix(c1, c2, h - 1.0);',
    '  if (h < 3.0) return mix(c2, c3, h - 2.0);',
    '  return mix(c3, c0, h - 3.0);',
    '}',
    'void main(){',
    '  vec2 pos = aPosVel.xy;',
    '  float spd = length(aPosVel.zw);',
    '  gl_Position = vec4(pos.x / uAspect, pos.y, 0.0, 1.0);',
    '  float tw = 0.75 + 0.45 * sin(uTime * (2.0 + fract(aMeta.z * 9.0) * 3.0) + aMeta.z * 80.0);',
    '  vGlow = (1.0 + min(spd * 1.1, 2.6)) * tw * (0.75 + 0.5 * uIntensity) * (aMeta.w > 0.5 && aMeta.w < 1.5 ? 1.3 : 1.0);',
    '  vColor = neon(aMeta.x + uHueShift);',
    '  gl_PointSize = aMeta.y * uPx * (1.0 + min(spd * 0.5, 1.2));',
    '}'
  ].join('\n');

  var FS_RENDER = [
    '#version 300 es',
    'precision mediump float;',
    'in vec3 vColor;',
    'in float vGlow;',
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 q = gl_PointCoord * 2.0 - 1.0;',
    '  float d2 = dot(q, q);',
    '  if (d2 > 1.0) discard;',
    '  float core = exp(-d2 * 7.0);',
    '  float halo = exp(-d2 * 2.0) * 0.3;',
    '  fragColor = vec4(vColor * (core + halo) * vGlow * 0.55, 1.0);',
    '}'
  ].join('\n');

  var VS_BG = [
    '#version 300 es',
    'layout(location=0) in vec2 aPos;',
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FS_BG = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform float uCharge;',
    'uniform float uIntensity;',
    'out vec4 fragColor;',
    'float hash(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0, amp = 0.5;',
    '  for (int i = 0; i < 4; i++){ v += amp * noise(p); p = p * 2.03 + 11.7; amp *= 0.5; }',
    '  return v;',
    '}',
    'void main(){',
    '  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;',
    '  float r = length(uv);',
    '  vec3 col = vec3(0.004, 0.0, 0.016);',
    '  float n = fbm(uv * 1.6 + vec2(uTime * 0.015, -uTime * 0.01));',
    '  float n2 = fbm(uv * 3.1 - vec2(uTime * 0.02, 0.0) + n);',
    '  col += vec3(0.055, 0.0, 0.11) * smoothstep(0.35, 0.95, n) * 1.1;',
    '  col += vec3(0.0, 0.05, 0.075) * smoothstep(0.5, 0.97, n2);',
    '  col += vec3(0.09, 0.015, 0.15) * exp(-r * 1.5) * 0.8;',
    '  /* pinprick starfield */',
    '  vec2 cell = floor(uv * 110.0);',
    '  float h = hash(cell);',
    '  if (h > 0.9965){',
    '    vec2 f = fract(uv * 110.0) - 0.5;',
    '    col += vec3(0.6, 0.8, 1.0) * exp(-dot(f, f) * 38.0) * (0.25 + 0.55 * (0.5 + 0.5 * sin(uTime * 2.4 + h * 911.0)));',
    '  }',
    '  /* black hole + charging accretion rim */',
    '  col *= smoothstep(0.045, 0.26, r);',
    '  vec3 rim = mix(vec3(0.0, 0.94, 1.0), vec3(1.0, 0.176, 0.584), uCharge);',
    '  col += rim * exp(-abs(r - 0.27) * 26.0) * (0.16 + 0.85 * uCharge) * (0.7 + 0.3 * sin(uTime * 3.1)) * uIntensity;',
    '  col *= 1.0 - 0.45 * pow(min(r * 0.55, 1.2), 2.0);',
    '  fragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compileShader(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[galaxy-cluster] shader: ' + gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  function makeProgram(gl, vsSrc, fsSrc, tfVaryings) {
    var vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    if (tfVaryings) gl.transformFeedbackVaryings(p, tfVaryings, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[galaxy-cluster] link: ' + gl.getProgramInfoLog(p));
      return null;
    }
    var u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { prog: p, u: u };
  }

  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5); }

  /* same neon ramp as the GPU shader, in 0–255 ints */
  function neonRGB(h) {
    if (!isFinite(h)) h = 0;
    h = ((h % 1) + 1) % 1 * 4;
    h = Math.min(h, 3.99999);
    var stops = [[0, 240, 255], [255, 45, 149], [123, 45, 255], [0, 255, 157], [0, 240, 255]];
    var i = Math.floor(h), f = h - i;
    var a = stops[i], b = stops[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f)
    ];
  }

  class GalaxyCluster extends HTMLElement {
    static get observedAttributes() { return ['intensity', 'hue-shift', 'flow', 'storm', 'paused']; }

    constructor() {
      super();
      this._intensity = 1; this._tintensity = 1;
      this._hueShift = 0; this._thueShift = 0;
      this._flow = 1; this._tflow = 1;
      this._storm = 0; this._tstorm = 0;
    }

    attributeChangedCallback(name, _o, v) {
      if (name === 'paused') {
        /* hard stop: no physics, no draws, no GPU submits while paused */
        this._paused = v !== null && v !== 'false';
        if (!this._paused) this._last = performance.now();
        return;
      }
      var f = parseFloat(v);
      if (isNaN(f)) return;
      if (name === 'intensity') this._tintensity = f;
      else if (name === 'hue-shift') this._thueShift = Math.max(-1, Math.min(1, f));
      else if (name === 'flow') this._tflow = Math.max(0, Math.min(3, f));
      else if (name === 'storm') this._tstorm = Math.max(0, Math.min(1, f));
    }

    connectedCallback() {
      if (this._init) return;
      this._init = true;
      var self = this;
      if (!this.style.position) this.style.position = 'fixed';
      /* a positioned host with no box collapses to 0×0 and the canvas
         becomes invisible — always claim the full viewport/mount */
      if (!this.style.width && !this.style.inset) this.style.inset = '0';
      this.style.touchAction = 'none';
      this.style.cursor = 'crosshair';
      this.style.background = '#020008';

      var f0 = parseFloat(this.getAttribute('intensity'));
      if (!isNaN(f0)) { this._tintensity = f0; this._intensity = f0; }
      var h0 = parseFloat(this.getAttribute('hue-shift'));
      if (!isNaN(h0)) { this._thueShift = h0; this._hueShift = h0; }
      var fl0 = parseFloat(this.getAttribute('flow'));
      if (!isNaN(fl0)) { this._tflow = fl0; this._flow = fl0; }
      var s0 = parseFloat(this.getAttribute('storm'));
      if (!isNaN(s0)) { this._tstorm = s0; this._storm = s0; }

      var c = this._c = document.createElement('canvas');
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
      this.appendChild(c);

      /* always-visible wordmark overlay — sits above the canvas so it shows
         regardless of particle positions; particles orbit and interact around it */
      var ov = this._overlay = document.createElement('div');
      ov.style.cssText = [
        'position:absolute', 'inset:0', 'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center', 'pointer-events:none',
        'z-index:1', 'user-select:none', 'text-align:center', 'padding:0 1rem'
      ].join(';');
      var wm = document.createElement('div');
      wm.textContent = '@danfrank';
      wm.style.cssText = [
        'font-family:"Unbounded",sans-serif', 'font-weight:900',
        'font-size:clamp(2.2rem,7vw,6rem)', 'letter-spacing:-0.01em',
        'color:rgba(79,195,232,0.28)',
        'text-shadow:0 0 18px rgba(79,195,232,0.22),0 0 40px rgba(79,195,232,0.12)',
        'line-height:1'
      ].join(';');
      var sub = document.createElement('div');
      sub.textContent = 'U N I Q U E  ·  A I  ·  S O L U T I O N S';
      sub.style.cssText = [
        'font-family:"IBM Plex Mono",monospace', 'font-weight:500',
        'font-size:clamp(0.45rem,1.1vw,0.85rem)', 'letter-spacing:0.18em',
        'color:rgba(79,195,232,0.16)',
        'text-shadow:0 0 10px rgba(79,195,232,0.10)',
        'margin-top:0.55em'
      ].join(';');
      ov.appendChild(wm);
      ov.appendChild(sub);
      this.appendChild(ov);

      /* interaction state */
      this._mx = 99; this._my = 99;       /* world-space cursor (parked far away) */
      this._mvx = 0; this._mvy = 0;       /* cursor velocity (world/s) */
      this._hover = 0; this._hoverT = 0;
      this._down = false; this._downT = 0; this._vortex = 0;
      this._sx = 0; this._sy = 0; this._sT = -100; this._sAmp = 0;
      this._charge = 0;
      this._lastInteract = 0; this._lastAuto = 0;
      this._lastMove = 0;
      this._t0 = performance.now();
      this._last = this._t0;

      /* primary path: WebGL2. fallback: Canvas2D with the same physics. */
      var gl = this._gl = c.getContext('webgl2', { alpha: false, depth: false, stencil: false, antialias: false });
      if (gl) {
        this._prog = {
          update: makeProgram(gl, VS_UPDATE, FS_UPDATE, ['vPosVel']),
          render: makeProgram(gl, VS_RENDER, FS_RENDER),
          bg: makeProgram(gl, VS_BG, FS_BG)
        };
        if (!this._prog.update || !this._prog.render || !this._prog.bg) this._gl = gl = null;
      }
      if (gl) {
        this._vaoBg = gl.createVertexArray();
        gl.bindVertexArray(this._vaoBg);
        var quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        this._tf = gl.createTransformFeedback();
      } else {
        console.warn('[galaxy-cluster] WebGL2 unavailable — using Canvas2D fallback');
        this._2d = c.getContext('2d');
        if (!this._2d) {
          /* no canvas at all — only now do we surrender */
          document.dispatchEvent(new CustomEvent('void:fluid-failed'));
          this.style.background = 'radial-gradient(circle at 50% 45%, #1a0030 0%, #020008 70%)';
          return;
        }
      }

      this._sizeAll();
      this._buildParticles(false);
      this._buildWordmarkWhenReady();

      this._onDown = function (e) { self._pdown(e); };
      this._onMove = function (e) { self._pmove(e); };
      this._onUp = function () { self._down = false; };
      this._onOut = function (e) { if (!e.relatedTarget) { self._hoverT = 0; self._down = false; } };
      c.addEventListener('pointerdown', this._onDown);
      window.addEventListener('pointermove', this._onMove);
      window.addEventListener('pointerup', this._onUp);
      window.addEventListener('pointercancel', this._onUp);
      window.addEventListener('pointerout', this._onOut);
      window.addEventListener('resize', this._onResize = function () {
        clearTimeout(self._rt);
        self._rt = setTimeout(function () {
          self._sizeAll();
          self._buildParticles(true);
          self._buildWordmark();
        }, 280);
      });

      this._paused = this.hasAttribute('paused') && this.getAttribute('paused') !== 'false';
      var loop = function (t) {
        self._raf = requestAnimationFrame(loop);
        if (!document.hidden && !self._paused) self._frame(t);
      };
      this._raf = requestAnimationFrame(loop);
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      clearTimeout(this._rt);
      if (this._c) this._c.removeEventListener('pointerdown', this._onDown);
      window.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('pointerup', this._onUp);
      window.removeEventListener('pointercancel', this._onUp);
      window.removeEventListener('pointerout', this._onOut);
      window.removeEventListener('resize', this._onResize);
      this._init = false;
    }

    /* ---------- sizing ---------- */

    _sizeAll() {
      var w = this.clientWidth || window.innerWidth;
      var h = this.clientHeight || window.innerHeight;
      var dpr = this._gl ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
      this._c.width = Math.max(2, Math.round(w * dpr));
      this._c.height = Math.max(2, Math.round(h * dpr));
      this._aspect = w / h;
      this._px = this._c.height / 1000;
    }

    /* ---------- particle population ----------
       world coords: y ∈ [-1,1], x ∈ [-aspect, aspect], origin = core */

    _buildParticles(preserve) {
      var gl = this._gl;
      var A = this._aspect;
      var w = this._c.width, h = this._c.height;
      var N = this._N = gl
        ? Math.max(10000, Math.min(32000, Math.round((w * h) / 68)))
        : Math.max(2500, Math.min(5000, Math.round((w * h) / 180)));

      var st = this._st = new Float32Array(N * 8);   /* home.xy, ctr.xy, hue, size, phase, type */
      var pv = new Float32Array(N * 4);              /* pos.xy, vel.xy */
      var i, o, u, r, th;

      var textCount = this._textCount = Math.floor(N * 0.18);
      var discCount = Math.floor(N * 0.44);
      var satCount = Math.floor(N * 0.24);
      var streamCount = N - textCount - discCount - satCount;
      var idx = 0;

      /* 1 — wordmark slots (placeholder halo ring until the font renders) */
      for (i = 0; i < textCount; i++, idx++) {
        th = Math.random() * 6.2831853;
        r = 0.3 + Math.random() * 0.05;
        o = idx * 8;
        st[o] = Math.cos(th) * r; st[o + 1] = Math.sin(th) * r;
        st[o + 2] = 0; st[o + 3] = 0;
        st[o + 4] = Math.random();
        st[o + 5] = 1.6 + Math.random() * 1.6;
        st[o + 6] = Math.random();
        st[o + 7] = 1;
      }

      /* 2 — central spiral disc (3 arms + haze, hot core → cool rim) */
      var ARMS = 3, WIND = 2.6;
      var Rmax = Math.min(A, 1.5) * 0.95;
      for (i = 0; i < discCount; i++, idx++) {
        u = Math.random();
        r = 0.36 + Math.pow(u, 1.5) * Rmax;
        th = Math.floor(Math.random() * ARMS) * (6.2831853 / ARMS) + r * WIND + gauss() * (0.5 / (1 + r * 1.2));
        if (Math.random() < 0.24) th = Math.random() * 6.2831853;  /* halo haze */
        o = idx * 8;
        st[o] = Math.cos(th) * r;
        st[o + 1] = Math.sin(th) * r * 0.86;
        st[o + 2] = 0; st[o + 3] = 0;
        var hue = 0.5 - (r / (0.36 + Rmax)) * 0.42 + gauss() * 0.04;
        if (Math.random() < 0.03) hue = 0.75;  /* green sparks */
        st[o + 4] = ((hue % 1) + 1) % 1;
        st[o + 5] = (Math.random() < 0.04) ? 4.5 + Math.random() * 2.5 : 1.3 + Math.random() * 1.9;
        st[o + 6] = Math.random();
        st[o + 7] = 0;
      }

      /* 3 — satellite galaxies */
      var sats = this._sats = [
        { x: -0.66 * A, y: 0.54, R: 0.30, hue: 0.92 },
        { x: 0.70 * A, y: -0.50, R: 0.34, hue: 0.25 },
        { x: -0.56 * A, y: -0.62, R: 0.24, hue: 0.70 }
      ];
      var per = Math.floor(satCount / sats.length);
      for (var s = 0; s < sats.length; s++) {
        var sat = sats[s];
        var n = (s === sats.length - 1) ? (satCount - per * (sats.length - 1)) : per;
        for (i = 0; i < n; i++, idx++) {
          u = Math.random();
          r = Math.pow(u, 1.4) * sat.R + 0.015;
          th = Math.floor(Math.random() * 2) * 3.14159 + r * 5.2 + gauss() * (0.4 / (1 + r * 6));
          if (Math.random() < 0.3) th = Math.random() * 6.2831853;
          o = idx * 8;
          st[o] = sat.x + Math.cos(th) * r;
          st[o + 1] = sat.y + Math.sin(th) * r;
          st[o + 2] = sat.x; st[o + 3] = sat.y;
          st[o + 4] = ((sat.hue + gauss() * 0.05) % 1 + 1) % 1;
          st[o + 5] = 1.2 + Math.random() * 1.7;
          st[o + 6] = Math.random();
          st[o + 7] = 0;
        }
      }

      /* 4 — energy streams: core → each satellite */
      for (i = 0; i < streamCount; i++, idx++) {
        var sat2 = sats[i % sats.length];
        var len = Math.sqrt(sat2.x * sat2.x + sat2.y * sat2.y) + 1e-4;
        var dx = sat2.x / len, dy = sat2.y / len;
        o = idx * 8;
        st[o] = dx * 0.34; st[o + 1] = dy * 0.34;
        st[o + 2] = sat2.x - dx * sat2.R * 0.5;
        st[o + 3] = sat2.y - dy * sat2.R * 0.5;
        st[o + 4] = ((sat2.hue + 0.5 + gauss() * 0.06) % 1 + 1) % 1;
        st[o + 5] = 1.0 + Math.random() * 1.4;
        st[o + 6] = Math.random();
        st[o + 7] = 2;
      }

      /* initial state: big-bang scatter on first build, settle-in-place on rebuild */
      for (i = 0; i < N; i++) {
        o = i * 4;
        if (preserve) {
          pv[o] = st[i * 8] + gauss() * 0.02;
          pv[o + 1] = st[i * 8 + 1] + gauss() * 0.02;
          pv[o + 2] = 0; pv[o + 3] = 0;
        } else {
          pv[o] = (Math.random() * 2 - 1) * A * 1.25;
          pv[o + 1] = (Math.random() * 2 - 1) * 1.25;
          pv[o + 2] = gauss() * 0.6;
          pv[o + 3] = gauss() * 0.6;
        }
      }

      if (gl) {
        this._buildGPUBuffers(st, pv);
      } else {
        this._pos = pv;            /* CPU path mutates pv in place */
        this._buildCPUColors();
        this._buildCPUBackdrop();
      }
    }

    _buildGPUBuffers(st, pv) {
      var gl = this._gl, i;
      if (this._pvBuf) { gl.deleteBuffer(this._pvBuf[0]); gl.deleteBuffer(this._pvBuf[1]); gl.deleteBuffer(this._stBuf); }
      if (this._vaoU) {
        gl.deleteVertexArray(this._vaoU[0]); gl.deleteVertexArray(this._vaoU[1]);
        gl.deleteVertexArray(this._vaoR[0]); gl.deleteVertexArray(this._vaoR[1]);
      }
      var stBuf = this._stBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, stBuf);
      gl.bufferData(gl.ARRAY_BUFFER, st, gl.STATIC_DRAW);
      this._pvBuf = [gl.createBuffer(), gl.createBuffer()];
      for (i = 0; i < 2; i++) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this._pvBuf[i]);
        gl.bufferData(gl.ARRAY_BUFFER, pv, gl.DYNAMIC_COPY);
      }
      this._vaoU = []; this._vaoR = [];
      for (i = 0; i < 2; i++) {
        var vu = gl.createVertexArray();
        gl.bindVertexArray(vu);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._pvBuf[i]);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, stBuf);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
        this._vaoU.push(vu);

        var vr = gl.createVertexArray();
        gl.bindVertexArray(vr);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._pvBuf[i]);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, stBuf);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
        this._vaoR.push(vr);
      }
      gl.bindVertexArray(null);
      this._cur = 0;
    }

    /* CPU path: precomputed fill styles (two layers: wide glow + hot core) */
    _buildCPUColors() {
      var N = this._N, st = this._st;
      var hs = this._hueShift || 0;
      this._colHue = hs;
      var glow = this._colGlow = new Array(N);
      var core = this._colCore = new Array(N);
      for (var i = 0; i < N; i++) {
        var c = neonRGB(st[i * 8 + 4] + hs);
        glow[i] = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.22)';
        core[i] = 'rgba(' + Math.min(255, c[0] + 130) + ',' + Math.min(255, c[1] + 130) + ',' + Math.min(255, c[2] + 130) + ',0.95)';
      }
    }

    /* CPU path: static nebula + starfield painted once, blitted each frame */
    _buildCPUBackdrop() {
      var w = this._c.width, h = this._c.height;
      var o = document.createElement('canvas');
      o.width = w; o.height = h;
      var x = o.getContext('2d');
      x.fillStyle = '#020008';
      x.fillRect(0, 0, w, h);
      var g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, 'rgba(34,6,58,0.9)');
      g.addColorStop(0.4, 'rgba(16,3,34,0.6)');
      g.addColorStop(1, 'rgba(2,0,8,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      var blobs = [
        [0.22, 0.3, 0.3, 'rgba(0,55,70,0.30)'],
        [0.78, 0.68, 0.34, 'rgba(60,12,110,0.32)'],
        [0.6, 0.18, 0.22, 'rgba(90,8,60,0.22)']
      ];
      for (var b = 0; b < blobs.length; b++) {
        var bb = blobs[b];
        var gg = x.createRadialGradient(w * bb[0], h * bb[1], 0, w * bb[0], h * bb[1], Math.max(w, h) * bb[2]);
        gg.addColorStop(0, bb[3]);
        gg.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = gg;
        x.fillRect(0, 0, w, h);
      }
      for (var i = 0; i < 220; i++) {
        var sxp = Math.random() * w, syp = Math.random() * h;
        x.fillStyle = 'rgba(' + (150 + Math.floor(Math.random() * 105)) + ',' +
          (190 + Math.floor(Math.random() * 65)) + ',255,' + (0.15 + Math.random() * 0.5) + ')';
        x.fillRect(sxp, syp, Math.random() < 0.12 ? 2 : 1, Math.random() < 0.12 ? 2 : 1);
      }
      this._backdrop = o;
    }

    /* ---------- wordmark constellation ---------- */

    _buildWordmarkWhenReady() {
      var self = this;
      this._buildWordmark();
      if (document.fonts && document.fonts.load) {
        document.fonts.load('900 100px Unbounded').then(function () { self._buildWordmark(); }).catch(function () {});
      }
    }

    _buildWordmark() {
      if (!this._st) return;
      var w = 1200, h = 520;
      var o = document.createElement('canvas');
      o.width = w; o.height = h;
      var x = o.getContext('2d', { willReadFrequently: true });
      x.clearRect(0, 0, w, h);
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      var fs = w * 0.15;
      x.font = '900 ' + fs + 'px Unbounded, sans-serif';
      var tw = x.measureText('@danfrank').width;
      if (tw > w * 0.92) fs *= (w * 0.92) / tw;
      x.font = '900 ' + fs + 'px Unbounded, sans-serif';
      x.fillStyle = '#fff';
      x.fillText('@danfrank', w / 2, h / 2 - fs * 0.16);
      x.font = '700 ' + (fs * 0.19) + 'px "IBM Plex Mono", monospace';
      x.fillText('U N I Q U E   ·   A I   ·   S O L U T I O N S', w / 2, h / 2 + fs * 0.62);

      var data;
      try { data = x.getImageData(0, 0, w, h).data; } catch (e) { return; }
      var raw = [];
      for (var py = 0; py < h; py += 3) {
        for (var px = 0; px < w; px += 3) {
          if (data[(py * w + px) * 4 + 3] > 128) raw.push(px, py);
        }
      }
      var n = raw.length / 2;
      if (!n) return;

      var worldW = Math.min(this._aspect * 2 * 0.8, 2.7);
      var scale = worldW / w;
      var st = this._st;
      for (var i = 0; i < this._textCount; i++) {
        var pick = (i < n) ? i : Math.floor(Math.random() * n);
        var sx = raw[pick * 2], sy = raw[pick * 2 + 1];
        var off = i * 8;
        st[off] = (sx - w / 2) * scale + gauss() * 0.0015;
        st[off + 1] = -(sy - h / 2) * scale + gauss() * 0.0015;
        /* neon ramp swept left → right across the word */
        st[off + 4] = ((sx / w) * 0.92 + gauss() * 0.015 + 1) % 1;
      }
      if (this._gl && this._stBuf) {
        var gl = this._gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this._stBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, st.subarray(0, this._textCount * 8));
      } else if (this._colGlow) {
        for (var j = 0; j < this._textCount; j++) {
          var c = neonRGB(st[j * 8 + 4] + (this._hueShift || 0));
          this._colGlow[j] = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.26)';
          this._colCore[j] = 'rgba(' + Math.min(255, c[0] + 130) + ',' + Math.min(255, c[1] + 130) + ',' + Math.min(255, c[2] + 130) + ',1)';
        }
      }
    }

    /* ---------- input ---------- */

    _world(e) {
      var b = this._c.getBoundingClientRect();
      var bw = b.width || window.innerWidth || 1;
      var bh = b.height || window.innerHeight || 1;
      var x = ((e.clientX - b.left) / bw * 2 - 1) * this._aspect;
      var y = -((e.clientY - b.top) / bh * 2 - 1);
      /* a hidden / zero-size layout must never poison the sim with NaN */
      if (!isFinite(x) || !isFinite(y)) { x = 99; y = 99; }
      return { x: x, y: y };
    }

    _pdown(e) {
      var p = this._world(e);
      this._down = true;
      this._downT = performance.now();
      this._mx = p.x; this._my = p.y;
      this._hoverT = 1;
      this._lastInteract = performance.now();
      this._shock(p.x, p.y, 0.22);
      this._addCharge(p, 0.03);
    }

    _pmove(e) {
      var p = this._world(e);
      var now = performance.now();
      var dts = Math.max((now - this._lastMove) / 1000, 0.008);
      this._lastMove = now;
      var dx = p.x - this._mx, dy = p.y - this._my;
      this._mx = p.x; this._my = p.y;
      this._hoverT = 1;
      var speed = Math.sqrt(dx * dx + dy * dy);
      if (speed < 0.0001) return;
      this._lastInteract = now;
      var k = this._down ? 1 : 0.45;
      this._mvx = Math.max(-9, Math.min(9, dx / dts)) * k;
      this._mvy = Math.max(-9, Math.min(9, dy / dts)) * k;
      /* stirring matter near the core feeds the breach */
      this._addCharge(p, Math.min(speed, 0.08) * (this._down ? 0.32 : 0.13));
    }

    _shock(x, y, amp) {
      this._sx = x; this._sy = y;
      this._sT = (performance.now() - this._t0) / 1000;
      this._sAmp = amp;
    }

    _addCharge(p, amt) {
      if (!isFinite(amt) || !isFinite(p.x) || !isFinite(p.y)) return;
      if (Math.sqrt(p.x * p.x + p.y * p.y) > 0.55) return;
      if (this._charge >= 1) return;
      this._charge = Math.min(1, this._charge + amt);
      document.dispatchEvent(new CustomEvent('void:charge', { detail: { level: this._charge } }));
    }

    /* ---------- frame ---------- */

    _frame(tms) {
      var dt = Math.min((tms - this._last) / 1000, 0.033) || 0.016;
      this._last = tms;
      var t = (tms - this._t0) / 1000;

      /* smoothed state */
      this._intensity += (this._tintensity - this._intensity) * 0.03;
      this._hueShift += (this._thueShift - this._hueShift) * 0.03;
      this._flow += (this._tflow - this._flow) * 0.03;
      this._storm += (this._tstorm - this._storm) * 0.04;
      this._hover += (this._hoverT - this._hover) * 0.08;
      var vTarget = (this._down && (performance.now() - this._downT > 230)) ? 1 : 0;
      this._vortex += (vTarget - this._vortex) * Math.min(1, dt * 7);
      var decay = Math.exp(-7 * dt);
      this._mvx *= decay; this._mvy *= decay;

      /* spinning the vortex over the core also feeds it */
      if (this._vortex > 0.4) this._addCharge({ x: this._mx, y: this._my }, 0.004);

      /* ambient life when idle */
      if (tms - this._lastInteract > 4000 && tms - this._lastAuto > 5000) {
        this._lastAuto = tms;
        this._shock((Math.random() * 2 - 1) * this._aspect * 0.8, (Math.random() * 2 - 1) * 0.8, 0.25);
      }

      if (this._gl) this._frameGPU(t, dt);
      else this._frameCPU(t, dt);
    }

    _frameGPU(t, dt) {
      var gl = this._gl;
      var shockT = Math.min(t - this._sT, 50);

      /* 1 — physics (transform feedback ping-pong) */
      var P = this._prog.update;
      gl.useProgram(P.prog);
      gl.uniform1f(P.u.uDt, dt);
      gl.uniform1f(P.u.uTime, t);
      gl.uniform1f(P.u.uIntensity, this._intensity);
      gl.uniform2f(P.u.uMouse, this._mx, this._my);
      gl.uniform2f(P.u.uMouseVel, this._mvx, this._mvy);
      gl.uniform1f(P.u.uHover, this._hover);
      gl.uniform1f(P.u.uVortex, this._vortex);
      gl.uniform2f(P.u.uShock, this._sx, this._sy);
      gl.uniform1f(P.u.uShockT, shockT);
      gl.uniform1f(P.u.uShockAmp, this._sAmp);
      gl.uniform1f(P.u.uFlow, this._flow);
      gl.uniform1f(P.u.uStorm, this._storm);
      gl.bindVertexArray(this._vaoU[this._cur]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this._tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this._pvBuf[1 - this._cur]);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, this._N);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      this._cur = 1 - this._cur;

      /* 2 — nebula backdrop */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this._c.width, this._c.height);
      gl.disable(gl.BLEND);
      P = this._prog.bg;
      gl.useProgram(P.prog);
      gl.uniform2f(P.u.uRes, this._c.width, this._c.height);
      gl.uniform1f(P.u.uTime, t);
      gl.uniform1f(P.u.uCharge, this._charge);
      gl.uniform1f(P.u.uIntensity, this._intensity);
      gl.bindVertexArray(this._vaoBg);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      /* 3 — particles, additive */
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      P = this._prog.render;
      gl.useProgram(P.prog);
      gl.uniform1f(P.u.uAspect, this._aspect);
      gl.uniform1f(P.u.uPx, this._px);
      gl.uniform1f(P.u.uTime, t);
      gl.uniform1f(P.u.uIntensity, this._intensity);
      gl.uniform1f(P.u.uHueShift, this._hueShift);
      gl.bindVertexArray(this._vaoR[this._cur]);
      gl.drawArrays(gl.POINTS, 0, this._N);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    /* Canvas2D fallback — identical force model, fewer particles */
    _frameCPU(t, dt) {
      var ctx = this._2d, c = this._c;
      var w = c.width, h = c.height;
      var N = this._N, st = this._st, pv = this._pos;
      var A = this._aspect;
      var sxw = w / (2 * A), syw = h / 2;   /* world → px scale */

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this._backdrop, 0, 0);

      /* black hole + charging accretion rim */
      var cx = w / 2, cy = h / 2;
      var rimR = 0.27 * syw;
      var hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, rimR * 1.25);
      hole.addColorStop(0, 'rgba(2,0,8,1)');
      hole.addColorStop(0.72, 'rgba(2,0,8,0.85)');
      hole.addColorStop(1, 'rgba(2,0,8,0)');
      ctx.fillStyle = hole;
      ctx.fillRect(cx - rimR * 1.3, cy - rimR * 1.3, rimR * 2.6, rimR * 2.6);
      var q = this._charge;
      var rim = neonRGB(q * 0.25);  /* cyan → magenta as it charges */
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(' + rim[0] + ',' + rim[1] + ',' + rim[2] + ',' + (0.12 + 0.5 * q) + ')';
      ctx.lineWidth = 2 + 6 * q;
      ctx.beginPath();
      ctx.arc(cx, cy, rimR, 0, 6.2831853);
      ctx.stroke();

      /* physics + draw */
      var mx = this._mx, my = this._my;
      var mvx = this._mvx, mvy = this._mvy;
      var hover = this._hover, vortex = this._vortex;
      var shockT = Math.min(t - this._sT, 50);
      var shockEnv = Math.exp(-shockT * 2.6) * this._sAmp;
      var sx = this._sx, sy = this._sy;
      /* hue-shift on CPU = palette rebuild; quantized so it only happens on real mood changes */
      if (Math.abs(this._hueShift - (this._colHue || 0)) > 0.02) this._buildCPUColors();
      var dampDisc = Math.exp(-1.6 * dt), dampText = Math.exp(-5.2 * dt), dampStream = Math.exp(-3.2 * dt);
      var flickK = Math.exp(0) * (dt * 60) * 0.09;
      var I = this._intensity;
      var glowCols = this._colGlow, coreCols = this._colCore;

      for (var i = 0; i < N; i++) {
        var o8 = i * 8, o4 = i * 4;
        var px = pv[o4], py = pv[o4 + 1], vx = pv[o4 + 2], vy = pv[o4 + 3];
        var ph = st[o8 + 6], type = st[o8 + 7];
        var hx, hy, spring, damp;

        if (type > 1.5) {
          var s = (ph + t * (0.05 + 0.06 * ((ph * 7.31) % 1))) % 1;
          var ax = st[o8], ay = st[o8 + 1], bx = st[o8 + 2], by = st[o8 + 3];
          var abx = bx - ax, aby = by - ay;
          var abl = Math.sqrt(abx * abx + aby * aby) + 1e-5;
          var bend = (((ph * 13.7) % 1) - 0.5) * 0.7;
          var wob = Math.sin(s * 3.14159) * bend + 0.014 * Math.sin(t * 1.4 + ph * 43);
          hx = ax + abx * s + (-aby / abl) * wob;
          hy = ay + aby * s + (abx / abl) * wob;
          spring = 9; damp = dampStream;
        } else if (type > 0.5) {
          hx = st[o8] + 0.0055 * Math.sin(t * 1.8 + ph * 37);
          hy = st[o8 + 1] + 0.0055 * Math.cos(t * 1.3 + ph * 21);
          spring = 55; damp = dampText;
        } else {
          var gcx = st[o8 + 2], gcy = st[o8 + 3];
          var relx = st[o8] - gcx, rely = st[o8 + 1] - gcy;
          var rr = Math.sqrt(relx * relx + rely * rely) + 1e-4;
          var ang = (0.16 + 0.42 / (rr + 0.16)) * t * (0.4 + 0.6 * I) * this._flow;
          var cs = Math.cos(ang), sn = Math.sin(ang);
          hx = gcx + relx * cs - rely * sn;
          hy = gcy + relx * sn + rely * cs;
          spring = 2.2; damp = dampDisc;
        }

        var accx = (hx - px) * spring, accy = (hy - py) * spring;
        var mdx = mx - px, mdy = my - py;
        var mr = Math.sqrt(mdx * mdx + mdy * mdy) + 1e-4;
        var mdirx = mdx / mr, mdiry = mdy / mr;
        var pull = hover * 38 * Math.exp(-mr * 2.6);
        accx += mdirx * pull; accy += mdiry * pull;
        if (vortex > 0.001) {
          var vfall = Math.exp(-mr * 1.5) * vortex;
          accx += (-mdiry * 210 + mdirx * 70) * vfall;
          accy += (mdirx * 210 + mdiry * 70) * vfall;
        }
        if (this._storm > 0.001) {
          var crr = Math.sqrt(px * px + py * py) + 1e-4;
          var sfall = Math.exp(-crr * 1.1) * this._storm;
          accx += ((-py / crr) * 95 - (px / crr) * 18) * sfall;
          accy += ((px / crr) * 95 - (py / crr) * 18) * sfall;
        }
        if (shockEnv > 0.001) {
          var sdx = px - sx, sdy = py - sy;
          var sr = Math.sqrt(sdx * sdx + sdy * sdy) + 1e-4;
          var rg = (sr - shockT * 2.4) * 7;
          var ring = Math.exp(-rg * rg) * shockEnv;
          var shockMult = (type > 0.5 && type < 1.5) ? 0.05 : 1.0;
          accx += (sdx / sr) * ring * 100 * shockMult;
          accy += (sdy / sr) * ring * 100 * shockMult;
        }
        vx += accx * dt; vy += accy * dt;
        var fl = Math.exp(-mr * 8) * flickK;
        vx += mvx * fl; vy += mvy * fl;
        vx *= damp; vy *= damp;
        var spd2 = vx * vx + vy * vy;
        if (spd2 > 36) { var inv = 6 / Math.sqrt(spd2); vx *= inv; vy *= inv; }
        px += vx * dt; py += vy * dt;
        pv[o4] = px; pv[o4 + 1] = py; pv[o4 + 2] = vx; pv[o4 + 3] = vy;

        /* draw: wide glow + hot core */
        var dx2 = (px / A * 0.5 + 0.5) * w;
        var dy2 = (0.5 - py * 0.5) * h;
        var sz = st[o8 + 5] * this._px * (1 + Math.min(Math.sqrt(spd2) * 0.5, 1.2));
        ctx.fillStyle = glowCols[i];
        ctx.fillRect(dx2 - sz * 1.5, dy2 - sz * 1.5, sz * 3, sz * 3);
        ctx.fillStyle = coreCols[i];
        ctx.fillRect(dx2 - sz * 0.5, dy2 - sz * 0.5, sz, sz);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  customElements.define('galaxy-cluster', GalaxyCluster);
})();
