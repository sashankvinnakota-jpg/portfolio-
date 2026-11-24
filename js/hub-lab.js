/* hub-lab.js -- 3D ESP32-S3 Smart Hub + simulated laptop backend. Runs js/hub-core.js. */
(function (global) {
  'use strict';
  const { C } = global.HubConst;

  // ===========================================================================
  //  Simulated laptop (what hub_client.py + providers/ do, minus the real world)
  // ===========================================================================
  const TRACKS = [
    ['Midnight Bus', 'The Rail Yard', 'Night Shift'], ['Solder Fumes', 'Reflow Club', 'Hot Air'],
    ['Pull-up Resistor', 'Open Drain', 'Idle High'], ['Brownout', 'Low Dropout', 'Rail to Rail'],
  ];
  const NOTIFS = [
    ['Calendar', 'Design review in 15 min', 'Room 3, bring the PCB'], ['Claude', 'Your answer is ready', 'The build finished with 0 warnings'],
    ['Mail', 'Lab report graded', 'Open the portal for your score'], ['GitHub', 'Push to esp32-smart-hub', 'wroom32: pin map updated'],
  ];
  const STOCKS = { AAPL: 227.4, NVDA: 141.8, MSFT: 418.2, TSLA: 335.9, AMD: 139.6, GOOGL: 171.3 };
  const CANNED = {
    'what should I cook tonight': ['Try a one-pan chickpea curry.', 'Onion, garlic, tomatoes, spices; 25 min.'],
    'summarise my unread email': ['3 unread: a lab grade, a calendar invite, a newsletter.', '(simulated answer)'],
    'what is on my calendar today': ['Design review at 3:00 PM, then lab until 6.', '(simulated answer)'],
    'give me one interesting fact': ['Octopuses have three hearts.', 'Two pump blood to the gills.'],
    'what should I work on next': ['Finish the wake-word threshold tuning.', 'It blocks the voice demo.'],
  };

  class LaptopSim {
    constructor(fw, log) {
      this.fw = fw; this.log = log; this.running = true; this.bonded = true; this.connected = false;
      this.connectAt = 0; this.encAt = 0; this.clockOffsetMin = 0; this.notifN = 0; this.asked = 0;
      this.track = 0; this.state = 'playing'; this.vol = 50; this.stocks = { ...STOCKS }; this.pct = {};
      Object.keys(STOCKS).forEach((s) => (this.pct[s] = ((Math.random() - 0.4) * 2).toFixed(2)));
      this.lastPush = 0; this.lastStock = 0; this.lastClock = '';
      this.lastAttemptLog = 0;
    }
    emit(obj) { Object.entries(obj).forEach(([k, v]) => this.fw.recvLine(`${k}=${v}`)); }
    clockStr() {
      const d = new Date(Date.now() + this.clockOffsetMin * 60000);
      return { t: d.toTimeString().slice(0, 5), nice: d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).replace(',', '') };
    }
    pushMedia() {
      const t = TRACKS[this.track];
      this.emit({ 'MEDIA.STATE': this.state, 'MEDIA.TITLE': t[0], 'MEDIA.ARTIST': t[1], 'MEDIA.ALBUM': t[2], 'MEDIA.APP': 'Spotify' });
    }
    pushStocks() {
      Object.keys(this.stocks).forEach((s) => {
        this.emit({ [`STOCK.${s}`]: this.stocks[s].toFixed(2), [`STOCK.${s}.PCT`]: (this.pct[s] > 0 ? '+' : '') + this.pct[s] });
      });
    }
    pushAll() {
      this.fw.recvLine('$SYNC');
      const c = this.clockStr();
      this.emit({ 'CLOCK.TIME': c.t, 'CLOCK.NICE': c.nice, 'WX.PLACE': 'Home', 'WX.TEMPC': '14.2', 'WX.COND': 'Partly cloudy', 'WX.MAXC': '16', 'WX.MINC': '7' });
      this.pushMedia(); this.pushStocks();
      Object.keys(CANNED).forEach((p, i) => this.emit({ [`CLAUDE.P${i + 1}`]: p }));
      if (this.notifN) this.pushNotif(this.notifN - 1, false);
      this.log('[sync] pushed all providers');
      this.fw.recvLine('$END');
    }
    pushNotif(i, count = true) {
      const n = NOTIFS[i % NOTIFS.length]; if (count) this.notifN++;
      this.emit({ 'NOTIF.APP': n[0], 'NOTIF.TITLE': n[1], 'NOTIF.BODY': n[2], 'NOTIF.COUNT': this.notifN });
      if (count) this.log(`[notify] ${n[0]}: ${n[1]}`);
    }
    sendNotification() { this.pushNotif(this.notifN); }
    onFrame(line) {
      let m;
      if (line === '$SYNC?') { this.pushAll(); return; }
      if ((m = line.match(/^\$CMD (\S+)/))) {
        const c = m[1];
        if (c === 'MEDIA.PLAYPAUSE') this.state = this.state === 'playing' ? 'paused' : 'playing';
        else if (c === 'MEDIA.PLAY') this.state = 'playing';
        else if (c === 'MEDIA.PAUSE') this.state = 'paused';
        else if (c === 'MEDIA.NEXT') { this.track = (this.track + 1) % TRACKS.length; this.state = 'playing'; }
        else if (c === 'MEDIA.PREV') { this.track = (this.track + TRACKS.length - 1) % TRACKS.length; this.state = 'playing'; }
        else if (c === 'MEDIA.STOP') this.state = 'paused';
        else if (c === 'MEDIA.VOLUP') this.vol = Math.min(100, this.vol + 5);
        else if (c === 'MEDIA.VOLDOWN') this.vol = Math.max(0, this.vol - 5);
        else if (c === 'MEDIA.MUTE') this.vol = 0;
        this.log(`[media] ${c} -> ${this.state} track "${TRACKS[this.track][0]}" vol ${this.vol}`);
        this.pushMedia(); return;
      }
      if ((m = line.match(/^\$ASK (\d+) (\S+)(?: (.*))?$/))) {
        const id = m[1], cap = m[2], q = (m[3] || '').trim();
        this.log(`[ask] #${id} ${cap} "${q}"`);
        setTimeout(() => this.fw.recvLine(`$PROG ${id} thinking`), 500);
        setTimeout(() => {
          const ans = CANNED[q] || ['(simulated) I would answer: ' + q.toLowerCase() + '?', 'The real hub asks Claude here.'];
          this.asked++;
          ans.forEach((l, i) => this.fw.recvLine(`$ANL ${id} ${i} ${l}`));
          this.fw.recvLine(`$ANS ${id} ok Claude`);
          this.emit({ 'CLAUDE.ASKED': q.slice(0, 40), 'CLAUDE.LAST': ans[0].slice(0, 96), 'CLAUDE.COUNT': this.asked });
        }, 1900);
      }
    }
    tick(now) {
      const fw = this.fw;
      // --- connection supervisor: scan -> connect -> pair -> session -> repeat ---
      if (this.connected && fw.linkState !== 'ACTIVE' && fw.linkState !== 'LINKED') { this.connected = false; this.log('[link] lost -- scanning again'); }
      if (this.running && !this.connected && !this.connectAt && (fw.linkState === 'ADVERTISING' || fw.linkState === 'PAIRING')) {
        const pairing = fw.linkState === 'PAIRING';
        if (pairing || (fw.bonded && this.bonded)) this.connectAt = now + (pairing ? 1500 : 2500);
        else if (now - this.lastAttemptLog > 6000) {
          this.lastAttemptLog = now;
          if (!fw.bonded && this.bonded) this.log('[sec] auth failed: bond desync (hub forgot, laptop remembers). Run hub_client.py --forget, then short-press PAIR.');
          else this.log('[link] hub found but no bond -- SHORT PRESS the PAIR button');
        }
      }
      if (this.connectAt && now >= this.connectAt) {
        this.connectAt = 0;
        if (this.running && fw.peerConnect()) { this.connected = true; this.encAt = now + 700; } else this.connected = false;
      }
      if (this.encAt && now >= this.encAt) {
        this.encAt = 0; fw.peerEncrypted(); this.bonded = true; this.pushAll(); this.lastPush = now;
      }
      if (!this.connected || !fw.linkUsable()) return;
      // --- providers ---
      const c = this.clockStr();
      if (c.t !== this.lastClock) { this.lastClock = c.t; this.emit({ 'CLOCK.TIME': c.t, 'CLOCK.NICE': c.nice }); }
      if (now - this.lastStock > 5000) {
        this.lastStock = now;
        const s = Object.keys(this.stocks)[Math.floor(Math.random() * 6)];
        const step = (Math.random() - 0.5) * 0.9; this.stocks[s] += step; this.pct[s] = (+this.pct[s] + step / this.stocks[s] * 100).toFixed(2);
        this.pushStocks();
      }
      if (!this.autoN && now - this.lastPush > 30000) { this.autoN = 1; this.sendNotification(); }
    }
  }

  // ===========================================================================
  //  The lab
  // ===========================================================================
  const PINS = [
    [0, 'BOOT button (on-board)', 'PAIR', 'boot', 'short = pair window, 3 s = erase bonds'],
    [4, 'Tactile switch', 'MEDIA', 'MEDIA', '1x play/pause, 2x next, 3x prev'],
    [5, 'Tactile switch', 'UP', 'UP', 'auto-repeats when held'],
    [6, 'Tactile switch', 'DOWN', 'DOWN', 'auto-repeats when held'],
    [7, 'Tactile switch', 'SELECT', 'SELECT', 'hold = back out / resync'],
    [8, 'Tactile switch', 'LEFT', 'LEFT', 'previous app / back out of a menu'],
    [9, 'Tactile switch', 'RIGHT', 'RIGHT', 'next app / space in the wheel'],
    [10, 'ILI9341', 'TFT_CS', 'tft', 'SPI chip select'], [11, 'ILI9341', 'TFT_MOSI', 'tft', 'SPI data'],
    [12, 'ILI9341', 'TFT_SCLK', 'tft', 'SPI clock, 27 MHz'], [14, 'ILI9341', 'TFT_DC', 'tft', 'data/command'],
    [15, 'INMP441', 'SCK', 'mic', 'I2S bit clock'], [16, 'INMP441', 'WS', 'mic', 'I2S word select, 16 kHz'],
    [17, 'INMP441', 'SD', 'mic', 'I2S data in, 24-bit'], [21, 'ILI9341', 'TFT_RST', 'tft', 'reset'],
    [3, 'MAX98357A', 'BCLK', 'amp', 'alarm speaker, I2S1'], [18, 'MAX98357A', 'LRC', 'amp', 'alarm speaker'], [38, 'MAX98357A', 'DIN', 'amp', 'alarm speaker'],
  ];

  function mount(root, ctxApi) {
    const el = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstChild; };
    root.innerHTML = '';
    const layout = el(`
      <div class="lab-layout">
        <div class="stage-col">
          <div class="stage" id="hub-stage"><div class="tip" id="hub-tip"></div><div class="stage-hint">drag to orbit · scroll to zoom · press the keys · Inside shows the parts</div></div>
          <div class="keyrow" id="hub-keys">
            <div class="dpad">
              <button data-b="UP" class="k up">▲</button><button data-b="LEFT" class="k left">◀</button>
              <button data-b="SELECT" class="k sel">SEL</button><button data-b="RIGHT" class="k right">▶</button><button data-b="DOWN" class="k down">▼</button>
            </div>
            <div class="extra"><button data-b="MEDIA" class="k pill">MEDIA</button><button data-b="BOOT" class="k pill">BOOT / PAIR</button></div>
            <div class="kbd">keys: arrows · Enter = SELECT (hold) · M = MEDIA · B = BOOT</div>
          </div>
        </div>
        <aside class="side">
          <div class="tabs" id="hub-tabs">
            <button data-t="try" class="on">Try it</button><button data-t="serial">Serial</button><button data-t="state">State</button><button data-t="laptop">Laptop</button>
          </div>
          <div class="pane" data-p="serial"><div class="log" id="hub-log"></div>
            <form id="hub-cmdform" class="cmd"><span>&gt;</span><input id="hub-cmd" placeholder="type: help, hw, keys, btn, next, sync" autocomplete="off" spellcheck="false"></form></div>
          <div class="pane" data-p="state"><div class="note">The hub's whole model of the world. <b>$SYNC</b> clears only <span class="chip remote">remote</span> keys; <span class="chip local">local</span> and <span class="chip config">config</span> are out of the wire's reach.</div><div class="tbl" id="hub-store"></div></div>
          <div class="pane" data-p="pins"><div class="note">Click a row to light up that part on the board. Pins come from <code>HANDBOOK/02-hardware-and-pinout.md</code>.</div><div class="tbl" id="hub-pins"></div></div>
          <div class="pane" data-p="laptop" id="hub-laptop"></div>
          <div class="pane on" data-p="try"><ol class="try">
            <li><b>Navigate.</b> Press RIGHT to move between the 7 apps. On MEDIA, press DOWN to drop into the list, SELECT to run a row.</li>
            <li><b>Triple-click MEDIA.</b> 1x play/pause, 2x next, 3x previous, with the 320 ms click window from <code>input.cpp</code>.</li>
            <li><b>Ask Claude.</b> Go to CLAUDE, press SELECT, pick a row. Or pick <i>Type a question…</i> and use the character wheel: UP/DOWN letter, SELECT add, RIGHT space, hold SELECT send.</li>
            <li><b>Set an alarm.</b> Go to ALARM, SELECT, edit hour/minute/on-off, SELECT to save. Then on the <i>Laptop</i> tab press “ring the alarm in 1 minute”.</li>
            <li><b>Break the link.</b> Hold BOOT 3 s to erase bonds. The hub and the laptop now disagree. That's the bond-desync trap from the README.</li>
            <li><b>Power-cycle.</b> The clock is lost (no RTC) but the alarm survives (NVS).</li>
          </ol></div>
        </aside>
      </div>`);
    root.appendChild(layout);
    const $ = (s) => layout.querySelector(s);

    // ---- firmware + laptop ---------------------------------------------------------
    const logEl = $('#hub-log');
    const addLog = (s) => {
      const d = document.createElement('div');
      const m = s.match(/^(\[\w+\s*\])/);
      d.className = 'l ' + (s.startsWith('>') ? 'cmd' : /refused|STORE FULL|auth failed|rejected|ignored/.test(s) ? 'err' : s.startsWith('[alrm]') ? 'warn' : '');
      d.textContent = s; logEl.appendChild(d);
      while (logEl.childElementCount > 300) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    };
    let audio;
    const beep = () => {
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        [880, 1175].forEach((f, i) => {
          const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = f; o.type = 'square';
          g.gain.value = 0.04; o.connect(g); g.connect(audio.destination);
          const t = audio.currentTime + i * 0.15; o.start(t); o.stop(t + 0.12);
        });
      } catch (e) {}
    };
    let laptop;
    const fw = new global.HubFirmware({ onLog: addLog, onSend: (l) => laptop && laptop.onFrame(l), onBeep: beep });
    laptop = new LaptopSim(fw, addLog);
    const t0 = performance.now();
    fw.begin(0);

    // ---- laptop pane --------------------------------------------------------------------
    const lp = $('#hub-laptop');
    lp.innerHTML = `
      <div class="note">This stands in for <code>hub_client.py</code> and its providers. Real weather, media and Claude answers need the real laptop; here they are scripted.</div>
      <label class="sw"><input type="checkbox" id="lp-run" checked> <span>laptop client running</span></label>
      <div class="btnrow">
        <button id="lp-notif">send a notification</button>
        <button id="lp-alarm">ring the alarm in 1 minute</button>
        <button id="lp-forget">laptop: --forget bond</button>
        <button id="lp-power">power-cycle the hub</button>
      </div>
      <div class="kv" id="lp-status"></div>`;
    lp.querySelector('#lp-run').onchange = (e) => {
      laptop.running = e.target.checked;
      if (!laptop.running) { laptop.connected = false; laptop.connectAt = 0; addLog('[laptop] client closed'); fw.peerDisconnect('laptop client closed'); }
      else addLog('[laptop] client started -- scanning');
    };
    lp.querySelector('#lp-notif').onclick = () => laptop.connected ? laptop.sendNotification() : addLog('[laptop] not connected');
    lp.querySelector('#lp-alarm').onclick = () => {
      const a = fw.al;
      if (!a.on) { addLog('[laptop] set an alarm first (ALARM app → SELECT → turn it ON → SELECT)'); return; }
      const target = a.h * 60 + a.m, d = new Date();
      laptop.clockOffsetMin = (target - 1) - (d.getHours() * 60 + d.getMinutes());
      const c = laptop.clockStr(); laptop.lastClock = ''; addLog(`[laptop] clock now reads ${c.t}; alarm in about a minute`);
      if (laptop.connected) laptop.tick(performance.now() - t0);
    };
    lp.querySelector('#lp-forget').onclick = () => { laptop.bonded = false; addLog('[laptop] hub_client.py --forget (laptop bond erased)'); };
    lp.querySelector('#lp-power').onclick = () => {
      addLog('[power] hub unplugged and plugged back in'); laptop.connected = false; laptop.connectAt = 0; laptop.encAt = 0;
      fw.reset(performance.now() - t0);
    };

    // ---- state + pins panes -----------------------------------------------------------------
    const storeEl = $('#hub-store'), seen = {};
    const pinsEl = $('#hub-pins');
    pinsEl.innerHTML = '<div class="row hd"><span>GPIO</span><span>part · function</span></div>' +
      PINS.map((p, i) => `<div class="row pin" data-i="${i}"><span class="mono">${p[0]}</span><span>${p[1]} · <b>${p[2]}</b><i>${p[4]}</i></span></div>`).join('');
    function paintStore() {
      const rows = fw.store.entries();
      storeEl.innerHTML = `<div class="row hd"><span>key</span><span>value</span><span>owner</span></div>` + rows.map((e) => {
        const flash = seen[e.k] !== undefined && seen[e.k] !== e.v ? ' flash' : '';
        seen[e.k] = e.v;
        return `<div class="row${flash}"><span class="mono">${e.k}</span><span class="v">${e.v.replace(/</g, '&lt;')}</span><span class="chip ${e.owner}">${e.owner}</span></div>`;
      }).join('') + `<div class="row ft"><span>${rows.length} / 96 keys</span></div>`;
    }

    // ---- tabs ---------------------------------------------------------------------------------
    layout.querySelectorAll('#hub-tabs button').forEach((b) => (b.onclick = () => {
      layout.querySelectorAll('#hub-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      layout.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.p === b.dataset.t));
    }));
    $('#hub-cmdform').onsubmit = (e) => { e.preventDefault(); const i = $('#hub-cmd'); if (i.value.trim()) fw.console(i.value); i.value = ''; };

    // ===========================================================================
    //  three.js scene
    // ===========================================================================
    const stage = $('#hub-stage'), tip = $('#hub-tip');
    const S = global.Studio, MT = S.MAT;
    const studio = S.makeStudio(stage, { cam: [-5, 15, 41], target: [0, 6.2, 0], fov: 30, rotate: false, minDist: 16, maxDist: 70, exposure: 1.05 });
    const scene = studio.scene, camera = studio.camera, controls = studio.controls, renderer = studio.renderer;
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const parts = {}, pickables = [];
    const reg = (name, obj, label) => { parts[name] = obj; obj.traverse((o) => { o.userData.part = name; o.userData.label = label; }); pickables.push(obj); };
    const add = (m, x, y, z, parent = scene) => { m.position.set(x, y, z); parent.add(m); return m; };
    const bx = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; return add(m, x, y, z, parent); };

    // ---- shell: machined aluminium plinth + tilted display housing ----------------------------------------
    const shellMats = [];
    const shell = (m) => { m.transparent = true; shellMats.push(m); return m; };
    const plinth = add(S.rbox(24, 3.2, 11, 1.7, 0.4, shell(MT.alu()), 'xz'), 0, 1.6, 0);
    const scr = new THREE.Group(); scr.position.set(0, 3.0, -3.7); scr.rotation.x = -0.17; scene.add(scr);
    const bezel = add(S.rbox(17.6, 12.8, 1.8, 1.5, 0.35, shell(MT.softblack()), 'xy'), 0, 6.4, 0, scr);
    const sT = S.screenTex(640, 480), sctx = sT.ctx, screenTex = sT.tex;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(13.8, 10.35), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
    add(screen, 0, 6.6, 0.915, scr);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(14.6, 11.1), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, roughness: 0.03, clearcoat: 1, depthWrite: false }));
    add(glass, 0, 6.6, 0.93, scr);
    const stripe = add(new THREE.Mesh(new THREE.PlaneGeometry(14.6, 0.05), new THREE.MeshBasicMaterial({ color: S.ACC })), 0, 0.95, 0.915, scr);
    // x-ray: the TFT module behind the glass (shown from inside mode)
    reg('tft', scr, '2.4" ILI9341 (MSP2402) · 320×240 · SPI @ 27 MHz · GPIO 10-14, 21');
    reg('case', plinth, 'Machined aluminium case (illustrative: the real build is a breadboard)');
    for (const [x, z] of [[-9.8, -4], [9.8, -4], [-9.8, 4], [9.8, 4]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 20), MT.rubber()), x, 0.0, z);

    // ---- keys on the plinth deck ---------------------------------------------------------------------------------
    const btns = {}, DECK = 3.2;
    function makeKey(name, x, z, r, accent, glyph, gpio, desc) {
      const g = new THREE.Group(); g.position.set(x, DECK, z); scene.add(g);
      add(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.22, r + 0.22, 0.14, 40), MT.softblack()), 0, 0.02, 0, g);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.55, 40), accent ? MT.accent() : MT.cap()); cap.castShadow = true; add(cap, 0, 0.32, 0, g);
      if (glyph) { const d = S.decal(S.glyphTex(glyph, accent ? '#f6efe6' : '#1b1d22', 128, '600 70px "IBM Plex Mono", monospace'), r * 1.2, r * 1.2, 0, 0.285, 0, [-Math.PI / 2, 0, 0]); cap.add(d); }
      reg(name, g, `${name} · GPIO ${gpio} · ${desc}`); g.traverse((o) => (o.userData.btn = name));
      btns[name] = { cap, base: 0.32 };
    }
    makeKey('UP', -7.6, 0.9, 0.78, false, '▲', 5, 'auto-repeats when held');
    makeKey('DOWN', -7.6, 4.7, 0.78, false, '▼', 6, 'auto-repeats when held');
    makeKey('LEFT', -9.5, 2.8, 0.78, false, '◀', 8, 'previous app / back out of a menu');
    makeKey('RIGHT', -5.7, 2.8, 0.78, false, '▶', 9, 'next app');
    makeKey('SELECT', -7.6, 2.8, 0.78, false, '●', 7, 'enter / activate · hold = back or resync');
    makeKey('MEDIA', 8.2, 2.8, 1.25, true, '♪', 4, '1x play/pause · 2x next · 3x previous');
    // engraved text
    const eng = (txt, x, z, w, col = '#aeb3bb') => add(S.decal(S.glyphTex(txt, col, 256, '500 44px "IBM Plex Mono", monospace'), w, w, x, DECK + 0.02, z, [-Math.PI / 2, 0, 0]), x, DECK + 0.02, z);
    eng('MEDIA', 8.2, 4.55, 3.2); eng('SMART HUB', 1.2, 4.75, 5);
    // speaker grille
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.6), shell(new THREE.MeshStandardMaterial({ map: S.grilleTex(22, 12), roughness: 0.7, metalness: 0.5 })));
    grille.rotation.x = -Math.PI / 2; grille.position.set(1.2, DECK + 0.015, 1.7); scene.add(grille);
    reg('spk', grille, 'speaker grille · driven by the MAX98357A I²S amp');
    // microphone port on the deck (INMP441 sits right below it)
    const micHole = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    micHole.rotation.x = -Math.PI / 2; micHole.position.set(-3.6, DECK + 0.012, 4.4); scene.add(micHole);
    const micRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.5, 28), MT.aluLight()); micRing.rotation.x = -Math.PI / 2; micRing.position.set(-3.6, DECK + 0.014, 4.4); scene.add(micRing);
    eng('MIC', -3.6, 3.6, 1.6);
    reg('micport', micHole, 'microphone port · INMP441 I²S MEMS mic mounted just below');
    // LED slot on the front face
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x0a2a6b, emissiveIntensity: 2.2, roughness: 0.4 });
    const led = add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.22, 0.2), ledMat), 0, 1.6, 5.48);
    reg('rgb', led, 'status LED · blue advertising, amber pairing, purple linked, green active');
    // PAIR / BOOT on the right flank
    const bootG = new THREE.Group(); bootG.position.set(12.0, 1.7, 0.8); scene.add(bootG);
    const bootCap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 28), MT.aluLight()); bootCap.rotation.z = Math.PI / 2; bootCap.position.x = 0.05; bootG.add(bootCap);
    reg('boot', bootG, 'PAIR · BOOT button · GPIO 0 · short = pairing window, hold 3 s = erase bonds'); bootG.traverse((o) => (o.userData.btn = 'BOOT'));

    // ---- inside (x-ray): the real parts -----------------------------------------------------------------------------------
    const inner = new THREE.Group(); inner.visible = false; scene.add(inner);
    const dev = new THREE.Group(); dev.position.set(0.6, 0.9, -1.8); inner.add(dev);
    add(S.rbox(8.6, 0.16, 2.9, 0.2, 0.04, MT.chip(), 'xz'), 0, 0, 0, dev);
    bx(3.0, 0.45, 2.3, MT.can(), 1.7, 0.3, 0, dev);
    for (let i = 0; i < 22; i++) { bx(0.18, 0.2, 0.18, MT.gold(), -3.9 + i * 0.37, 0.18, 1.3, dev); bx(0.18, 0.2, 0.18, MT.gold(), -3.9 + i * 0.37, 0.18, -1.3, dev); }
    bx(1.3, 0.5, 1.1, MT.aluLight(), -4.0, 0.3, 0, dev);
    reg('devkit', dev, 'ESP32-S3-DevKitC-1 · N16R8 · 240 MHz dual core · 8 MB PSRAM');
    const mic = new THREE.Group(); mic.position.set(-2.4, 0.9, 3.4); inner.add(mic);
    add(S.rbox(1.9, 0.12, 1.5, 0.12, 0.03, MT.pcbBlue(), 'xz'), 0, 0, 0, mic); bx(0.5, 0.3, 0.5, MT.can(), 0, 0.2, 0, mic);
    reg('mic', mic, 'INMP441 · I²S MEMS mic · GPIO 15 / 16 / 17 · 16 kHz');
    const amp = new THREE.Group(); amp.position.set(5.3, 0.9, 3.0); inner.add(amp);
    add(S.rbox(1.9, 0.12, 1.7, 0.12, 0.03, MT.pcb(), 'xz'), 0, 0, 0, amp); bx(0.7, 0.2, 0.7, MT.chip(), 0, 0.15, 0, amp);
    reg('amp', amp, 'MAX98357A · I²S amp · GPIO 3 / 18 / 38 · alarm beep');
    const drv = add(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.5, 0.8, 36), MT.softblack()), 1.2, 2.5, 1.7, inner);
    add(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.5, 0.2, 36), MT.alu()), 0, 0.45, 0, drv);
    const tftMod = new THREE.Group(); tftMod.position.set(0, 6.6, -0.5); scr.add(tftMod); tftMod.visible = false;
    add(S.rbox(10.6, 7.9, 0.3, 0.3, 0.05, MT.pcb(), 'xy'), 0, 0, 0, tftMod); tftMod.children[0].material = S.P(0x9c1515, { roughness: 0.5 });
    inner.userData.tft = tftMod;
    // jumper wires
    const wire = (a, b, color, lift = 1.2) => { const A = V3(...a), B = V3(...b), mid = A.clone().lerp(B, 0.5); mid.y += lift; const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([A, mid, B]), 24, 0.07, 6, false), S.P(color, { roughness: 0.5 })); inner.add(m); };
    [[-7.6, 0.9], [-7.6, 4.7], [-9.5, 2.8], [-5.7, 2.8], [-7.6, 2.8]].forEach(([x, z], i) => wire([-3 + i * 0.37, 1.3, -0.5], [x, 2.7, z], [0x00bcd4, 0x00bcd4, 0x00bcd4, 0x00bcd4, 0xffffff][i], 0.8));
    wire([5, 1.3, -0.5], [8.2, 2.7, 2.8], 0xff7043, 0.8);
    [0, 1, 2].forEach((i) => wire([-1.5 + i * 0.37, 1.3, 0.8], [-2.9 + i * 0.5, 1.1, 3.2], [0x9c27b0, 0xffffff, 0x8bc34a][i], 0.6));
    [0, 1, 2].forEach((i) => wire([1.5 + i * 0.37, 1.3, 0.8], [4.8 + i * 0.4, 1.1, 2.9], [0x607d8b, 0x795548, 0xeeeeee][i], 0.9));

    // ---- callouts ------------------------------------------------------------------------------------------------------------------------------
    let xr = 0, xrTarget = 0;
    const ext = () => xr < 0.5, intr = () => xr >= 0.5;
    S.callouts(stage, studio, [
      { text: '2.4" TFT 320×240', pos: V3(5.5, 10.4, 0.95), obj: scr, side: 1, len: 56, dy: -26, visible: ext },
      { text: 'Five-way pad', pos: V3(-9.5, DECK + 0.7, 2.8), side: -1, len: 46, dy: 30, visible: ext },
      { text: 'Media key', pos: V3(8.6, DECK + 0.7, 2.4), side: 1, len: 50, dy: -34, visible: ext },
      { text: 'Mic port', pos: V3(-3.6, DECK, 4.4), side: -1, len: 110, dy: 0, visible: ext },
      { text: 'Status LED', pos: V3(-1.7, 1.6, 5.55), side: -1, len: 50, dy: 22, visible: ext },
      { text: 'Pair / boot', pos: V3(12.2, 1.7, 0.8), side: 1, len: 30, dy: 36, visible: ext },
      { text: 'ESP32-S3 N16R8', pos: V3(1.7, 1.6, -1.8), side: 1, len: 70, dy: -50, visible: intr },
      { text: 'INMP441 mic', pos: V3(-2.4, 1.0, 3.4), side: -1, len: 60, dy: 20, visible: intr },
      { text: 'MAX98357A amp', pos: V3(5.3, 1.0, 3.0), side: 1, len: 60, dy: 28, visible: intr },
      { text: 'ILI9341 module', pos: V3(4.5, 9.5, -0.5), obj: scr, side: 1, len: 56, dy: -30, visible: intr },
    ]);
    const tools = document.createElement('div'); tools.className = 'stage-tools'; tools.innerHTML = '<button id="hub-xray">Inside</button>'; stage.appendChild(tools);
    const xbtn = tools.firstChild;
    const setX = (on) => { xrTarget = on ? 1 : 0; xbtn.classList.toggle('on', on); xbtn.textContent = on ? 'Outside' : 'Inside'; };
    xbtn.onclick = () => setX(xrTarget === 0);

    // ---- interaction ---------------------------------------------------------------------------
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    let held = null, hoverPart = null;
    const physDown = (b) => { if (held !== b) { fw.press(b); } };
    const physUp = (b) => { fw.release(b); };
    function pick(ev) {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(pickables, true)[0]; return hit ? hit.object : null;
    }
    renderer.domElement.addEventListener('pointerdown', (ev) => {
      const o = pick(ev); if (o && o.userData.btn) { held = o.userData.btn; physDown(held); controls.enabled = false; audioUnlock(); }
    });
    const audioUnlock = () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) {} };
    const release = () => { if (held) { physUp(held); held = null; } controls.enabled = true; };
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    renderer.domElement.addEventListener('pointermove', (ev) => {
      const o = pick(ev), r = stage.getBoundingClientRect();
      hoverPart = o ? o.userData.part : null;
      renderer.domElement.style.cursor = o && o.userData.btn ? 'pointer' : 'grab';
      if (o && o.userData.label) { tip.textContent = o.userData.label; tip.style.opacity = 1; tip.style.left = ev.clientX - r.left + 14 + 'px'; tip.style.top = ev.clientY - r.top + 14 + 'px'; }
      else tip.style.opacity = 0;
    });
    renderer.domElement.addEventListener('pointerleave', () => (tip.style.opacity = 0));

    // DOM key row (touch-friendly) + keyboard
    layout.querySelectorAll('#hub-keys [data-b]').forEach((b) => {
      const n = b.dataset.b;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); audioUnlock(); fw.press(n); b.classList.add('down'); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => b.addEventListener(t, () => { if (b.classList.contains('down')) { fw.release(n); b.classList.remove('down'); } }));
    });
    const KEYMAP = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Enter: 'SELECT', m: 'MEDIA', M: 'MEDIA', b: 'BOOT', B: 'BOOT' };
    const downKeys = new Set();
    const onKD = (e) => {
      if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      const n = KEYMAP[e.key]; if (!n) return; e.preventDefault(); if (downKeys.has(e.key)) return; downKeys.add(e.key); audioUnlock(); fw.press(n);
    };
    const onKU = (e) => { const n = KEYMAP[e.key]; if (!n || !downKeys.has(e.key)) return; downKeys.delete(e.key); fw.release(n); };
    window.addEventListener('keydown', onKD); window.addEventListener('keyup', onKU);

    pinsEl.querySelectorAll('.pin').forEach((r) => (r.onclick = () => { const pt = PINS[+r.dataset.i][3]; if (['tft', 'mic', 'amp', 'devkit'].includes(pt)) setX(true); pulse = { part: pt, t: 0 }; }));
    let pulse = null;

    // ---- loop -------------------------------------------------------------------------------------
    let lastStore = 0, lastLaptop = 0, lastLed = '';
    const clk = new THREE.Clock();
    function frame() {
      const now = performance.now() - t0;
      fw.tick(now);
      if (now - lastLaptop > 100) { lastLaptop = now; laptop.tick(now); }
      sctx.setTransform(2, 0, 0, 2, 0, 0); fw.render(sctx); screenTex.needsUpdate = true;
      // led
      if (fw.leds !== lastLed) { lastLed = fw.leds; led.material.emissive.set(fw.ledColor()); }
      // button presses
      Object.keys(btns).forEach((n) => { const b = btns[n], down = fw.btn[n].stable; b.cap.position.y += ((down ? b.base - 0.18 : b.base) - b.cap.position.y) * 0.5; });
      bootCap.position.x += ((fw.btn.BOOT.stable ? -0.15 : 0.05) - bootCap.position.x) * 0.5;
      // pulse highlight
      if (pulse) {
        pulse.t += clk.getDelta(); const s = 1 + 0.12 * Math.sin(pulse.t * 14) * Math.max(0, 1 - pulse.t / 1.6);
        const p = parts[pulse.part] || (pulse.part === 'boot' ? parts.boot : null); if (p) p.scale.setScalar(s);
        if (pulse.t > 1.6) { if (p) p.scale.setScalar(1); pulse = null; }
      } else clk.getDelta();
      if (now - lastStore > 250) { lastStore = now; if ($('.pane[data-p="state"]').classList.contains('on')) paintStore(); paintLaptop(); }
      xr += (xrTarget - xr) * 0.12; const solid = xr < 0.04; shellMats.forEach((m) => { m.opacity = 1 - 0.86 * xr; m.depthWrite = solid; }); inner.visible = xr > 0.02; tftMod.visible = xr > 0.02;
    }
    studio.onTick(frame);
    function paintLaptop() {
      const s = lp.querySelector('#lp-status'); if (!s || !lp.classList.contains('on')) return;
      s.innerHTML = `<div><span>hub link</span><b>${fw.linkState}</b></div><div><span>hub bonded</span><b>${fw.bonded}</b></div>
        <div><span>laptop bond</span><b>${laptop.bonded}</b></div><div><span>clock set</span><b>${fw.al.clockSet}</b></div>
        <div><span>alarm</span><b>${String(fw.al.h).padStart(2, '0')}:${String(fw.al.m).padStart(2, '0')} ${fw.al.on ? 'ON' : 'off'}</b></div>`;
    }
    paintStore();

    return () => {
      studio.dispose(); window.removeEventListener('keydown', onKD); window.removeEventListener('keyup', onKU);
      window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
      try { audio && audio.close(); } catch (e) {}
    };
  }

  global.Labs = global.Labs || {};
  global.Labs.hub = { mount };
})(window);
