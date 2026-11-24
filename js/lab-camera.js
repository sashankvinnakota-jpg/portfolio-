/* lab-camera.js -- ESP32-S3 camera: pixels -> centimetres. Pinhole model, same idea as live_coords.py (ArUco pose via PnP). */
(function (g) {
  'use strict';
  const { M, box, html, makeStage, fitCanvas, logger, slider, tabs } = g.Lab;

  function mount(root) {
    root.innerHTML = '';
    const L = html(`
      <div class="lab-layout">
        <div class="stage-col">
          <div class="stage short" id="cm-stage"><div class="stage-hint">the translucent cone is the camera's field of view; the 5 cm marker moves with the view below</div></div>
          <div class="scope-wrap view"><canvas id="cm-view"></canvas><div class="viewhint">drag a marker · scroll = move it away / closer · M toggles ARUCO / SPOT</div></div>
        </div>
        <aside class="side">
          <div class="tabs"><button data-t="ctl" class="on">Live coords</button><button data-t="calib">Calibration</button></div>
          <div class="pane on" data-p="ctl">
            <div class="note">The ESP32-S3 streams JPEG frames over USB; the laptop's Python (OpenCV) turns pixels into centimetres. This view re-creates that maths: <code>live_coords.py</code> in <b>ARUCO</b> mode prints each marker's X, Y, Z, and in <b>SPOT</b> mode the pixel position of a bright spot.</div>
            <div class="btnrow"><button id="cm-mode">mode: ARUCO</button><button id="cm-swap">move marker 1 / marker 0</button></div>
            ${slider('marker roll', 'cm-roll', -90, 90, 1, 0, '°')}
            <div class="kv" id="cm-kv"></div>
            <div class="log small" id="cm-log"></div>
          </div>
          <div class="pane" data-p="calib">
            <div class="note">The README's rule: <b>calibrate before trusting any cm.</b> A pinhole camera's focal length decides how big a 5 cm marker looks at a distance. Guess it wrong and every Z is wrong by the same ratio.</div>
            ${slider('true focal length', 'cm-ftrue', 380, 760, 1, 554, ' px')}
            ${slider('focal length the software assumes', 'cm-fass', 380, 760, 1, 554, ' px')}
            <label class="sw"><input type="checkbox" id="cm-dist"> <span>lens distortion (barrel)</span></label>
            <div class="kv" id="cm-err"></div>
            <div class="note small">Real calibration uses a ChArUco board (<code>calibrate.py</code>): 15 to 25 views, reprojection error under about 0.5 px, saved to <code>calib.npz</code>. Resolution is fixed at 640×480 because a calibration only holds at the resolution it was made at.</div>
          </div>
          <div class="pane" data-p="how"><div class="pipe">
            <div class="stagecard"><b>1 · Detect</b><p>Find each marker's four corners in the image. Each ArUco ID is unique, so partial boards still work.</p></div>
            <div class="stagecard"><b>2 · Undistort</b><p>Use the calibrated camera matrix and distortion coefficients to put the corners on an ideal pinhole image.</p></div>
            <div class="stagecard"><b>3 · Pose (solvePnP)</b><p>A square of known size (5 cm) seen as a quad has exactly one position and orientation. That gives the translation vector: X, Y, Z in cm.</p></div>
            <div class="stagecard"><b>4 · Relative</b><p>Marker 1 relative to marker 0: subtract the translation vectors.</p></div>
            <div class="stagecard"><b>The core formula</b><i>Z = f · L / s</i><p>f focal length (px), L real size (cm), s apparent size (px). Then X = (u − cx) · Z / f and Y = (v − cy) · Z / f.</p></div>
          </div></div>
        </aside>
      </div>`);
    root.appendChild(L); tabs(L);
    const $ = (s) => L.querySelector(s), log = logger($('#cm-log'), 40);

    // ---- state ------------------------------------------------------------------------------------------
    const W = 640, Hh = 480, CX = 320, CY = 240, LCM = 5;
    const S = { mode: 'ARUCO', ftrue: 554, fass: 554, dist: false, roll: 0, mk: [{ X: -6, Y: 2, Z: 40, roll: 0 }, { X: 9, Y: -4, Z: 55, roll: 0.3 }], act: 0, spot: { u: 400, v: 200 } };
    const bits = [[1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 0, 0, 1], [0, 0, 1, 1, 0], [1, 0, 0, 1, 1]];
    const bits1 = [[0, 1, 0, 0, 1], [1, 1, 0, 1, 0], [0, 0, 1, 1, 1], [1, 0, 1, 0, 0], [0, 1, 1, 0, 1]];
    const bind = (id, key, u = '') => { const i = $('#' + id), o = $('#' + id + '-o'); i.oninput = () => { S[key] = +i.value; o.textContent = i.value + u; }; };
    bind('cm-ftrue', 'ftrue', ' px'); bind('cm-fass', 'fass', ' px');
    $('#cm-roll').oninput = (e) => { S.mk[S.act].roll = +e.target.value * Math.PI / 180; $('#cm-roll-o').textContent = e.target.value + '°'; };
    $('#cm-dist').onchange = (e) => (S.dist = e.target.checked);
    $('#cm-mode').onclick = toggleMode; $('#cm-swap').onclick = () => { S.act = 1 - S.act; $('#cm-roll').value = Math.round(S.mk[S.act].roll * 180 / Math.PI); log(`active marker: ID ${S.act}`); };
    function toggleMode() { S.mode = S.mode === 'ARUCO' ? 'SPOT' : 'ARUCO'; $('#cm-mode').textContent = 'mode: ' + S.mode; log('mode -> ' + S.mode); }
    const onKey = (e) => { if (e.key === 'm' || e.key === 'M') { if (!/INPUT/.test(document.activeElement.tagName)) toggleMode(); } };
    window.addEventListener('keydown', onKey);

    // pinhole projection with the TRUE camera; distortion optional
    function project(X, Y, Z) {
      let x = X / Z, y = Y / Z;
      if (S.dist) { const r2 = x * x + y * y, k = 1 + 0.18 * r2; x *= k; y *= k; }
      return [CX + S.ftrue * x, CY + S.ftrue * y];
    }
    function corners(m) {
      const h = LCM / 2, c = Math.cos(m.roll), s = Math.sin(m.roll);
      return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) => project(m.X + a * c - b * s, m.Y + a * s + b * c, m.Z));
    }
    // what the SOFTWARE computes from the image, with the assumed focal length
    function estimate(m) {
      const c = corners(m); let sum = 0; for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; sum += Math.hypot(a[0] - b[0], a[1] - b[1]); }
      const side = sum / 4, u = c.reduce((a, p) => a + p[0], 0) / 4, v = c.reduce((a, p) => a + p[1], 0) / 4;
      const Z = (S.fass * LCM) / side; return { Z, X: ((u - CX) * Z) / S.fass, Y: ((v - CY) * Z) / S.fass, side, u, v };
    }

    // ---- 3D camera + frustum ---------------------------------------------------------------------------------
    const S3 = g.Studio, MT = S3.MAT, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const st = makeStage($('#cm-stage'), { cam: [19, 11, -12], target: [0, 3, 6], fov: 36, minDist: 6, rotate: false });
    const SC = 0.2, rig = new THREE.Group(); rig.position.y = 3.2; st.scene.add(rig);
    const cam = new THREE.Group(); cam.scale.setScalar(SC); rig.add(cam);
    const body = new THREE.Group(); body.scale.setScalar(2.2); cam.add(body);
    const addc = (m, x, y, z, par = body) => { m.position.set(x, y, z); par.add(m); return m; };
    addc(S3.rbox(5.4, 3.8, 1.8, 0.9, 0.25, MT.alu(), 'xy'), 0, 0, -0.9);
    const barrel = addc(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.9, 36), MT.softblack()), 0, 0, 0.35); barrel.rotation.x = Math.PI / 2; barrel.castShadow = true;
    const ring = addc(new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.07, 10, 40), MT.accent()), 0, 0, 0.82);
    const glass = addc(new THREE.Mesh(new THREE.CircleGeometry(0.95, 36), S3.P(0x07090c, { roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 })), 0, 0, 0.84);
    addc(S3.decal(S3.textTex('XIAO ESP32-S3 SENSE', 512, 64, '#aeb3bb', '500 34px "IBM Plex Mono", monospace'), 4.2, 0.5, 0, -1.35, 0.01), 0, -1.35, 0.02);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3.0, 16), MT.aluLight()); stand.position.set(0, -1.5, 0); stand.castShadow = true; rig.add(stand);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.25, 36), MT.alu()); foot.position.set(0, -3.0, 0); foot.castShadow = true; rig.add(foot);
    const half = Math.atan(CX / 554), fr = 60, fw = Math.tan(half) * fr, fh = fw * 0.75;
    const frG = new THREE.BufferGeometry(); const P = [[0, 0, 0], [-fw, -fh, fr], [fw, -fh, fr], [fw, fh, fr], [-fw, fh, fr]];
    frG.setAttribute('position', new THREE.Float32BufferAttribute([].concat(...[[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4], [4, 1]].map(([a, b]) => [...P[a], ...P[b]])), 3));
    cam.add(new THREE.LineSegments(frG, new THREE.LineBasicMaterial({ color: 0x16181c, transparent: true, opacity: 0.45 })));
    // marker textures: black border + a fixed pattern
    const mtex = (seed) => { const cv = document.createElement('canvas'); cv.width = cv.height = 224; const c = cv.getContext('2d'); c.fillStyle = '#f4f2ec'; c.fillRect(0, 0, 224, 224); c.fillStyle = '#0a0a0a';
      for (let r = 0; r < 7; r++) for (let k = 0; k < 7; k++) { const border = r === 0 || k === 0 || r === 6 || k === 6; if (border || ((r * 7 + k) * 2654435761 + seed * 40503 >>> 3) % 3 === 0) c.fillRect(k * 32, r * 32, 32, 32); }
      const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; return t; };
    const mk3 = [0, 1].map((i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(LCM, LCM), new THREE.MeshBasicMaterial({ map: mtex(i + 1), side: THREE.DoubleSide, toneMapped: false })); m.scale.setScalar(SC); rig.add(m); return m; });
    S3.callouts($('#cm-stage'), st, [
      { text: 'OV2640 lens', pos: V3(0, 0, 0.9 * 2.2), obj: cam, side: 1, len: 70, dy: -50 },
      { text: 'XIAO ESP32-S3', pos: V3(0, 0, -1.4 * 2.2), obj: cam, side: -1, len: 60, dy: -40 },
      { text: 'Field of view', pos: V3(0, 0, 30), obj: cam, side: 1, len: 50, dy: 50 },
    ]);
    st.onTick(() => { S.mk.forEach((m, i) => { mk3[i].position.set(-m.X * SC, -m.Y * SC, m.Z * SC); mk3[i].rotation.set(0, 0, m.roll); mk3[i].visible = S.mode === 'ARUCO'; }); });

    // ---- the camera view ------------------------------------------------------------------------------------------
    const cv = $('#cm-view'), cx = cv.getContext('2d'); let drag = -1;
    function toImg(ev) { const r = cv.getBoundingClientRect(); return [((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * Hh]; }
    cv.addEventListener('pointerdown', (ev) => {
      const [u, v] = toImg(ev); cv.setPointerCapture(ev.pointerId);
      if (S.mode === 'SPOT') { drag = 9; S.spot.u = u; S.spot.v = v; return; }
      let best = -1, bd = 1e9; S.mk.forEach((m, i) => { const e = estimate(m), d = Math.hypot(e.u - u, e.v - v); if (d < bd) { bd = d; best = i; } });
      if (bd < 90) { drag = best; S.act = best; $('#cm-roll').value = Math.round(S.mk[best].roll * 180 / Math.PI); }
    });
    cv.addEventListener('pointermove', (ev) => {
      if (drag < 0) return; const [u, v] = toImg(ev);
      if (drag === 9) { S.spot.u = u; S.spot.v = v; return; }
      const m = S.mk[drag], f = S.ftrue; m.X = ((u - CX) * m.Z) / f; m.Y = ((v - CY) * m.Z) / f;
    });
    cv.addEventListener('pointerup', () => (drag = -1));
    cv.addEventListener('wheel', (ev) => { ev.preventDefault(); const m = S.mk[S.act]; const u = CX + S.ftrue * (m.X / m.Z), v = CY + S.ftrue * (m.Y / m.Z); m.Z = Math.max(15, Math.min(150, m.Z * (ev.deltaY > 0 ? 1.04 : 0.96))); m.X = ((u - CX) * m.Z) / S.ftrue; m.Y = ((v - CY) * m.Z) / S.ftrue; }, { passive: false });

    function drawView() {
      cv.width = W; cv.height = Hh; // fixed 640x480 like the firmware
      const c = cx; const gr = c.createLinearGradient(0, 0, W, Hh); gr.addColorStop(0, '#1d2630'); gr.addColorStop(1, '#0d1218'); c.fillStyle = gr; c.fillRect(0, 0, W, Hh);
      c.strokeStyle = 'rgba(255,255,255,0.04)'; for (let x = 0; x < W; x += 40) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, Hh); c.stroke(); } for (let y = 0; y < Hh; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      c.font = '14px "IBM Plex Mono", monospace'; c.textBaseline = 'top';
      if (S.mode === 'ARUCO') {
        S.mk.forEach((m, i) => {
          const q = corners(m); const bm = i ? bits1 : bits;
          c.fillStyle = '#f4f4f4'; c.beginPath(); q.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill();
          const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], pt = (uu, vv) => lerp(lerp(q[0], q[1], uu), lerp(q[3], q[2], uu), vv);
          for (let r = 0; r < 7; r++) for (let k = 0; k < 7; k++) {
            const border = r === 0 || k === 0 || r === 6 || k === 6; const on = border || !bm[r - 1][k - 1];
            if (!on) continue; const p0 = pt(k / 7, r / 7), p1 = pt((k + 1) / 7, r / 7), p2 = pt((k + 1) / 7, (r + 1) / 7), p3 = pt(k / 7, (r + 1) / 7);
            c.fillStyle = '#050505'; c.beginPath(); c.moveTo(...p0); c.lineTo(...p1); c.lineTo(...p2); c.lineTo(...p3); c.closePath(); c.fill();
          }
          c.strokeStyle = S.act === i ? '#7ee787' : '#2fa5c0'; c.lineWidth = 2; c.beginPath(); q.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.stroke();
          const e = estimate(m);
          c.fillStyle = '#7ee787'; c.fillText(`ID ${i}  X${e.X.toFixed(1)} Y${e.Y.toFixed(1)} Z${e.Z.toFixed(1)} cm`, Math.max(4, Math.min(W - 270, q[0][0])), Math.max(4, q[0][1] - 20));
        });
        const a = estimate(S.mk[0]), b = estimate(S.mk[1]);
        c.fillStyle = '#ffb454'; c.fillText(`marker 1 rel. 0:  dX ${(b.X - a.X).toFixed(1)}  dY ${(b.Y - a.Y).toFixed(1)}  dZ ${(b.Z - a.Z).toFixed(1)} cm`, 10, Hh - 26);
        c.fillStyle = '#6fe3ff'; c.fillText('ARUCO', 10, 8);
      } else {
        const { u, v } = S.spot; const rg = c.createRadialGradient(u, v, 0, u, v, 40); rg.addColorStop(0, '#fff'); rg.addColorStop(0.2, '#fffbd0'); rg.addColorStop(1, 'rgba(255,240,150,0)'); c.fillStyle = rg; c.beginPath(); c.arc(u, v, 40, 0, 6.3); c.fill();
        c.strokeStyle = '#7ee787'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(u - 14, v); c.lineTo(u + 14, v); c.moveTo(u, v - 14); c.lineTo(u, v + 14); c.stroke();
        const dx = u - CX, dy = v - CY, ang = (Math.atan2(-dy, dx) * 180) / Math.PI;
        c.strokeStyle = '#334'; c.beginPath(); c.moveTo(CX, CY); c.lineTo(u, v); c.stroke();
        c.fillStyle = '#7ee787'; c.fillText(`SPOT  px (${u.toFixed(0)}, ${v.toFixed(0)})  from centre (${dx.toFixed(0)}, ${dy.toFixed(0)})  ${ang.toFixed(0)}°`, 10, 8);
        c.fillStyle = '#9fb7c0'; c.fillText('a pixel is not a length until you know the distance', 10, Hh - 26);
      }
      c.strokeStyle = 'rgba(111,227,255,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(CX - 10, CY); c.lineTo(CX + 10, CY); c.moveTo(CX, CY - 10); c.lineTo(CX, CY + 10); c.stroke();
    }
    let raf, tick = 0;
    function loop() {
      raf = requestAnimationFrame(loop); drawView();
      if (++tick % 4) return;
      const m = S.mk[S.act], e = estimate(m);
      $('#cm-kv').innerHTML = `<div><span>marker ${S.act} true Z</span><b>${m.Z.toFixed(1)} cm</b></div><div><span>software says Z</span><b>${e.Z.toFixed(1)} cm</b></div><div><span>apparent size</span><b>${e.side.toFixed(1)} px</b></div><div><span>X · Y (software)</span><b>${e.X.toFixed(1)} · ${e.Y.toFixed(1)} cm</b></div>`;
      const ratio = S.fass / S.ftrue;
      $('#cm-err').innerHTML = `<div><span>Z error from focal length alone</span><b>${((ratio - 1) * 100).toFixed(1)} %</b></div><div><span>at 40 cm true, reads</span><b>${(40 * ratio).toFixed(1)} cm</b></div>${S.dist ? '<div><span>distortion</span><b>adds error near the edges</b></div>' : ''}`;
    }
    raf = requestAnimationFrame(loop); log('streaming 640x480 JPEG over USB (simulated)');
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); st.dispose(); };
  }
  g.Labs.camera = { mount };
})(window);
