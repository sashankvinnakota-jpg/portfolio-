/* common.js -- shared three.js stage + small helpers for the project labs. */
(function (g) {
  'use strict';
  const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0.1 }, o));
  const box = (parent, w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };
  const html = (s) => { const d = document.createElement('div'); d.innerHTML = s.trim(); return d.firstChild; };

  function canvasTex(w, h) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.anisotropy = 8; tex.encoding = THREE.sRGBEncoding;
    return { cv, ctx: cv.getContext('2d'), tex };
  }
  function label(text, w, h, color = '#9fb7c0', px = 30) {
    const cv = document.createElement('canvas'); cv.width = 160; cv.height = 60; const c = cv.getContext('2d');
    c.fillStyle = color; c.font = `600 ${px}px "IBM Plex Mono", monospace`;
    const tw = c.measureText(text).width; if (tw > 148) { px = Math.floor(px * 148 / tw); c.font = `600 ${px}px "IBM Plex Mono", monospace`; }
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 80, 32);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
    m.rotation.x = -Math.PI / 2; return m;
  }

  // a ready-to-use stage: studio lighting on paper, orbit controls, loop
  function makeStage(el, opts = {}) {
    return g.Studio.makeStudio(el, { cam: opts.cam || [0, 12, 16], target: opts.target || [0, 1, 0], fov: opts.fov || 34, rotate: opts.rotate === true, minDist: opts.minDist || 6, maxDist: opts.maxDist || 70, exposure: opts.exposure });
  }

  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return d;
  }

  function logger(el, max = 200) {
    return (s, cls = '') => {
      const d = document.createElement('div'); d.className = 'l ' + cls; d.textContent = s; el.appendChild(d);
      while (el.childElementCount > max) el.removeChild(el.firstChild); el.scrollTop = el.scrollHeight;
    };
  }
  function tabs(root) {
    const bs = root.querySelectorAll('.tabs button'), ps = root.querySelectorAll('.pane');
    bs.forEach((b) => (b.onclick = () => { bs.forEach((x) => x.classList.toggle('on', x === b)); ps.forEach((p) => p.classList.toggle('on', p.dataset.p === b.dataset.t)); }));
  }
  function slider(label, id, min, max, step, val, unit = '') {
    return `<label class="sl"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}-o">${val}${unit}</output></label>`;
  }
  g.Lab = { M, box, html, canvasTex, label, makeStage, fitCanvas, logger, tabs, slider };
  g.Labs = g.Labs || {};
})(window);
