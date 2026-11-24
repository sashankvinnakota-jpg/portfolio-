/* studio.js -- product-shot 3D toolkit: soft studio lighting, bevelled geometry, shadows, drafting callouts. */
(function (g) {
  'use strict';
  const ACC = 0xc4432a;

  // ---- bevelled / rounded boxes -------------------------------------------------------------
  // face:'xy' -> rounded in the XY plane, depth along Z (screens, slabs).  face:'xz' -> rounded in plan view, height along Y.
  function rbox(w, h, d, r, b, mat, face = 'xy') {
    const W = face === 'xy' ? w : w, H = face === 'xy' ? h : d, D = face === 'xy' ? d : h;
    r = Math.min(r, Math.min(W, H) / 2 - 0.001); b = Math.min(b, r * 0.9, D / 2 - 0.001);
    const s = new THREE.Shape(), x = -W / 2 + b, y = -H / 2 + b, w2 = W - 2 * b, h2 = H - 2 * b, rr = Math.max(0.001, r - b);
    s.moveTo(x + rr, y); s.lineTo(x + w2 - rr, y); s.quadraticCurveTo(x + w2, y, x + w2, y + rr); s.lineTo(x + w2, y + h2 - rr);
    s.quadraticCurveTo(x + w2, y + h2, x + w2 - rr, y + h2); s.lineTo(x + rr, y + h2); s.quadraticCurveTo(x, y + h2, x, y + h2 - rr);
    s.lineTo(x, y + rr); s.quadraticCurveTo(x, y, x + rr, y);
    const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, D - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: 0, bevelSegments: 5, curveSegments: 10 });
    geo.center(); if (face === 'xz') geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m;
  }

  // ---- materials ---------------------------------------------------------------------------------
  const P = (c, o = {}) => new THREE.MeshPhysicalMaterial(Object.assign({ color: c, roughness: 0.5, metalness: 0.0 }, o));
  const MAT = {
    alu: () => P(0x1f2227, { metalness: 0.85, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 0.4 }),
    aluLight: () => P(0xc9ccd1, { metalness: 0.95, roughness: 0.28 }),
    softblack: () => P(0x15171a, { roughness: 0.62 }),
    glass: () => P(0x050607, { roughness: 0.08, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.04, reflectivity: 0.6 }),
    cap: () => P(0xe8e4db, { roughness: 0.55 }),
    accent: () => P(ACC, { roughness: 0.5 }),
    rubber: () => P(0x0c0d0f, { roughness: 0.9 }),
    pcb: () => P(0x16482f, { roughness: 0.55, clearcoat: 0.25 }),
    pcbBlue: () => P(0x1a3f7a, { roughness: 0.55, clearcoat: 0.25 }),
    gold: () => P(0xd8b25a, { metalness: 1, roughness: 0.28 }),
    chip: () => P(0x0e0f11, { roughness: 0.45 }),
    can: () => P(0xcfd3d8, { metalness: 1, roughness: 0.3 }),
  };

  // ---- textures ---------------------------------------------------------------------------------------
  function glyphTex(txt, color = '#1b1d22', size = 128, font = '600 64px "IBM Plex Mono", monospace') {
    const cv = document.createElement('canvas'); cv.width = cv.height = size; const c = cv.getContext('2d');
    c.fillStyle = color; c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, size / 2, size / 2 + 3);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; return t;
  }
  function textTex(txt, w = 512, h = 128, color = '#e9e9e9', font = '500 56px "IBM Plex Mono", monospace') {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d');
    c.fillStyle = color; c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, w / 2, h / 2 + 2);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; return t;
  }
  function decal(tex, w, h, x, y, z, rot) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(x, y, z); if (rot) m.rotation.set(...rot); return m;
  }
  function grilleTex(cols, rows, bg = '#3a3d43', hole = '#08090a') {
    const cv = document.createElement('canvas'); cv.width = cols * 16; cv.height = rows * 16; const c = cv.getContext('2d');
    c.fillStyle = bg; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = hole;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { c.beginPath(); c.arc(i * 16 + 8 + (j % 2) * 4, j * 16 + 8, 4.4, 0, 6.3); c.fill(); }
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; return t;
  }
  function screenTex(w, h) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.anisotropy = 8; tex.encoding = THREE.sRGBEncoding;
    return { cv, ctx: cv.getContext('2d'), tex };
  }

  // ---- the studio ----------------------------------------------------------------------------------------
  function makeStudio(el, opts = {}) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = opts.exposure || 0.9;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.insertBefore(renderer.domElement, el.firstChild);
    const scene = new THREE.Scene();

    // image-based light: a few big softboxes baked into an environment map
    const envScene = new THREE.Scene(); envScene.background = new THREE.Color(0x8a8f98);
    const panel = (w, h, x, y, z, int) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(int, int, int), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m); };
    panel(60, 40, -50, 40, 40, 7); panel(40, 60, 60, 20, 10, 4); panel(80, 30, 0, 70, -30, 5); panel(50, 20, 0, 12, -70, 2.2); panel(90, 90, 0, -60, 0, 1.0);
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(envScene, 0.04).texture; pm.dispose();

    const camera = new THREE.PerspectiveCamera(opts.fov || 32, 1, 0.1, 400);
    camera.position.set(...(opts.cam || [14, 12, 22]));
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(...(opts.target || [0, 4, 0])); controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2 - 0.04; controls.minDistance = opts.minDist || 12; controls.maxDistance = opts.maxDist || 60;
    controls.autoRotate = opts.rotate !== false; controls.autoRotateSpeed = 0.55;
    const stopRot = () => { controls.autoRotate = false; }; renderer.domElement.addEventListener('pointerdown', stopRot); renderer.domElement.addEventListener('wheel', stopRot, { passive: true });

    const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(-14, 26, 16); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); const sc = key.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 90; key.shadow.radius = 5; key.shadow.bias = -0.0004;
    scene.add(key); scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd2d8, 0.2));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.2 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

    const tick = []; let raf, last = performance.now();
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (opts.onResize) opts.onResize(w, h); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    const loop = () => { raf = requestAnimationFrame(loop); const n = performance.now(), dt = Math.min(0.1, (n - last) / 1000); last = n; tick.forEach((f) => f(dt, n)); controls.update(); renderer.render(scene, camera); };
    loop();
    return { scene, camera, renderer, controls, ground, key, onTick: (f) => tick.push(f),
      dispose() { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); } };
  }

  // ---- drafting callouts: numbered leaders projected from 3D points ----------------------------------------------
  function callouts(el, stage, items) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'callouts'); el.appendChild(svg);
    const nodes = items.map((it, i) => {
      const line = document.createElementNS(NS, 'polyline'), dot = document.createElementNS(NS, 'circle'); dot.setAttribute('r', 3);
      svg.appendChild(line); svg.appendChild(dot);
      const lab = document.createElement('div'); lab.className = 'callout'; lab.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b><span>${it.text}</span>`; el.appendChild(lab);
      return { it, line, dot, lab };
    });
    const v = new THREE.Vector3();
    stage.onTick(() => {
      const w = el.clientWidth, h = el.clientHeight;
      nodes.forEach((n) => {
        v.copy(n.it.pos); if (n.it.obj) n.it.obj.localToWorld(v.set(n.it.pos.x, n.it.pos.y, n.it.pos.z));
        v.project(stage.camera); const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h, vis = v.z < 1 && n.it.show !== false && !n.hidden;
        const side = n.it.side || (x > w / 2 ? 1 : -1), ex = x + side * (n.it.len || 70), ey = y + (n.it.dy || -34);
        n.line.setAttribute('points', `${x},${y} ${ex - side * 10},${ey} ${ex},${ey}`); n.dot.setAttribute('cx', x); n.dot.setAttribute('cy', y);
        n.lab.style.transform = `translate(${side > 0 ? ex + 6 : ex - 6}px,${ey}px) translate(${side > 0 ? '0' : '-100%'},-50%)`;
        n.lab.style.textAlign = side > 0 ? 'left' : 'right';
        const o = vis && n.it.visible ? (n.it.visible() ? 1 : 0) : vis ? 1 : 0; n.line.style.opacity = n.dot.style.opacity = n.lab.style.opacity = o;
      });
    });
    return { svg };
  }

  g.Studio = { rbox, MAT, P, glyphTex, textTex, decal, grilleTex, screenTex, makeStudio, callouts, ACC };
})(window);
