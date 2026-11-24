/* lab-pace.js -- Pico + pacemaker pulse detection (runs the ported Final_Project.c pipeline live). */
(function (g) {
  'use strict';
  const { M, box, html, makeStage, fitCanvas, logger, slider, tabs } = g.Lab;
  const { PaceDetector, EcgSource } = g.PaceDSP;

  function mount(root) {
    root.innerHTML = '';
    const L = html(`
      <div class="lab-layout">
        <div class="stage-col">
          <div class="stage short" id="pc-stage"><div class="stage-hint">Raspberry Pi Pico · GP3 lights on every detected pulse</div></div>
          <div class="scope-wrap"><canvas id="pc-scope"></canvas></div>
        </div>
        <aside class="side">
          <div class="tabs"><button data-t="ctl" class="on">Signal</button><button data-t="pipe">Pipeline</button></div>
          <div class="pane on" data-p="ctl">
            <div class="note">A synthetic ECG (<b>200 Hz</b>, like the Pico's sample timer) is fed through the same filter chain, constants and adaptive threshold as <code>Final_Project.c</code>. Real records 102, 104, 107, 113 and 217 from MIT-BIH were used on the bench; here the signal is generated so you can break it.</div>
            ${slider('heart rate', 'pc-bpm', 40, 150, 1, 72, ' bpm')}
            ${slider('spike size', 'pc-spk', 0.04, 0.5, 0.01, 0.3)}
            ${slider('noise', 'pc-noise', 0, 0.03, 0.001, 0.004)}
            ${slider('baseline wander', 'pc-wand', 0, 0.1, 0.005, 0.02)}
            <label class="sw"><input type="checkbox" id="pc-paced" checked> <span>paced rhythm (4 of every 5 beats are paced)</span></label>
            <label class="sw"><input type="checkbox" id="pc-slow"> <span>slow motion (0.25×)</span></label>
            <div class="btnrow"><button id="pc-reset">reset detector</button><button id="pc-pause">pause</button></div>
            <div class="kv" id="pc-stats"></div>
          </div>
          <div class="pane" data-p="pipe"><div class="pipe" id="pc-pipe"></div></div>
          <div class="pane" data-p="serial"><div class="log" id="pc-log"></div></div>
        </aside>
      </div>`);
    root.appendChild(L); tabs(L);
    const $ = (s) => L.querySelector(s);
    const log = logger($('#pc-log'));
    $('#pc-pipe').innerHTML = [
      ['1 · High-pass', 'FIR, N = 31', 'Differentiating HPF: −1/32 · z⁰, +1 · z⁷, −1 · z⁸, +1/32 · z¹⁵. Kills baseline wander, P/T waves and the QRS body; keeps the spike edges.'],
      ['2 · Derivative', 'N = 5 · ×1/8', 'H(z) = (2 + z⁻¹ − z⁻³ − 2z⁻⁴)/8. Emphasises slope. A pacing spike is far steeper than a QRS.'],
      ['3 · Squaring', '× 100', 'y = x² · 100. Positive-only, and it blows up the steep spike edges.'],
      ['4 · Moving window', 'N = 10 · 50 ms · ×25', 'Smooths the squared slope into a bump. Pan–Tompkins uses 150 ms; that would bury a spike this narrow.'],
      ['5 · Adaptive threshold', 'min 0.02 · max 0.80 · blank 4', 'SPKI/NPKI running estimates (1/8 · peak + 7/8 · old). thr = NPKI + ¼ (SPKI − NPKI). 400-sample init window. 4-sample blanking after a hit.'],
      ['Output', 'GP3 · GP22', 'GP3 goes high on a detection. GP22 is a timing flag raised while a sample is processed, for measuring latency on a scope.'],
    ].map((r) => `<div class="stagecard"><b>${r[0]}</b><i>${r[1]}</i><p>${r[2]}</p></div>`).join('');

    // ---- 3D Pico -------------------------------------------------------------------------------
    const S = g.Studio, MT = S.MAT;
    const st = makeStage($('#pc-stage'), { cam: [-4, 17, 21], target: [0, 0.5, 2.2], fov: 32, minDist: 10 });
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const mat = S.rbox(26, 0.5, 16, 0.8, 0.15, S.P(0xd9d5c8, { roughness: 0.95, envMapIntensity: 0.4 }), 'xz'); mat.position.set(0, 0.25, 2.5); st.scene.add(mat);
    const pico = new THREE.Group(); pico.position.y = 0.55; st.scene.add(pico);
    const addp = (m, x, y, z, p = pico) => { m.position.set(x, y, z); p.add(m); return m; };
    const bx = (w, h, d, m, x, y, z, p = pico) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.castShadow = true; return addp(o, x, y, z, p); };
    addp(S.rbox(15.6, 0.3, 6.2, 0.5, 0.06, S.P(0x0a4a28, { roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.6 }), 'xz'), 0, 0.15, 0);
    for (let i = 0; i < 20; i++) for (const z of [-2.95, 2.95]) { bx(0.46, 0.06, 0.5, MT.gold(), -7.05 + i * 0.74, 0.31, z); }
    bx(1.5, 0.85, 1.9, MT.can(), -7.2, 0.58, 0); bx(0.7, 0.2, 0.9, MT.softblack(), -8.0, 0.55, 0);
    bx(2.1, 0.3, 2.1, MT.chip(), 0.5, 0.45, 0.1); addp(S.decal(S.textTex('RP2040', 256, 96, '#9a9a9a', '600 40px "IBM Plex Mono", monospace'), 1.8, 0.7, 0.5, 0.61, 0.1, [-Math.PI / 2, 0, 0]), 0.5, 0.61, 0.1);
    bx(1.3, 0.2, 1.6, MT.chip(), 3.8, 0.42, -0.4);
    bx(0.9, 0.35, 0.9, S.P(0xeeeeee, { roughness: 0.5 }), -4.6, 0.5, 1.7);
    const onboard = bx(0.45, 0.14, 0.45, new THREE.MeshStandardMaterial({ color: 0x113311, emissive: 0x00aa33, emissiveIntensity: 0.6 }), -3.0, 0.38, -2.0);
    addp(S.decal(S.textTex('Raspberry Pi Pico', 512, 80, '#e8efe8', '500 34px "IBM Plex Sans", sans-serif'), 5.6, 0.9, -2.8, 0.62, 1.7, [-Math.PI / 2, 0, 0]), -2.8, 0.62, 1.7);
    // LED on a small stand, wired to GP3
    const ledMat = new THREE.MeshPhysicalMaterial({ color: 0x7a1010, emissive: 0xff1a1a, emissiveIntensity: 0.05, transparent: true, opacity: 0.93, roughness: 0.15, clearcoat: 1 });
    const ledG = new THREE.Group(); ledG.position.set(8.4, 0.5, 8.4); st.scene.add(ledG);
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.9, 28), ledMat); dome.position.y = 0.65; ledG.add(dome);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12, 0, 6.3, 0, 1.57), ledMat); top.position.y = 1.1; ledG.add(top);
    bx(1.2, 0.12, 1.2, ledMat, 0, 0.2, 0, ledG); bx(0.08, 1.2, 0.08, MT.aluLight(), -0.2, -0.1, 0, ledG); bx(0.08, 1.0, 0.08, MT.aluLight(), 0.2, -0.05, 0, ledG);
    const wr = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(-7.05 + 0.74 * 3 - 0.2, 0.9, 2.95), V3(-1, 2.6, 6), V3(8.2, 0.9, 8.4)]), 24, 0.07, 6), S.P(0xc4432a, { roughness: 0.5 })); wr.castShadow = true; st.scene.add(wr);
    let ledE = 0; st.onTick((dt) => { ledE = Math.max(0, ledE - dt * 6); ledMat.emissiveIntensity = 0.05 + ledE * 2.4; });
    S.callouts($('#pc-stage'), st, [
      { text: 'RP2040 · 133 MHz', pos: V3(0.5, 1.2, 0.1), side: 1, len: 90, dy: -52 },
      { text: 'Micro-USB', pos: V3(-7.4, 1.1, 0), side: -1, len: 50, dy: -30 },
      { text: 'BOOTSEL', pos: V3(-4.6, 1.0, 1.7), side: -1, len: 60, dy: 40 },
      { text: 'GP3 · pulse out', pos: V3(-7.05 + 0.74 * 3, 0.9, 2.95), side: -1, len: 50, dy: 70 },
      { text: 'Detection LED', pos: V3(8.4, 2.0, 8.4), side: 1, len: 40, dy: -10 },
    ]);

    // ---- simulation ---------------------------------------------------------------------------------
    const det = new PaceDetector(), ecg = new EcgSource();
    const N = 800, buf = { x: new Float32Array(N), hp: new Float32Array(N), mwi: new Float32Array(N), thr: new Float32Array(N), pace: new Float32Array(N), true: new Float32Array(N) };
    let head = 0, acc = 0, paused = false, injected = 0, detected = 0, falsePos = 0, lastTrue = -999, pend = [], hpMax = 0.05, mwiMax = 1;
    const bind = (id, key, fmt = (v) => v) => { const i = $('#' + id), o = $('#' + id + '-o'); const f = () => { ecg.opts[key] = +i.value; o.textContent = fmt(i.value); }; i.oninput = f; f(); };
    bind('pc-bpm', 'bpm', (v) => v + ' bpm'); bind('pc-spk', 'spike'); bind('pc-noise', 'noise'); bind('pc-wand', 'wander');
    $('#pc-paced').onchange = (e) => (ecg.opts.paced = e.target.checked);
    $('#pc-pause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? 'resume' : 'pause'; };
    $('#pc-reset').onclick = () => { det.reset(); injected = detected = falsePos = 0; log('[init] detector reset: 400-sample init window restarts', 'warn'); };
    log('Pacemaker Pulse Detection'); log('Authors: Henry Ahl & Sashank Vinnakota'); log('(simulation: synthetic ECG, ported pipeline)');

    function stepOne() {
      const s = ecg.sample(0.005), r = det.step(s.adc), i = head;
      buf.x[i] = r.x; buf.hp[i] = r.hp; buf.mwi[i] = r.mwi; buf.thr[i] = r.thr; buf.pace[i] = det.paceHigh ? 1 : 0; buf.true[i] = s.pulse ? 1 : 0;
      head = (head + 1) % N;
      hpMax = Math.max(hpMax * 0.9995, Math.abs(r.hp)); mwiMax = Math.max(mwiMax * 0.9995, r.mwi, r.thr * 1.5);
      if (!r.init) {
        if (s.pulse) { injected++; pend.push(0); }
        pend = pend.map((a) => a + 1).filter((a) => a < 30);
        if (r.detected) {
          detected++; ledE = 1; log(`Pacemaker pulse #${det.count} detected`, 'ok');
          if (pend.length) pend.shift(); else { falsePos++; }
        }
      }
      if (r.detected) { det.paceHigh = true; }
    }
    const cv = $('#pc-scope'), cx = cv.getContext('2d');
    const rows = [['ADC in  (÷4095)', 'x', '#16181c'], ['high-pass out', 'hp', '#3a4a7a'], ['MWI · threshold · SPKI', 'mwi', '#16181c'], ['GP3 detect  vs  true spike', 'pace', '#c4432a']];
    let raf, last = performance.now(), tick = 0;
    function draw() {
      const d = fitCanvas(cv), W = cv.width, H = cv.height; cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#f8f7f3'; cx.fillRect(0, 0, W, H);
      const rh = H / rows.length, pad = 18 * d;
      cx.font = `${11 * d}px "IBM Plex Mono", monospace`;
      rows.forEach((r, k) => {
        const y0 = k * rh, y1 = y0 + rh;
        cx.strokeStyle = 'rgba(22,24,28,.12)'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(0, y1); cx.lineTo(W, y1); cx.stroke();
        for (let gx = 0; gx < W; gx += W / 8) { cx.beginPath(); cx.moveTo(gx, y0); cx.lineTo(gx, y1); cx.stroke(); }
        cx.fillStyle = '#5a6478'; cx.fillText(r[0], 8 * d, y0 + 14 * d);
        const arr = buf[r[1]]; cx.strokeStyle = r[2]; cx.lineWidth = 1.5 * d; cx.beginPath();
        let lo = 0, hi = 1;
        if (r[1] === 'x') { lo = 0.32; hi = 0.78; } else if (r[1] === 'hp') { lo = -hpMax * 1.1; hi = hpMax * 1.1; } else if (r[1] === 'mwi') { lo = 0; hi = mwiMax * 1.1; } else { lo = -0.1; hi = 1.4; }
        const map = (v) => y1 - pad * 0.3 - ((v - lo) / (hi - lo)) * (rh - pad * 1.2);
        for (let i = 0; i < N; i++) { const v = arr[(head + i) % N], x = (i / (N - 1)) * W; i ? cx.lineTo(x, map(v)) : cx.moveTo(x, map(v)); }
        cx.stroke();
        if (r[1] === 'mwi') {                                                      // threshold + spki
          cx.strokeStyle = '#c4432a'; cx.lineWidth = 1.2 * d; cx.beginPath();
          for (let i = 0; i < N; i++) { const v = buf.thr[(head + i) % N], x = (i / (N - 1)) * W; i ? cx.lineTo(x, map(v)) : cx.moveTo(x, map(v)); } cx.stroke();
          cx.fillStyle = '#c4432a'; cx.fillText('threshold', W - 78 * d, y0 + 14 * d);
          if (!det.initDone) { cx.fillStyle = '#8a5a00'; cx.fillText(`init ${det.initCount}/400`, W - 150 * d, y0 + 30 * d); }
        }
        if (r[1] === 'pace') {                                                     // true spikes as ticks
          cx.strokeStyle = 'rgba(22,24,28,.35)'; cx.lineWidth = 1 * d; cx.beginPath();
          for (let i = 0; i < N; i++) if (buf.true[(head + i) % N]) { const x = (i / (N - 1)) * W; cx.moveTo(x, y0 + 22 * d); cx.lineTo(x, y1 - 4 * d); } cx.stroke();
        }
      });
    }
    function loop(now) {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!paused) { acc += dt * ($('#pc-slow').checked ? 0.25 : 1) * 200; while (acc >= 1) { stepOne(); acc -= 1; } }
      draw();
      if (++tick % 6 === 0) {
        $('#pc-stats').innerHTML = `<div><span>true spikes</span><b>${injected}</b></div><div><span>detected</span><b>${detected}</b></div><div><span>missed / false</span><b>${Math.max(0, injected - (detected - falsePos))} / ${falsePos}</b></div>
          <div><span>threshold</span><b>${det.thr.toFixed(3)}</b></div><div><span>SPKI / NPKI</span><b>${det.spki.toFixed(3)} / ${det.npki.toFixed(3)}</b></div><div><span>init window</span><b>${det.initDone ? 'done' : det.initCount + '/400'}</b></div>`;
      }
    }
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); st.dispose(); };
  }
  g.Labs.pace = { mount };
})(window);
