/* ============================================================
   fluid-splash.js — @danfrank · THE MEMBRANE
   <fluid-splash> — full-screen real-time GPU fluid simulation
   (Navier-Stokes w/ vorticity confinement, WebGL2 half-float).
   Drag = inject neon ink + velocity. The "@danfrank" wordmark
   ignites only where fluid passes over it.
   Game mechanic: stirring fluid near the center charges the
   breach. Emits:
     document CustomEvent 'void:charge'       {level: 0..1}
     document CustomEvent 'void:fluid-failed' (no WebGL2/float)
   ============================================================ */
(function () {
  'use strict';
  if (window.__fluidSplashDefined) return;
  window.__fluidSplashDefined = true;

  var VS = [
    'precision highp float;',
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FS_COPY = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTexture;',
    'uniform float uValue;',
    'void main(){ gl_FragColor = uValue * texture2D(uTexture, vUv); }'
  ].join('\n');

  var FS_SPLAT = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTarget;',
    'uniform float uAspect;',
    'uniform vec2 uPoint;',
    'uniform vec3 uColor;',
    'uniform float uRadius;',
    'void main(){',
    '  vec2 p = vUv - uPoint;',
    '  p.x *= uAspect;',
    '  vec3 splat = exp(-dot(p, p) / uRadius) * uColor;',
    '  vec3 base = texture2D(uTarget, vUv).xyz;',
    '  gl_FragColor = vec4(base + splat, 1.0);',
    '}'
  ].join('\n');

  var FS_ADVECT = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uVelocity;',
    'uniform sampler2D uSource;',
    'uniform vec2 uTexel;',
    'uniform float uDt;',
    'uniform float uDissipation;',
    'void main(){',
    '  vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexel;',
    '  gl_FragColor = uDissipation * texture2D(uSource, coord);',
    '  gl_FragColor.a = 1.0;',
    '}'
  ].join('\n');

  var FS_CURL = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uVelocity;',
    'uniform vec2 uTexel;',
    'void main(){',
    '  float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;',
    '  float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;',
    '  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).x;',
    '  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).x;',
    '  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_VORTICITY = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uVelocity;',
    'uniform sampler2D uCurl;',
    'uniform vec2 uTexel;',
    'uniform float uStrength;',
    'uniform float uDt;',
    'void main(){',
    '  float L = texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).x;',
    '  float R = texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).x;',
    '  float B = texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).x;',
    '  float T = texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).x;',
    '  float C = texture2D(uCurl, vUv).x;',
    '  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));',
    '  force /= length(force) + 0.0001;',
    '  force *= uStrength * C;',
    '  force.y *= -1.0;',
    '  vec2 vel = texture2D(uVelocity, vUv).xy;',
    '  gl_FragColor = vec4(vel + force * uDt, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_DIVERGENCE = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uVelocity;',
    'uniform vec2 uTexel;',
    'void main(){',
    '  float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;',
    '  float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;',
    '  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;',
    '  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;',
    '  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_PRESSURE = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uPressure;',
    'uniform sampler2D uDivergence;',
    'uniform vec2 uTexel;',
    'void main(){',
    '  float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;',
    '  float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;',
    '  float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;',
    '  float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;',
    '  float div = texture2D(uDivergence, vUv).x;',
    '  gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_GRADIENT = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uPressure;',
    'uniform sampler2D uVelocity;',
    'uniform vec2 uTexel;',
    'void main(){',
    '  float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;',
    '  float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;',
    '  float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;',
    '  float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;',
    '  vec2 vel = texture2D(uVelocity, vUv).xy;',
    '  vel -= 0.5 * vec2(R - L, T - B);',
    '  gl_FragColor = vec4(vel, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_DISPLAY = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uDye;',
    'uniform sampler2D uMask;',
    'uniform float uTime;',
    'void main(){',
    '  vec2 uv = vUv;',
    '  float ca = 0.0032;',
    '  vec3 c;',
    '  c.r = texture2D(uDye, uv + vec2(ca, 0.0)).r;',
    '  c.g = texture2D(uDye, uv).g;',
    '  c.b = texture2D(uDye, uv - vec2(ca, 0.0)).b;',
    '  float lum = max(c.r, max(c.g, c.b));',
    '  float m = texture2D(uMask, uv).a;',
    '  c += m * vec3(0.05, 0.07, 0.11) * (1.0 + 0.5 * sin(uTime * 1.7));',
    '  c += m * lum * vec3(1.5, 1.25, 1.7);',
    '  vec2 q = uv - 0.5;',
    '  c *= 1.0 - 0.9 * dot(q, q);',
    '  c *= 0.95 + 0.05 * sin(gl_FragCoord.y * 1.4 + uTime * 22.0);',
    '  c = pow(max(c, vec3(0.0)), vec3(0.82));',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  function compileShader(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[fluid-splash] shader: ' + gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  function makeProgram(gl, vsSrc, fsSrc) {
    var vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[fluid-splash] link: ' + gl.getProgramInfoLog(p));
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

  var NEON_HUES = [0.5, 0.55, 0.83, 0.88, 0.74, 0.36, 0.12];

  function hsv2rgb(h, s, v) {
    h = ((h % 1) + 1) % 1;
    var i = Math.floor(h * 6), f = h * 6 - i;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    var r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q;
    }
    return [r, g, b];
  }

  class FluidSplash extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      var self = this;
      if (!this.style.position) this.style.position = 'fixed';
      this.style.touchAction = 'none';
      this.style.cursor = 'crosshair';
      this.style.background = '#020008';

      var c = this._c = document.createElement('canvas');
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
      this.appendChild(c);

      var gl = this._gl = c.getContext('webgl2', { alpha: false, depth: false, stencil: false, antialias: false });
      var ok = false;
      if (gl) {
        this._extCBF = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
        if (this._extCBF) ok = true;
      }
      if (!ok) {
        console.warn('[fluid-splash] WebGL2 float render unavailable — failing over');
        document.dispatchEvent(new CustomEvent('void:fluid-failed'));
        this.style.background = 'radial-gradient(circle at 50% 45%, #1a0030 0%, #020008 70%)';
        return;
      }

      gl.disable(gl.BLEND);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this._prog = {
        copy: makeProgram(gl, VS, FS_COPY),
        splat: makeProgram(gl, VS, FS_SPLAT),
        advect: makeProgram(gl, VS, FS_ADVECT),
        curl: makeProgram(gl, VS, FS_CURL),
        vorticity: makeProgram(gl, VS, FS_VORTICITY),
        divergence: makeProgram(gl, VS, FS_DIVERGENCE),
        pressure: makeProgram(gl, VS, FS_PRESSURE),
        gradient: makeProgram(gl, VS, FS_GRADIENT),
        display: makeProgram(gl, VS, FS_DISPLAY)
      };
      for (var k in this._prog) {
        if (!this._prog[k]) {
          document.dispatchEvent(new CustomEvent('void:fluid-failed'));
          return;
        }
      }

      this._pointers = {};
      this._charge = 0;
      this._lastInteract = 0;
      this._lastAuto = 0;
      this._t0 = performance.now();
      this._last = this._t0;

      this._sizeAll();
      this._buildMaskWhenReady();
      this._seed();

      this._onDown = function (e) { self._pdown(e); };
      this._onMove = function (e) { self._pmove(e); };
      this._onUp = function (e) { delete self._pointers[e.pointerId]; };
      c.addEventListener('pointerdown', this._onDown);
      window.addEventListener('pointermove', this._onMove);
      window.addEventListener('pointerup', this._onUp);
      window.addEventListener('pointercancel', this._onUp);
      window.addEventListener('resize', this._onResize = function () {
        clearTimeout(self._rt);
        self._rt = setTimeout(function () { self._sizeAll(); self._buildMask(); self._seed(); }, 280);
      });

      var loop = function (t) {
        self._raf = requestAnimationFrame(loop);
        if (!document.hidden) self._frame(t);
      };
      this._raf = requestAnimationFrame(loop);
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      clearTimeout(this._rt);
      if (this._c) {
        this._c.removeEventListener('pointerdown', this._onDown);
      }
      window.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('pointerup', this._onUp);
      window.removeEventListener('pointercancel', this._onUp);
      window.removeEventListener('resize', this._onResize);
      this._init = false;
    }

    /* ---------- sizing / FBOs ---------- */

    _sizeAll() {
      var gl = this._gl;
      var w = this.clientWidth || window.innerWidth;
      var h = this.clientHeight || window.innerHeight;
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this._c.width = Math.max(2, Math.round(w * dpr));
      this._c.height = Math.max(2, Math.round(h * dpr));
      this._aspect = w / h;

      var simRes = 160, dyeRes = 600;
      var sim = this._res(simRes), dye = this._res(dyeRes);
      this._vel = this._doubleFBO(sim.w, sim.h, gl.LINEAR);
      this._dye = this._doubleFBO(dye.w, dye.h, gl.LINEAR);
      this._div = this._fbo(sim.w, sim.h, gl.NEAREST);
      this._prs = this._doubleFBO(sim.w, sim.h, gl.NEAREST);
      this._crl = this._fbo(sim.w, sim.h, gl.NEAREST);
    }

    _res(base) {
      var a = Math.max(this._aspect, 0.0001);
      if (a > 1) return { w: Math.round(base * a), h: base };
      return { w: base, h: Math.round(base / a) };
    }

    _fbo(w, h, filter) {
      var gl = this._gl;
      var tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return {
        tex: tex, fbo: fb, w: w, h: h, tx: 1 / w, ty: 1 / h,
        attach: function (id) {
          gl.activeTexture(gl.TEXTURE0 + id);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          return id;
        }
      };
    }

    _doubleFBO(w, h, filter) {
      var a = this._fbo(w, h, filter), b = this._fbo(w, h, filter);
      return {
        get read() { return a; }, get write() { return b; },
        w: w, h: h, tx: 1 / w, ty: 1 / h,
        swap: function () { var t = a; a = b; b = t; }
      };
    }

    _blit(target) {
      var gl = this._gl;
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, target.w, target.h);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this._c.width, this._c.height);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* ---------- wordmark mask ---------- */

    _buildMaskWhenReady() {
      var self = this;
      this._buildMask();
      if (document.fonts && document.fonts.load) {
        document.fonts.load('900 100px Unbounded').then(function () { self._buildMask(); }).catch(function () {});
      }
    }

    _buildMask() {
      var gl = this._gl;
      if (!gl) return;
      var w = 1200, h = Math.max(2, Math.round(1200 / Math.max(this._aspect, 0.0001)));
      var o = document.createElement('canvas');
      o.width = w; o.height = h;
      var x = o.getContext('2d');
      x.clearRect(0, 0, w, h);
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      var fs = w * 0.13;
      x.font = '900 ' + fs + 'px Unbounded, sans-serif';
      var tw = x.measureText('@danfrank').width;
      if (tw > w * 0.86) fs *= (w * 0.86) / tw;
      x.font = '900 ' + fs + 'px Unbounded, sans-serif';
      x.fillStyle = '#fff';
      x.fillText('@danfrank', w / 2, h / 2 - fs * 0.16);
      x.font = '700 ' + (fs * 0.19) + 'px "IBM Plex Mono", monospace';
      x.fillText('U N I Q U E   ·   A I   ·   S O L U T I O N S', w / 2, h / 2 + fs * 0.62);

      if (!this._maskTex) this._maskTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._maskTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, o);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this._maskAttach = function (id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, this._maskTex);
        return id;
      };
    }

    /* ---------- input ---------- */

    _uv(e) {
      var b = this._c.getBoundingClientRect();
      return {
        x: (e.clientX - b.left) / b.width,
        y: 1 - (e.clientY - b.top) / b.height
      };
    }

    _color() {
      var hue = NEON_HUES[Math.floor(Math.random() * NEON_HUES.length)] + (Math.random() - 0.5) * 0.06;
      var c = hsv2rgb(hue, 1, 1);
      return [c[0] * 0.22, c[1] * 0.22, c[2] * 0.22];
    }

    _pdown(e) {
      var p = this._uv(e);
      this._pointers[e.pointerId] = { x: p.x, y: p.y, color: this._color() };
      this._lastInteract = performance.now();
      /* tap bomb: ring of splats */
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2;
        this._splat(p.x, p.y, Math.cos(a) * 320, Math.sin(a) * 320, this._color(), 0.0022);
      }
      this._addCharge(p, 0.035);
    }

    _pmove(e) {
      var ptr = this._pointers[e.pointerId];
      if (!ptr) return;
      var p = this._uv(e);
      var dx = p.x - ptr.x, dy = p.y - ptr.y;
      ptr.x = p.x; ptr.y = p.y;
      var speed = Math.sqrt(dx * dx + dy * dy);
      if (speed < 0.00005) return;
      this._lastInteract = performance.now();
      this._splat(p.x, p.y, dx * 7000, dy * 7000, ptr.color, 0.0016);
      this._addCharge(p, Math.min(speed, 0.05) * 0.42);
    }

    _addCharge(p, amt) {
      var cx = (p.x - 0.5) * this._aspect, cy = p.y - 0.5;
      if (Math.sqrt(cx * cx + cy * cy) > 0.32) return;
      if (this._charge >= 1) return;
      this._charge = Math.min(1, this._charge + amt);
      document.dispatchEvent(new CustomEvent('void:charge', { detail: { level: this._charge } }));
    }

    /* ---------- splat ---------- */

    _splat(x, y, dx, dy, color, radius) {
      var gl = this._gl, P = this._prog.splat;
      gl.useProgram(P.prog);
      gl.uniform1f(P.u.uAspect, this._aspect);
      gl.uniform2f(P.u.uPoint, x, y);
      gl.uniform1f(P.u.uRadius, radius / 100);
      gl.uniform1i(P.u.uTarget, this._vel.read.attach(0));
      gl.uniform3f(P.u.uColor, dx, dy, 0);
      this._blit(this._vel.write);
      this._vel.swap();
      gl.uniform1i(P.u.uTarget, this._dye.read.attach(0));
      gl.uniform3f(P.u.uColor, color[0], color[1], color[2]);
      this._blit(this._dye.write);
      this._dye.swap();
    }

    _seed() {
      for (var i = 0; i < 7; i++) {
        var a = Math.random() * Math.PI * 2;
        this._splat(0.2 + Math.random() * 0.6, 0.25 + Math.random() * 0.5,
          Math.cos(a) * 900, Math.sin(a) * 900, this._color(), 0.003);
      }
    }

    /* ---------- frame ---------- */

    _frame(tms) {
      var gl = this._gl;
      var dt = Math.min((tms - this._last) / 1000, 0.033) || 0.016;
      this._last = tms;
      var t = (tms - this._t0) / 1000;

      /* ambient life when idle */
      if (tms - this._lastInteract > 2600 && tms - this._lastAuto > 1300) {
        this._lastAuto = tms;
        var a = Math.random() * Math.PI * 2;
        this._splat(0.15 + Math.random() * 0.7, 0.2 + Math.random() * 0.6,
          Math.cos(a) * 700, Math.sin(a) * 700, this._color(), 0.0024);
      }

      var vel = this._vel, dye = this._dye, P;

      /* curl + vorticity confinement */
      P = this._prog.curl;
      gl.useProgram(P.prog);
      gl.uniform2f(P.u.uTexel, vel.tx, vel.ty);
      gl.uniform1i(P.u.uVelocity, vel.read.attach(0));
      this._blit(this._crl);

      P = this._prog.vorticity;
      gl.useProgram(P.prog);
      gl.uniform2f(P.u.uTexel, vel.tx, vel.ty);
      gl.uniform1i(P.u.uVelocity, vel.read.attach(0));
      gl.uniform1i(P.u.uCurl, this._crl.attach(1));
      gl.uniform1f(P.u.uStrength, 28);
      gl.uniform1f(P.u.uDt, dt);
      this._blit(vel.write);
      vel.swap();

      /* divergence */
      P = this._prog.divergence;
      gl.useProgram(P.prog);
      gl.uniform2f(P.u.uTexel, vel.tx, vel.ty);
      gl.uniform1i(P.u.uVelocity, vel.read.attach(0));
      this._blit(this._div);

      /* pressure warm-start decay */
      P = this._prog.copy;
      gl.useProgram(P.prog);
      gl.uniform1f(P.u.uValue, 0.8);
      gl.uniform1i(P.u.uTexture, this._prs.read.attach(0));
      this._blit(this._prs.write);
      this._prs.swap();

      /* jacobi */
      P = this._prog.pressure;
      gl.useProgram(P.prog);
      gl.uniform2f(P.u.uTexel, vel.tx, vel.ty);
      gl.uniform1i(P.u.uDivergence, this._div.attach(0));
      for (var i = 0; i < 22; i++) {
        gl.uniform1i(P.u.uPressure, this._prs.read.attach(1));
        this._blit(this._prs.write);
        this._prs.swap();
      }

      /* gradient subtract */
      P = this._prog.gradient;
      gl.useProgram(P.prog);
      gl.uniform2f(P.u.uTexel, vel.tx, vel.ty);
      gl.uniform1i(P.u.uPressure, this._prs.read.attach(0));
      gl.uniform1i(P.u.uVelocity, vel.read.attach(1));
      this._blit(vel.write);
      vel.swap();

      /* advect velocity */
      P = this._prog.advect;
      gl.useProgram(P.prog);
      gl.uniform2f(P.u.uTexel, vel.tx, vel.ty);
      gl.uniform1f(P.u.uDt, dt);
      gl.uniform1f(P.u.uDissipation, 0.995);
      gl.uniform1i(P.u.uVelocity, vel.read.attach(0));
      gl.uniform1i(P.u.uSource, vel.read.attach(0));
      this._blit(vel.write);
      vel.swap();

      /* advect dye */
      gl.uniform1f(P.u.uDissipation, 0.984);
      gl.uniform1i(P.u.uVelocity, vel.read.attach(0));
      gl.uniform1i(P.u.uSource, dye.read.attach(1));
      this._blit(dye.write);
      dye.swap();

      /* display */
      P = this._prog.display;
      gl.useProgram(P.prog);
      gl.uniform1f(P.u.uTime, t);
      gl.uniform1i(P.u.uDye, dye.read.attach(0));
      gl.uniform1i(P.u.uMask, this._maskAttach ? this._maskAttach(1) : dye.read.attach(1));
      this._blit(null);
    }
  }

  customElements.define('fluid-splash', FluidSplash);
})();
