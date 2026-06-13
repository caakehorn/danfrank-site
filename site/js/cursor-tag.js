/* cursor-tag.js — mini @danfrank LED-dot follower that tracks the mouse.
   Renders a pixel-sampled dot-matrix of "@danfrank" on a small canvas that
   smoothly chases the cursor with spring easing, matching the galaxy palette. */
(function () {
  'use strict';

  var W = 210, H = 46;         /* canvas size in CSS px (2× for sharpness) */
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var DOT = 2.6;               /* dot radius in physical px */
  var GAP = 5.5;               /* grid pitch in physical px */
  var SPRING = 10;             /* position spring constant */
  var DAMP   = 5.5;            /* velocity damping */
  var OFFSET_X = 18;           /* cursor hotspot offset (px from pointer) */
  var OFFSET_Y = 14;

  /* neon ramp — same 4-stop loop as the galaxy shader */
  function neon(h) {
    h = ((h % 1) + 1) % 1 * 4;
    var stops = [
      [0, 240, 255],
      [255, 45, 149],
      [123, 45, 255],
      [0, 255, 157],
      [0, 240, 255]
    ];
    var i = Math.min(Math.floor(h), 3), f = h - i;
    var a = stops[i], b = stops[i + 1];
    return 'rgb(' +
      Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  /* sample @danfrank pixels from an offscreen canvas */
  function buildDots() {
    var ow = 800, oh = 160;
    var o = document.createElement('canvas');
    o.width = ow; o.height = oh;
    var x = o.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, ow, oh);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    var fs = oh * 0.64;
    x.font = '900 ' + fs + 'px Unbounded, sans-serif';
    var tw = x.measureText('@danfrank').width;
    if (tw > ow * 0.95) { fs *= (ow * 0.95) / tw; x.font = '900 ' + fs + 'px Unbounded, sans-serif'; }
    x.fillStyle = '#fff';
    x.fillText('@danfrank', ow / 2, oh / 2);
    var data = x.getImageData(0, 0, ow, oh).data;

    /* physical canvas grid */
    var cw = W * DPR, ch = H * DPR;
    var cols = Math.floor(cw / GAP);
    var rows = Math.floor(ch / GAP);
    var dots = [];
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var cx = col * GAP + GAP / 2;
        var cy = row * GAP + GAP / 2;
        /* map canvas grid → offscreen canvas */
        var sx = Math.round(cx / cw * ow);
        var sy = Math.round(cy / ch * oh);
        sx = Math.max(0, Math.min(ow - 1, sx));
        sy = Math.max(0, Math.min(oh - 1, sy));
        if (data[(sy * ow + sx) * 4 + 3] > 100) {
          /* hue sweeps left → right across the word, drifts over time */
          dots.push({ cx: cx, cy: cy, hue: col / cols * 0.85 });
        }
      }
    }
    return dots;
  }

  function init() {
    var dots = [];

    /* build dots once Unbounded is loaded (or after a short delay) */
    function rebuild() { dots = buildDots(); }
    setTimeout(rebuild, 60);
    if (document.fonts && document.fonts.load) {
      document.fonts.load('900 40px Unbounded').then(rebuild).catch(rebuild);
    }

    var cv = document.createElement('canvas');
    cv.width  = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    cv.style.cssText = [
      'position:fixed', 'top:0', 'left:0',
      'width:' + W + 'px', 'height:' + H + 'px',
      'pointer-events:none', 'z-index:99999',
      'transform:translate(0,0)',   /* GPU layer */
      'will-change:transform',
      'opacity:0',
      'transition:opacity 0.3s'
    ].join(';');
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');

    /* spring state */
    var tx = -W * 2, ty = -H * 2;   /* target (mouse) */
    var px = tx, py = ty;            /* current position */
    var vx = 0, vy = 0;
    var last = performance.now();
    var visible = false;

    window.addEventListener('mousemove', function (e) {
      tx = e.clientX + OFFSET_X;
      ty = e.clientY + OFFSET_Y;
      if (!visible) { cv.style.opacity = '0.92'; visible = true; }
    }, { passive: true });

    /* hide when cursor leaves window */
    document.addEventListener('mouseleave', function () {
      cv.style.opacity = '0'; visible = false;
    });

    var hueOff = 0;

    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      hueOff += dt * 0.08;   /* slow colour drift */

      /* spring physics */
      var ax = (tx - px) * SPRING - vx * DAMP;
      var ay = (ty - py) * SPRING - vy * DAMP;
      vx += ax * dt; vy += ay * dt;
      px += vx * dt; py += vy * dt;

      cv.style.transform = 'translate(' + (px | 0) + 'px,' + (py | 0) + 'px)';

      /* draw */
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (!dots.length) return;

      var t = now / 1000;
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        var h = (d.hue + hueOff + 0.04 * Math.sin(t * 1.6 + d.hue * 31)) % 1;
        var twinkle = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.1 + d.hue * 47 + i * 0.17));
        ctx.globalAlpha = twinkle * 0.88;
        ctx.fillStyle = neon(h);
        ctx.beginPath();
        ctx.arc(d.cx, d.cy, DOT, 0, 6.2831853);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
