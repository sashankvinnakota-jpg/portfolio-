/* lab-wearable.js -- ESP32 wrist monitor: MPU-6050 + MAX30102 + SSD1306 + pulse sensor, FreeRTOS tasks. */
(function (g) {
  'use strict';
  const { M, box, html, canvasTex, makeStage, fitCanvas, logger, slider, tabs } = g.Lab;

  function mount(root) {
    root.innerHTML = '';
    const L = html(`
      <div class="lab-layout">
        <div class="stage-col">
          <div class="stage" id="wr-stage"><div class="stage-hint">the board tilts with the sliders · the OLED shows the firmware's own <code>showRawData()</code> screen</div></div>
          <div class="scope-wrap tall"><canvas id="wr-scope"></canvas></div>
        </div>
        <aside class="side">
          <div class="tabs"><button data-t="ctl" class="on">Sensors</button><button data-t="i2c">I²C bus</button></div>
          <div class="pane on" data-p="ctl">
            <div class="note"><b>Honest status:</b> like the real repo, this is in the <i>hardware bring-up</i> phase. It streams raw IMU / PPG / pulse values; heart-rate, SpO₂ and fall detection are the roadmap, so they are not faked here.</div>
            ${slider('tilt (pitch)', 'wr-pitch', -90, 90, 1, 0, '°')}
            ${slider('tilt (roll)', 'wr-roll', -90, 90, 1, 0, '°')}
            ${slider('shake', 'wr-shake', 0, 2, 0.05, 0, ' g')}
            ${slider('pulse (simulated wrist)', 'wr-bpm', 45, 150, 1, 68, ' bpm')}
            <label class="sw"><input type="checkbox" id="wr-finger" checked> <span>finger on the MAX30102</span></label>
            <div class="btnrow"><button id="wr-stall">stall the PPG task for 1 s</button></div>
            <div class="kv" id="wr-kv"></div>
          </div>
          <div class="pane" data-p="rtos"><div class="note">Two FreeRTOS tasks pinned to core 1 (priority 3) feed ring buffers; <code>loop()</code> runs at 2 Hz. From <code>README.md</code> / <code>board_config.h</code>.</div><div id="wr-rtos"></div></div>
          <div class="pane" data-p="i2c"><div class="note">One shared 400 kHz bus, guarded by a mutex (<code>i2c_manager</code>). The GY-521 already has 4.7 kΩ pull-ups.</div><div class="tbl" id="wr-i2c"></div></div>
          <div class="pane" data-p="serial"><div class="log" id="wr-log"></div></div>
        </aside>
      </div>`);
    root.appendChild(L); tabs(L);
    const $ = (s) => L.querySelector(s), log = logger($('#wr-log'));

    $('#wr-i2c').innerHTML = `<div class="row hd"><span>addr</span><span>device</span><span>pins</span></div>
      <div class="row"><span class="mono">0x3C</span><span>SSD1306 OLED 128×64</span><span class="mono">SDA 21 · SCL 22</span></div>
      <div class="row"><span class="mono">0x57</span><span>MAX30102 PPG</span><span class="mono">shared</span></div>
      <div class="row"><span class="mono">0x68</span><span>MPU-6050 (GY-521)<i>WHO_AM_I reads 0x70: it is really an MPU-6500 die, a common clone</i></span><span class="mono">shared</span></div>
      <div class="row"><span class="mono">ADC1-6</span><span>Pulse Sensor Amped</span><span class="mono">GPIO 34</span></div>
      <div class="row"><span class="mono">ADC1-7</span><span>LiPo divider (Phase 3, not wired)</span><span class="mono">GPIO 35</span></div>`;

    // ---- 3D ---------------------------------------------------------------------------------------
    const S3 = g.Studio, MT = S3.MAT, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const st = makeStage($('#wr-stage'), { cam: [-4, 20, 30], target: [0, 1.5, 0], fov: 32, minDist: 12, rotate: true });
    const rig = new THREE.Group(); rig.position.y = 2.2; st.scene.add(rig);
    const shellMats = [], shell = (m) => { m.transparent = true; shellMats.push(m); return m; };
    const add = (m, x, y, z, par = rig) => { m.position.set(x, y, z); par.add(m); return m; };
    const bx = (w, h, d, m, x, y, z, par) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.castShadow = true; return add(o, x, y, z, par); };
    // strap: two soft-black bands that curve down away from the case
    [-1, 1].forEach((s) => {
      const seg1 = add(S3.rbox(8, 0.7, 5.0, 0.8, 0.2, shell(S3.P(0x15171a, { roughness: 0.85, envMapIntensity: 0.4 })), 'xz'), s * 9.4, -0.3, 0);
      seg1.rotation.z = -s * 0.16;
      const seg2 = add(S3.rbox(7, 0.7, 5.0, 0.8, 0.2, shell(S3.P(0x15171a, { roughness: 0.85, envMapIntensity: 0.4 })), 'xz'), s * 15.6, -2.2, 0);
      seg2.rotation.z = -s * 0.5;
      for (let i = 0; i < 4; i++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.8, 12), MT.softblack()), s * (s > 0 ? 12.6 + i * 0.9 : 12.6 + i * 0.9), -1.7 - i * 0.55, 0).visible = false;
    });
    const caseM = add(S3.rbox(12.4, 2.6, 10, 3.0, 0.5, shell(MT.alu()), 'xz'), 0, 0.9, 0);
    const bezel = add(S3.rbox(10.6, 0.3, 8.2, 2.4, 0.1, shell(MT.softblack()), 'xz'), 0, 2.15, 0);
    const oled = canvasTex(256, 128); oled.tex.encoding = THREE.sRGBEncoding;
    const oledScr = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), new THREE.MeshBasicMaterial({ map: oled.tex, toneMapped: false }));
    oledScr.rotation.x = -Math.PI / 2; add(oledScr, 0, 2.32, 0);
    const crown = add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.7, 24), MT.accent()), 0, 1.1, 5.35); crown.rotation.x = Math.PI / 2; crown.castShadow = true;
    // underside sensor window (glows with the PPG LEDs)
    const win = add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.15, 36), S3.P(0x180606, { roughness: 0.15, clearcoat: 1 })), 0, -0.45, 0);
    const ppgLed = add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 20), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xff2020, emissiveIntensity: 1 })), 0, -0.55, 0);
    // inside: the real parts
    const inner = new THREE.Group(); inner.visible = false; rig.add(inner);
    add(S3.rbox(8.6, 0.16, 5.6, 0.3, 0.04, MT.chip(), 'xz'), -1.4, 0.8, 0.2, inner); bx(3.2, 0.45, 2.6, MT.can(), -2.6, 1.15, 0.2, inner);
    for (let i = 0; i < 16; i++) { bx(0.16, 0.14, 0.16, MT.gold(), -5.0 + i * 0.5, 0.9, 2.95, inner); bx(0.16, 0.14, 0.16, MT.gold(), -5.0 + i * 0.5, 0.9, -2.55, inner); }
    add(S3.rbox(3.2, 0.14, 2.2, 0.15, 0.03, MT.pcbBlue(), 'xz'), 3.6, 0.8, 2.6, inner); bx(0.9, 0.2, 0.9, MT.chip(), 3.6, 0.98, 2.6, inner);
    add(S3.rbox(2.6, 0.14, 2.0, 0.15, 0.03, S3.P(0x7a1010, { roughness: 0.5 }), 'xz'), 3.6, 0.8, -2.4, inner); bx(1.1, 0.2, 1.1, MT.chip(), 3.6, 0.98, -2.4, inner);
    add(S3.rbox(1.8, 0.14, 1.6, 0.15, 0.03, MT.pcb(), 'xz'), 0, 0.2, 0, inner);
    const dot = add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0x113311, emissive: 0x00ff55, emissiveIntensity: 0.3 })), 0, 0.32, 0, inner);
    let xr = 0, xrT = 0;
    S3.callouts($('#wr-stage'), st, [
      { text: 'SSD1306 OLED', pos: V3(3.4, 2.35, -1.6), obj: rig, side: 1, len: 60, dy: -40, visible: () => xr < 0.5 },
      { text: 'Crown / button', pos: V3(0, 1.1, 5.9), obj: rig, side: 1, len: 50, dy: 30, visible: () => xr < 0.5 },
      { text: 'PPG sensor window', pos: V3(0, -0.55, 0), obj: rig, side: -1, len: 60, dy: 50, visible: () => xr < 0.5 },
      { text: 'ESP32 dev board', pos: V3(-2.6, 1.4, 0.2), obj: rig, side: -1, len: 70, dy: -40, visible: () => xr >= 0.5 },
      { text: 'MPU-6050', pos: V3(3.6, 1.0, 2.6), obj: rig, side: 1, len: 60, dy: 40, visible: () => xr >= 0.5 },
      { text: 'MAX30102', pos: V3(3.6, 1.0, -2.4), obj: rig, side: 1, len: 60, dy: -30, visible: () => xr >= 0.5 },
      { text: 'Pulse sensor', pos: V3(0, 0.4, 0), obj: rig, side: -1, len: 60, dy: 60, visible: () => xr >= 0.5 },
    ]);
    const tools = document.createElement('div'); tools.className = 'stage-tools'; tools.innerHTML = '<button>Inside</button>'; $('#wr-stage').appendChild(tools);
    tools.firstChild.onclick = (e) => { xrT = xrT ? 0 : 1; e.target.classList.toggle('on', !!xrT); e.target.textContent = xrT ? 'Outside' : 'Inside'; };
    st.onTick(() => { xr += (xrT - xr) * 0.12; shellMats.forEach((m) => { m.opacity = 1 - 0.88 * xr; m.depthWrite = xr < 0.04; }); inner.visible = xr > 0.02; });

    // ---- simulation state -----------------------------------------------------------------------------
    const S = { pitch: 0, roll: 0, shake: 0, bpm: 68, finger: true, stallUntil: 0, t: 0, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, red: 0, ir: 0, pulse: 2048, up: 0,
      state: 'BOOT', imuN: 0, ppgN: 0, fifo: 0, drained: 0, overflow: 0, ringI: 0, ringP: 0, ringU: 0, phase: 0, health: { imu: true, ppg: true, pulse: true } };
    const hist = { ax: [], ay: [], az: [], ir: [], pl: [] }, HN = 400;
    ['pitch', 'roll', 'shake', 'bpm'].forEach((k) => { const i = $('#wr-' + k), o = $('#wr-' + k + '-o'), u = { pitch: '°', roll: '°', shake: ' g', bpm: ' bpm' }[k]; i.oninput = () => { S[k] = +i.value; o.textContent = i.value + u; }; });
    $('#wr-finger').onchange = (e) => (S.finger = e.target.checked);
    $('#wr-stall').onclick = () => { S.stallUntil = performance.now() + 1000; log('[ppg ] (sim) task stalled for 1 s -- FIFO will overflow at 32 samples', 'warn'); };

    // boot sequence, as in setup()
    const boot = [[0, 'BOOT', '[boot] Wearable Monitor 0.1.0-dev'], [300, 'INIT_HW', '[i2c ] I2CManager::begin() 400 kHz, mutex ok'], [500, 'INIT_HW', '[i2c ] scan: 0x3C 0x57 0x68'],
      [700, 'INIT_HW', '[OLED] OK at 0x3C -- 128x64'], [900, 'INIT_HW', '[imu ] WHO_AM_I = 0x70 (MPU-6500 die, accepted)'], [1100, 'INIT_HW', '[ppg ] MAX30102 part id 0x15, 100 sps'],
      [1300, 'INIT_HW', '[task] IMU task @100 Hz, PPG task @20 Hz, core 1'], [3800, 'STREAM_RAW', '[app ] -> STREAM_RAW']];
    const t0 = performance.now(); let bi = 0;

    const sc = $('#wr-scope'), cx = sc.getContext('2d');
    let raf, last = performance.now(), acc10 = 0, acc50 = 0, acc500 = 0, rotP = 0, rotR = 0;
    function physics(dt) {
      S.t += dt; S.up = performance.now() - t0;
      const p = S.pitch * Math.PI / 180, r = S.roll * Math.PI / 180;
      const sh = S.shake * (Math.sin(S.t * 41) + 0.6 * Math.sin(S.t * 67 + 1));
      S.ax = -Math.sin(p) + sh * 0.5 + (Math.random() - 0.5) * 0.006; S.ay = Math.sin(r) * Math.cos(p) + sh * 0.35 + (Math.random() - 0.5) * 0.006; S.az = Math.cos(r) * Math.cos(p) + sh * 0.25 + (Math.random() - 0.5) * 0.006;
      S.gx = (S.ay - (hist.ay[hist.ay.length - 1] || 0)) * 100 * 8; S.gy = (S.ax - (hist.ax[hist.ax.length - 1] || 0)) * 100 * 8; S.gz = S.shake * 30 * Math.sin(S.t * 20);
      // PPG: ~ finger -> ~55k counts with a pulsatile component; no finger -> ~ 3k
      const f = S.bpm / 60; S.phase += dt * f;
      const ph = S.phase % 1, wave = Math.exp(-((ph - 0.12) ** 2) / 0.004) + 0.45 * Math.exp(-((ph - 0.45) ** 2) / 0.01);
      S.ir = S.finger ? 52000 + 1800 * wave + 5000 * Math.sin(S.t * 0.2) + (Math.random() - 0.5) * 120 : 1800 + Math.random() * 60;
      S.red = S.finger ? 47000 + 900 * wave + (Math.random() - 0.5) * 100 : 1500 + Math.random() * 60;
      S.pulse = Math.round(2000 + 700 * wave + 90 * Math.sin(S.t * 0.3) + (Math.random() - 0.5) * 20);
    }
    function pushRing(arr, v) { arr.push(v); if (arr.length > HN) arr.shift(); }
    function imuTask() { S.imuN++; S.ringI = Math.min(200, S.ringI + 1); S.ringU = Math.min(200, S.ringU + 1); pushRing(hist.ax, S.ax); pushRing(hist.ay, S.ay); pushRing(hist.az, S.az); pushRing(hist.pl, S.pulse); }
    function ppgSample() { S.fifo++; if (S.fifo > 32) { S.fifo = 32; S.overflow++; if (S.overflow % 8 === 1) log('[ppg ] FIFO overflow -- samples lost (task not draining fast enough)', 'err'); } }
    function ppgTask() { if (performance.now() < S.stallUntil) return; const n = S.fifo; S.fifo = 0; S.drained += n; S.ppgN++; S.ringP = Math.min(200, S.ringP + n); }
    function ppgBackfill() { pushRing(hist.ir, S.ir); }
    function oledDraw() {
      const c = oled.ctx; c.fillStyle = '#000'; c.fillRect(0, 0, 256, 128); c.fillStyle = '#9fe9ff'; c.font = '16px "IBM Plex Mono", monospace'; c.textBaseline = 'top';
      const lines = S.state === 'BOOT' ? ['Wearable Monitor', '0.1.0-dev', '', 'Initializing...']
        : S.state === 'INIT_HW' ? ['Sensor Status:', '', 'IMU  (MPU6050): OK', 'PPG  (MAX30102):OK', 'DISP (SSD1306): OK', 'Pulse Sensor:  OK']
        : [`ACC  ${Math.hypot(S.ax, S.ay, S.az).toFixed(3)}g`, `RED  ${Math.round(S.red)}`, `IR   ${Math.round(S.ir)}`, `PLS  ${S.pulse}`, `UP   ${Math.floor(S.up / 1000)}s`];
      lines.forEach((l, i) => c.fillText(l, 4, 4 + i * 20)); oled.tex.needsUpdate = true;
    }
    function draw() {
      const d = fitCanvas(sc), W = sc.width, H = sc.height; cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#f8f7f3'; cx.fillRect(0, 0, W, H);
      const rows = [['MPU-6050 accel (g)  ·  x  y  z', [['ax', '#c4432a'], ['ay', '#2f7d4f'], ['az', '#16181c']], -2, 2], ['MAX30102 IR (raw counts)', [['ir', '#8a5a00']], 40000, 62000], ['Pulse Sensor Amped (ADC, GPIO 34)', [['pl', '#5b3fa0']], 1000, 3200]], rh = H / rows.length;
      cx.font = `${11 * d}px "IBM Plex Mono", monospace`;
      rows.forEach((r, k) => {
        const y0 = k * rh, y1 = y0 + rh; cx.strokeStyle = 'rgba(22,24,28,.14)'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(0, y1); cx.lineTo(W, y1); cx.stroke();
        cx.fillStyle = '#5a6478'; cx.fillText(r[0], 8 * d, y0 + 14 * d);
        r[1].forEach(([key, col]) => {
          const a = hist[key]; if (!a.length) return; cx.strokeStyle = col; cx.lineWidth = 1.4 * d; cx.beginPath();
          a.forEach((v, i) => { const x = (i / (HN - 1)) * W, y = y1 - 8 * d - ((Math.max(r[2], Math.min(r[3], v)) - r[2]) / (r[3] - r[2])) * (rh - 30 * d); i ? cx.lineTo(x, y) : cx.moveTo(x, y); }); cx.stroke();
        });
      });
    }
    function loop(now) {
      raf = requestAnimationFrame(loop); const dt = Math.min(0.1, (now - last) / 1000); last = now;
      while (bi < boot.length && now - t0 >= boot[bi][0]) { S.state = boot[bi][1]; log(boot[bi][2]); bi++; }
      physics(dt); acc10 += dt; acc50 += dt; acc500 += dt;
      while (acc10 >= 0.01) { acc10 -= 0.01; if (S.state === 'STREAM_RAW' || S.state === 'INIT_HW') { imuTask(); ppgSample(); ppgBackfill(); } }
      while (acc50 >= 0.05) { acc50 -= 0.05; ppgTask(); }
      while (acc500 >= 0.5) { acc500 -= 0.5; oledDraw(); if (S.state === 'STREAM_RAW') log(`[app ] acc=${Math.hypot(S.ax, S.ay, S.az).toFixed(3)}g red=${Math.round(S.red)} ir=${Math.round(S.ir)} pls=${S.pulse}`); }
      rotP += (S.pitch * Math.PI / 180 - rotP) * 0.2; rotR += (S.roll * Math.PI / 180 - rotR) * 0.2; rig.rotation.z = rotP * 0.7; rig.rotation.x = rotR * 0.7;
      ppgLed.material.emissiveIntensity = S.finger ? 0.5 + 0.5 * Math.sin(S.t * 14) ** 2 : 0.15; dot.material.emissiveIntensity = 0.2 + (S.pulse - 2000) / 900;
      draw();
      $('#wr-kv').innerHTML = `<div><span>app state</span><b>${S.state}</b></div><div><span>accel |a|</span><b>${Math.hypot(S.ax, S.ay, S.az).toFixed(3)} g</b></div><div><span>IR / RED</span><b>${Math.round(S.ir)} / ${Math.round(S.red)}</b></div><div><span>PPG FIFO</span><b>${S.fifo} / 32${S.overflow ? ' · overflows ' + S.overflow : ''}</b></div>`;
      const bar = (v, m) => `<div class="bar"><i style="width:${(v / m) * 100}%"></i></div>`;
      $('#wr-rtos').innerHTML = `<div class="stagecard"><b>IMU task · 100 Hz</b><i>${S.imuN} ticks</i>${bar(S.ringI, 200)}<p>ring buffer ${S.ringI}/200 (2 s of history)</p></div>
        <div class="stagecard"><b>PPG task · 20 Hz</b><i>${S.ppgN} runs · ${S.drained} samples drained</i>${bar(S.fifo, 32)}<p>MAX30102 FIFO ${S.fifo}/32 @ 100 sps: it must be drained every ~320 ms or samples are lost.</p></div>
        <div class="stagecard"><b>loop() · 2 Hz</b><i>${S.state}</i><p>heartbeat, display refresh, state transitions: BOOT → INIT_HW → STREAM_RAW.</p></div>`;
    }
    raf = requestAnimationFrame(loop);
    log('(simulation of the firmware described in README.md)');
    return () => { cancelAnimationFrame(raf); st.dispose(); };
  }
  g.Labs.wearable = { mount };
})(window);
