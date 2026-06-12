/* ============================================================
   void-engine.js — @danfrank · unique ai solutions
   Defines two web components:
     <void-engine>   — full-screen WebGL neon tunnel (audio-reactive,
                       cursor-warped, scroll-driven). attr: intensity
     <particle-type> — text rendered as a living particle field.
                       attrs: text
   Sound is toggled via:  document.dispatchEvent(
     new CustomEvent('void:sound', { detail: { on: true } }))
   ============================================================ */
(function () {
  'use strict';
  if (window.__voidEngineDefined) return;
  window.__voidEngineDefined = true;

  /* ---------------- WebGL tunnel ---------------- */

  var VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

  var FRAG = [
    'precision highp float;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform vec2 uMouse;',
    'uniform float uIntensity;',
    'uniform float uAudio;',
    'uniform float uScroll;',
    'mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }',
    'float hash(vec2 p){ p=fract(p*vec2(234.34,435.345)); p+=dot(p,p+34.23); return fract(p.x*p.y); }',
    'float noise(vec2 p){',
    '  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);',
    '  float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));',
    '  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v=0.0, amp=0.5;',
    '  for(int i=0;i<4;i++){ v+=amp*noise(p); p=rot(0.55)*p*2.03; amp*=0.5; }',
    '  return v;',
    '}',
    'vec3 pal(float t){ return 0.55+0.45*cos(6.28318*(t+vec3(0.0,0.33,0.64))); }',
    'float scene(vec2 uv, float off){',
    '  float a=atan(uv.y, uv.x);',
    '  float r=length(uv);',
    '  float seg=7.0;',
    '  float fold=abs(mod(a+uTime*0.06, 6.28318/seg)-3.14159/seg);',
    '  float depth=0.33/(r+0.07)+uTime*(0.5+0.6*uIntensity)+uScroll*1.7+off;',
    '  vec2 tuv=vec2(fold*4.0+sin(depth*0.22)*0.7, depth);',
    '  float n=fbm(tuv*1.35+uTime*0.05);',
    '  float ribs=pow(abs(sin(depth*2.1+n*3.2)), 7.0);',
    '  float spokes=pow(abs(sin(fold*seg*2.2+depth*0.6+n*2.0)), 5.0);',
    '  float wisps=smoothstep(0.55,0.95,n)*0.8;',
    '  return ribs + spokes*0.6 + wisps;',
    '}',
    'void main(){',
    '  vec2 uv=(gl_FragCoord.xy*2.0-uRes)/min(uRes.x,uRes.y);',
    '  vec2 m=uMouse;',
    '  float md=length(uv-m);',
    '  uv+=(uv-m)*0.22*smoothstep(1.0,0.0,md);',
    '  float r=length(uv);',
    '  float ca=0.04*(1.0+uAudio*1.5);',
    '  float e0=scene(uv, 0.0);',
    '  float e1=scene(uv, ca*2.5);',
    '  float e2=scene(uv, ca*5.0);',
    '  float depth=0.33/(r+0.07)+uTime*0.5+uScroll*1.7;',
    '  vec3 hue=pal(depth*0.06+uTime*0.02);',
    '  vec3 col=vec3(e0,e1,e2)*(0.72+1.05*hue);',
    '  col+=pal(uTime*0.04+0.5)*(0.05+0.08*uAudio)/(abs(r-0.16)+0.05);',
    '  col+=pal(uTime*0.07)*0.2/(md+0.12)*uIntensity;',
    '  col*=smoothstep(0.015,0.34,r);',
    '  col*=0.8+0.5*uAudio;',
    '  col*=1.0-0.32*pow(min(r*0.6,1.2),2.2);',
    '  col*=0.96+0.04*sin(gl_FragCoord.y*1.7+uTime*30.0);',
    '  col=pow(max(col,0.0), vec3(0.72));',
    '  gl_FragColor=vec4(col,1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[void-engine] shader error: ' + gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  class VoidEngine extends HTMLElement {
    static get observedAttributes() { return ['intensity']; }

    constructor() {
      super();
      this._mx = 0; this._my = 0; this._tmx = 0; this._tmy = 0;
      this._scroll = 0; this._tscroll = 0;
      this._intensity = 0.35; this._tintensity = 0.35;
      this._audio = 0.3;
    }

    attributeChangedCallback(name, _o, v) {
      if (name === 'intensity') {
        var f = parseFloat(v);
        if (!isNaN(f)) this._tintensity = f;
      }
    }

    connectedCallback() {
      if (this._init) return;
      this._init = true;
      var self = this;
      if (!this.style.position) this.style.position = 'fixed';
      var f0 = parseFloat(this.getAttribute('intensity'));
      if (!isNaN(f0)) { this._tintensity = f0; this._intensity = f0; }

      var c = this._canvas = document.createElement('canvas');
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
      this.appendChild(c);

      var gl = this._gl = c.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
      if (!gl) {
        this.style.background = 'radial-gradient(circle at 50% 45%, #1a0030 0%, #020008 70%)';
        return;
      }
      var vs = compile(gl, gl.VERTEX_SHADER, VERT);
      var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;
      var prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('[void-engine] link error: ' + gl.getProgramInfoLog(prog));
        return;
      }
      gl.useProgram(prog);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this._u = {
        res: gl.getUniformLocation(prog, 'uRes'),
        time: gl.getUniformLocation(prog, 'uTime'),
        mouse: gl.getUniformLocation(prog, 'uMouse'),
        intensity: gl.getUniformLocation(prog, 'uIntensity'),
        audio: gl.getUniformLocation(prog, 'uAudio'),
        scroll: gl.getUniformLocation(prog, 'uScroll')
      };

      this._onMove = function (e) {
        var W = window.innerWidth, H = window.innerHeight, m = Math.min(W, H);
        self._tmx = (e.clientX * 2 - W) / m;
        self._tmy = -(e.clientY * 2 - H) / m;
      };
      this._onScroll = function () {
        self._tscroll = window.scrollY / Math.max(1, window.innerHeight);
      };
      this._onResize = function () { self._resize(); };
      this._onSound = function (e) { self._setSound(!!(e.detail && e.detail.on)); };
      window.addEventListener('pointermove', this._onMove);
      window.addEventListener('scroll', this._onScroll, { passive: true });
      window.addEventListener('resize', this._onResize);
      document.addEventListener('void:sound', this._onSound);

      this._resize();
      var loop = function (t) {
        self._raf = requestAnimationFrame(loop);
        if (!document.hidden) self._draw(t);
      };
      this._raf = requestAnimationFrame(loop);
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      window.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('resize', this._onResize);
      document.removeEventListener('void:sound', this._onSound);
      if (this._actx) { try { this._actx.close(); } catch (e) {} this._actx = null; this._analyser = null; }
      this._init = false;
    }

    _resize() {
      if (!this._gl) return;
      var w = this.clientWidth || window.innerWidth;
      var h = this.clientHeight || window.innerHeight;
      var s = 0.62; /* render at 62% — neon glow hides it, big perf win */
      this._canvas.width = Math.max(2, Math.round(w * s));
      this._canvas.height = Math.max(2, Math.round(h * s));
      this._gl.viewport(0, 0, this._canvas.width, this._canvas.height);
    }

    /* ----- drone audio ----- */
    _setSound(on) {
      var self = this;
      if (on) {
        if (!this._actx) {
          try {
            var ctx = this._actx = new (window.AudioContext || window.webkitAudioContext)();
            var master = this._master = ctx.createGain();
            master.gain.value = 0;
            var analyser = this._analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.82;
            this._fbuf = new Uint8Array(analyser.frequencyBinCount);
            master.connect(analyser);
            analyser.connect(ctx.destination);
            var filt = ctx.createBiquadFilter();
            filt.type = 'lowpass'; filt.frequency.value = 420; filt.Q.value = 5;
            filt.connect(master);
            var mk = function (type, freq, g) {
              var o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
              var og = ctx.createGain(); og.gain.value = g;
              o.connect(og); og.connect(filt); o.start();
              return o;
            };
            mk('sine', 55, 0.5);
            mk('sine', 55.7, 0.4);     /* beat frequency shimmer */
            mk('sawtooth', 110.3, 0.16);
            mk('sine', 27.5, 0.55);    /* sub */
            var lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
            var lg = ctx.createGain(); lg.gain.value = 260;
            lfo.connect(lg); lg.connect(filt.frequency); lfo.start();
            var lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.5;
            var lg2 = ctx.createGain(); lg2.gain.value = 0.05;
            lfo2.connect(lg2); lg2.connect(master.gain); lfo2.start();
          } catch (e) {
            console.error('[void-engine] audio init failed', e);
            return;
          }
        }
        this._actx.resume().then(function () {
          var t = self._actx.currentTime;
          self._master.gain.cancelScheduledValues(t);
          self._master.gain.setValueAtTime(self._master.gain.value, t);
          self._master.gain.linearRampToValueAtTime(0.16, t + 1.6);
          self._soundOn = true;
        });
      } else if (this._actx && this._soundOn) {
        var t = this._actx.currentTime;
        this._master.gain.cancelScheduledValues(t);
        this._master.gain.setValueAtTime(this._master.gain.value, t);
        this._master.gain.linearRampToValueAtTime(0.0, t + 0.6);
        this._soundOn = false;
      }
    }

    _draw(tms) {
      var gl = this._gl;
      if (!gl) return;
      var t = tms * 0.001;
      this._mx += (this._tmx - this._mx) * 0.06;
      this._my += (this._tmy - this._my) * 0.06;
      this._scroll += (this._tscroll - this._scroll) * 0.05;
      this._intensity += (this._tintensity - this._intensity) * 0.03;
      var lvl;
      if (this._analyser && this._soundOn) {
        this._analyser.getByteFrequencyData(this._fbuf);
        var s = 0;
        for (var i = 1; i < 24; i++) s += this._fbuf[i];
        lvl = Math.min(1.2, (s / 23 / 255) * 2.4);
      } else {
        lvl = 0.38 + 0.28 * Math.sin(t * 0.6) + 0.12 * Math.sin(t * 2.3);
      }
      this._audio += (lvl - this._audio) * 0.1;
      gl.uniform2f(this._u.res, this._canvas.width, this._canvas.height);
      gl.uniform1f(this._u.time, t);
      gl.uniform2f(this._u.mouse, this._mx, this._my);
      gl.uniform1f(this._u.intensity, this._intensity);
      gl.uniform1f(this._u.audio, Math.max(0, this._audio));
      gl.uniform1f(this._u.scroll, this._scroll);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  customElements.define('void-engine', VoidEngine);

  /* ---------------- particle typography ---------------- */

  class ParticleType extends HTMLElement {
    static get observedAttributes() { return ['text']; }

    attributeChangedCallback() { if (this._init && this._fontReady) this._build(); }

    connectedCallback() {
      if (this._init) return;
      this._init = true;
      var self = this;
      if (!this.style.display) this.style.display = 'block';
      var c = this._c = document.createElement('canvas');
      c.style.cssText = 'width:100%;height:100%;display:block;';
      this.appendChild(c);
      this._ctx = c.getContext('2d');
      this._pts = [];
      this._mx = -99999; this._my = -99999;

      window.addEventListener('pointermove', this._pm = function (e) {
        var b = c.getBoundingClientRect();
        self._mx = e.clientX - b.left;
        self._my = e.clientY - b.top;
      });
      this._down = false; this._downT = 0;
      window.addEventListener('pointerdown', this._pd = function (e) {
        var b = c.getBoundingClientRect();
        self._down = true; self._downT = performance.now();
        self._dx0 = e.clientX - b.left; self._dy0 = e.clientY - b.top;
        self._mx = self._dx0; self._my = self._dy0;
      });
      window.addEventListener('pointerup', this._pu = function (e) {
        var b = c.getBoundingClientRect();
        var x = e.clientX - b.left, y = e.clientY - b.top;
        var held = performance.now() - self._downT;
        var moved = Math.hypot(x - self._dx0, y - self._dy0);
        self._down = false;
        if (held < 260 && moved < 9) self._shock(x, y);
      });
      window.addEventListener('pointercancel', this._pc = function () { self._down = false; });

      this._ro = new ResizeObserver(function () {
        if (self._fontReady) self._build();
      });
      this._ro.observe(this);

      var fontLoad = (document.fonts && document.fonts.load)
        ? document.fonts.load('900 100px Unbounded').catch(function () {})
        : Promise.resolve();
      Promise.race([fontLoad, new Promise(function (r) { setTimeout(r, 1500); })])
        .then(function () { self._fontReady = true; self._build(); });

      var loop = function (t) {
        self._raf = requestAnimationFrame(loop);
        if (!document.hidden) self._draw(t);
      };
      this._raf = requestAnimationFrame(loop);
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
      window.removeEventListener('pointermove', this._pm);
      window.removeEventListener('pointerdown', this._pd);
      window.removeEventListener('pointerup', this._pu);
      window.removeEventListener('pointercancel', this._pc);
      this._init = false;
    }

    _shock(x, y) {
      var P = this._pts || [];
      for (var i = 0; i < P.length; i++) {
        var p = P[i];
        var dx = p.x - x, dy = p.y - y;
        var d = Math.sqrt(dx * dx + dy * dy) + 8;
        var f = Math.min(2400 / d, 40);
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }
    }

    _build() {
      var w = this.clientWidth, h = this.clientHeight;
      if (!w || !h) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this._c.width = Math.round(w * dpr);
      this._c.height = Math.round(h * dpr);
      this._dpr = dpr;
      this._w = w; this._h = h;

      var text = this.getAttribute('text') || '@danfrank';
      var o = document.createElement('canvas');
      o.width = w; o.height = h;
      var octx = o.getContext('2d', { willReadFrequently: true });
      var fs = h * 0.72;
      octx.font = '900 ' + fs + 'px Unbounded, sans-serif';
      var tw = octx.measureText(text).width;
      if (tw > w * 0.94) fs *= (w * 0.94) / tw;
      octx.font = '900 ' + fs + 'px Unbounded, sans-serif';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.fillStyle = '#fff';
      octx.fillText(text, w / 2, h / 2);

      var data;
      try { data = octx.getImageData(0, 0, w, h).data; } catch (e) { return; }
      var step = 3, raw = [], tries;
      for (tries = 0; tries < 4; tries++) {
        raw.length = 0;
        for (var y = 0; y < h; y += step) {
          for (var x = 0; x < w; x += step) {
            if (data[(y * w + x) * 4 + 3] > 128) raw.push(x, y);
          }
        }
        if (raw.length / 2 <= 4200) break;
        step++;
      }
      var P = this._pts = [];
      for (var i = 0; i < raw.length; i += 2) {
        P.push({
          hx: raw[i], hy: raw[i + 1],
          x: raw[i] + (Math.random() - 0.5) * w * 0.7,
          y: raw[i + 1] + (Math.random() - 0.5) * h * 2.2,
          vx: 0, vy: 0,
          ph: Math.random() * 6.283,
          sp: 0.6 + Math.random() * 0.9
        });
      }
    }

    _draw(tms) {
      var ctx = this._ctx, c = this._c;
      if (!c.width || !this._pts.length) return;
      var dpr = this._dpr || 1, w = this._w, h = this._h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      var T = tms * 0.001;
      var breathe = Math.pow((Math.sin(T * 0.5) + 1) / 2, 2) * 26;
      var mx = this._mx, my = this._my;
      var vortex = this._down && (performance.now() - this._downT > 240);
      var spring = vortex ? 0.004 : 0.025;
      var P = this._pts;
      for (var i = 0; i < P.length; i++) {
        var p = P[i];
        var ox = Math.sin(p.ph + T * p.sp) * breathe;
        var oy = Math.cos(p.ph * 1.7 + T * p.sp * 0.8) * breathe;
        var dx = (p.hx + ox) - p.x;
        var dy = (p.hy + oy) - p.y;
        p.vx = (p.vx + dx * spring) * 0.86;
        p.vy = (p.vy + dy * spring) * 0.86;
        var mdx = p.x - mx, mdy = p.y - my;
        var md2 = mdx * mdx + mdy * mdy;
        if (vortex) {
          if (md2 < 105625) {
            var vmd = Math.sqrt(md2) + 0.01;
            p.vx += (-mdy / vmd) * 2.1 + (-mdx / vmd) * 0.55;
            p.vy += (mdx / vmd) * 2.1 + (-mdy / vmd) * 0.55;
          }
        } else if (md2 < 12100) {
          var md = Math.sqrt(md2) + 0.01;
          var f = (1 - md / 110) * 3.4;
          p.vx += (mdx / md) * f;
          p.vy += (mdy / md) * f;
        }
        p.x += p.vx; p.y += p.vy;
        var hue = (180 + (p.hx / w) * 160 + T * 22) % 360;
        ctx.fillStyle = 'hsla(' + hue + ',100%,68%,0.28)';
        ctx.fillRect(p.x - 3, p.y - 3, 8, 8);
        ctx.fillStyle = 'hsla(' + hue + ',100%,74%,1)';
        ctx.fillRect(p.x - 1, p.y - 1, 2.5, 2.5);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  customElements.define('particle-type', ParticleType);
})();
