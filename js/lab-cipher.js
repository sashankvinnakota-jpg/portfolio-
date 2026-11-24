/* lab-cipher.js -- two PSoC boards, a UART link, and the real IPC packet format from task_ipc.h. Play against the other board. */
(function (g) {
  'use strict';
  const { M, box, html, canvasTex, makeStage, logger, tabs } = g.Lab;

  const CMD = { DISCOVERY: 0xC0, ACTIVE_PLAYER: 0xC1, INACTIVE_PLAYER: 0xC2, STATUS: 0xC3, ACK: 0xC4, CIPHER_READY: 0xC5, GUESS: 0xC6, FEEDBACK: 0xC7, RESET: 0xC8, FIRST_PLAYER: 0xC9, WIN: 0xCA };
  const NAME = Object.fromEntries(Object.entries(CMD).map(([k, v]) => [v, k]));
  const CRC_FAIL = 0xE1;
  const hex = (b) => b.toString(16).toUpperCase().padStart(2, '0');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- the game rules (Mastermind with digits 0-7) ------------------------------------------------------------
  function evaluate(secret, guess) {
    const pos = [0, 0, 0, 0], used = [false, false, false, false]; let exact = 0, near = 0;
    for (let i = 0; i < 4; i++) if (guess[i] === secret[i]) { pos[i] = 2; used[i] = true; exact++; }
    for (let i = 0; i < 4; i++) if (!pos[i]) { const j = secret.findIndex((s, k) => !used[k] && s === guess[i]); if (j >= 0) { used[j] = true; pos[i] = 1; near++; } }
    return { exact, near, pos, packed: pos.reduce((a, p, i) => a | (p << (2 * i)), 0) };   // 2 bits x 4 positions: 10 exact, 01 near
  }

  function mount(root) {
    root.innerHTML = '';
    const L = html(`
      <div class="lab-layout">
        <div class="stage-col">
          <div class="stage" id="cp-stage"><div class="stage-hint">two PSoC boards · the glowing packet travels over the UART wires</div></div>
          <div class="keypad" id="cp-keys">
            <div class="kp-status" id="cp-status">connecting…</div>
            <div class="kp-entry" id="cp-entry">· · · ·</div>
            <div class="kp-grid">${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<button data-d="${n}">${n}</button>`).join('')}<button data-d="back" class="wide">⌫</button><button data-d="ok" class="wide ok">ENTER</button></div>
          </div>
        </div>
        <aside class="side">
          <div class="tabs"><button data-t="wire" class="on">UART wire</button><button data-t="proto">Protocol</button></div>
          <div class="pane on" data-p="wire">
            <div class="note">Every message is a real 9-byte <code>ipc_packet_t</code>: <code>0xAA</code> start, command, 16-bit sequence, 4-byte payload, XOR checksum. Break the wire on purpose to see the receiver reject a packet and ask again.</div>
            <div class="btnrow"><button id="cp-corrupt">corrupt the next packet</button><button id="cp-new">new game</button></div>
            <div class="log" id="cp-log"></div>
          </div>
          <div class="pane" data-p="proto"><div class="tbl" id="cp-proto"></div></div>
          <div class="pane" data-p="rules"><div class="pipe">
            <div class="stagecard"><b>Goal</b><p>Each board secretly holds a 4-digit cipher (digits 0 to 7). Take turns guessing the other's. First to crack it wins; both boards then show the guess count.</p></div>
            <div class="stagecard"><b>Feedback</b><p><b>exact</b> = right digit, right place. <b>near</b> = right digit, wrong place. Packed into one byte, 2 bits per position: <code>10</code> exact, <code>01</code> near, <code>00</code> miss.</p></div>
            <div class="stagecard"><b>Who goes first</b><p>Each board sends a random token; the higher one goes first, and a tie retries.</p></div>
            <div class="stagecard"><b>What is simplified here</b><p>The framing, commands, payloads and checksum are from <code>task_ipc.h/.c</code>. The exact handshake order and ACK timing are simplified, and the opponent is a browser AI standing in for the second board.</p></div>
          </div></div>
        </aside>
      </div>`);
    root.appendChild(L); tabs(L);
    const $ = (s) => L.querySelector(s), log = logger($('#cp-log'), 300);
    $('#cp-proto').innerHTML = '<div class="row hd"><span>cmd</span><span>name · payload</span></div>' + Object.entries(CMD).map(([k, v]) => `<div class="row"><span class="mono">0x${hex(v)}</span><span>${k}<i>${{ DISCOVERY: 'initial handshake', ACTIVE_PLAYER: 'board is taking its turn', INACTIVE_PLAYER: 'board is waiting', STATUS: 'status / error (0xE1 = CRC fail, 0xE2 = bad type)', ACK: 'acknowledgement', CIPHER_READY: 'secret cipher chosen', GUESS: '4 digits, 0-7', FEEDBACK: 'exact, near, per-position byte', RESET: 'new game', FIRST_PLAYER: 'random token: higher goes first', WIN: 'winner sends its guess count' }[k]}</i></span></div>`).join('');

    // ---- 3D: two boards + wires + packet --------------------------------------------------------------------
    const S = g.Studio, MT = S.MAT, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const st = makeStage($('#cp-stage'), { cam: [0, 14, 33], target: [0, 3.4, 0], fov: 32, minDist: 14 });
    function board(x, name, accent) {
      const gp = new THREE.Group(); gp.position.set(x, 0, 0); st.scene.add(gp);
      const add = (m, X, Y, Z, par = gp) => { m.position.set(X, Y, Z); par.add(m); return m; };
      add(S.rbox(11.4, 1.3, 8.4, 1.4, 0.3, MT.alu(), 'xz'), 0, 0.65, 0.6);
      for (let i = 0; i < 5; i++) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.34, 28), i === 0 || accent && i === 4 ? MT.accent() : MT.cap()); cap.castShadow = true; add(cap, -4 + i * 1.5, 1.45, 2.4); }
      add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.0), MT.softblack()), -2.4 * Math.sign(x) * -1, 1.4, 3.2);
      add(S.decal(S.textTex(name, 512, 96, '#aeb3bb', '500 40px "IBM Plex Mono", monospace'), 6, 1.1, 0, 1.32, 4.45, [-Math.PI / 2, 0, 0]), 0, 1.32, 4.45);
      const lcdFrame = add(S.rbox(9.4, 6.9, 0.7, 0.9, 0.2, MT.softblack(), 'xy'), 0, 4.3, -1.6); lcdFrame.rotation.x = -0.3;
      const lcd = canvasTex(640, 480); lcd.tex.encoding = THREE.sRGBEncoding;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 6.3), new THREE.MeshBasicMaterial({ map: lcd.tex, toneMapped: false })); add(scr, 0, 0, 0.36, lcdFrame);
      return { gp, lcd };
    }
    const BA = board(-8.2, 'BOARD A · YOU', true), BB = board(8.2, 'BOARD B · CPU', false);
    const pA = V3(-2.8, 1.5, 3.2), pB = V3(2.8, 1.5, 3.2);
    const curveTx = new THREE.CatmullRomCurve3([pA, V3(-1.4, 2.4, 5), V3(0, 1.6, 6.2), V3(1.4, 2.4, 5), pB]);
    const curveRx = new THREE.CatmullRomCurve3([V3(-2.8, 1.5, 2.5), V3(-1.4, 0.7, 1.2), V3(0, 0.45, 0.7), V3(1.4, 0.7, 1.2), V3(2.8, 1.5, 2.5)]);
    [[curveTx, 0x16181c], [curveRx, 0x5a6478]].forEach(([c, col]) => { const m = new THREE.Mesh(new THREE.TubeGeometry(c, 40, 0.1, 8), S.P(col, { roughness: 0.9, envMapIntensity: 0.3 })); m.castShadow = true; st.scene.add(m); });
    S.callouts($('#cp-stage'), st, [
      { text: 'TX wire', pos: V3(0, 1.6, 6.2), side: 1, len: 70, dy: 40 },
      { text: 'RX wire', pos: V3(0, 0.45, 0.7), side: -1, len: 40, dy: 70 },
    ]);
    const photon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshBasicMaterial({ color: 0xc4432a })); photon.visible = false; st.scene.add(photon);
    const glow = new THREE.PointLight(0xffffff, 0, 8); st.scene.add(glow);
    let flight = null;
    st.onTick((dt) => {
      if (!flight) return; flight.t += dt / 0.45; const t = Math.min(1, flight.t);
      const c = flight.from === 'A' ? curveTx : curveRx, p = c.getPoint(flight.from === 'A' ? t : 1 - t);
      photon.position.copy(p); glow.position.copy(p); glow.intensity = 1.5; photon.visible = true; photon.material.color.set(flight.bad ? 0x000000 : 0xc4432a);
      if (t >= 1) { flight = null; photon.visible = false; glow.intensity = 0; }
    });

    // ---- game state ----------------------------------------------------------------------------------------------------------
    let seq = 0, corruptNext = false, token = 0, killed = false;
    const G = { phase: 'connect', entry: [], need: null, A: { secret: null, tries: [], first: false }, B: { secret: null, tries: [] }, turn: null, winner: null, result: '' };
    $('#cp-corrupt').onclick = () => { corruptNext = true; log('wire: the NEXT packet will be corrupted in transit', 'warn'); };
    $('#cp-new').onclick = () => { token++; newGame(); };

    function buildPacket(cmd, payload) {
      const b = [0xAA, cmd, seq & 0xFF, (seq >> 8) & 0xFF, ...payload, 0]; seq++;
      let x = 0; for (let i = 1; i < 8; i++) x ^= b[i]; b[8] = x; return b;
    }
    const validate = (b) => b[0] === 0xAA && b.slice(1, 8).reduce((a, v) => a ^ v, 0) === b[8];
    function fmt(b) { return `AA ${hex(b[1])} ${hex(b[2])} ${hex(b[3])} | ${b.slice(4, 8).map(hex).join(' ')} | ${hex(b[8])}`; }
    function describe(b) {
      const n = NAME[b[1]] || '??', p = b.slice(4, 8);
      if (b[1] === CMD.GUESS) return `${n} ${p.join('')}`; if (b[1] === CMD.FEEDBACK) return `${n} exact=${p[0]} near=${p[1]} pos=0b${p[2].toString(2).padStart(8, '0')}`;
      if (b[1] === CMD.FIRST_PLAYER) return `${n} token=${p[0]}`; if (b[1] === CMD.WIN) return `${n} guesses=${p[0]}`; if (b[1] === CMD.STATUS) return `${n} 0x${hex(p[0])}${p[0] === CRC_FAIL ? ' CRC_FAIL' : ''}`;
      return n;
    }
    // sends one packet; returns the packet as received (retransmits once if the receiver rejects it)
    async function send(from, cmd, payload = [0, 0, 0, 0]) {
      const to = from === 'A' ? 'B' : 'A'; let pk = buildPacket(cmd, payload);
      for (let attempt = 0; attempt < 3; attempt++) {
        const wire = pk.slice(); let bad = false;
        if (corruptNext) { corruptNext = false; wire[4 + (attempt % 4)] ^= 0x04; bad = true; }
        flight = { from, t: 0, bad }; log(`${from}→${to}  ${fmt(wire)}   ${describe(pk)}`, from === 'A' ? 'a' : 'b');
        await sleep(520);
        if (validate(wire)) return pk;
        log(`${to}: checksum 0x${hex(wire[8])} != 0x${hex(wire.slice(1, 8).reduce((a, v) => a ^ v, 0))} -> reject`, 'err');
        const st2 = buildPacket(CMD.STATUS, [CRC_FAIL, 0, 0, 0]); flight = { from: to, t: 0, bad: false }; log(`${to}→${from}  ${fmt(st2)}   ${describe(st2)}`, to === 'A' ? 'a' : 'b'); await sleep(520);
        log(`${from}: retransmitting with a new sequence number`, 'warn'); pk = buildPacket(cmd, payload);
      }
      throw new Error('link down');
    }

    // ---- UI: keypad + LCDs -----------------------------------------------------------------------------------------------------
    function waitDigits(kind) { return new Promise((res) => { G.need = { kind, res }; G.entry = []; paintKeys(); }); }
    L.querySelectorAll('#cp-keys [data-d]').forEach((b) => (b.onclick = () => {
      const d = b.dataset.d; if (!G.need) return;
      if (d === 'back') G.entry.pop(); else if (d === 'ok') { if (G.entry.length === 4) { const n = G.need; G.need = null; const e = G.entry.slice(); G.entry = []; paintKeys(); n.res(e); return; } }
      else if (G.entry.length < 4) G.entry.push(+d);
      paintKeys();
    }));
    const onKey = (e) => { if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) || !G.need) return; if (/^[0-7]$/.test(e.key)) L.querySelector(`#cp-keys [data-d="${e.key}"]`).click(); else if (e.key === 'Backspace') L.querySelector('[data-d="back"]').click(); else if (e.key === 'Enter') L.querySelector('[data-d="ok"]').click(); };
    window.addEventListener('keydown', onKey);
    function paintKeys() {
      const s = { connect: 'boards are linking…', cipher: 'enter YOUR secret cipher (4 digits, 0-7), then ENTER', guess: 'your turn: guess board B\'s cipher', wait: 'board B is thinking…', over: G.result }[G.phase] || '';
      $('#cp-status').textContent = s; $('#cp-entry').textContent = [0, 1, 2, 3].map((i) => (G.entry[i] === undefined ? '·' : G.entry[i])).join(' ');
      L.querySelectorAll('#cp-keys .kp-grid button').forEach((b) => (b.disabled = !G.need));
    }
    function drawLCD(me) {
      const B = me === 'A' ? BA : BB, mine = G[me], other = G[me === 'A' ? 'B' : 'A'], c = B.lcd.ctx, W = 640;
      c.fillStyle = '#000'; c.fillRect(0, 0, 640, 480); c.textBaseline = 'top';
      c.fillStyle = '#6fe3ff'; c.font = '600 40px "IBM Plex Mono", monospace'; c.fillText(me === 'A' ? 'PLAYER 1 (you)' : 'PLAYER 2', 20, 12);
      c.fillStyle = G.turn === me ? '#7ee787' : '#5c7482'; c.font = '30px "IBM Plex Mono", monospace'; c.fillText(G.turn === me ? '> YOUR TURN' : G.turn ? 'waiting' : G.phase, 20, 62);
      c.fillStyle = '#9fb7c0'; c.font = '30px "IBM Plex Mono", monospace'; c.fillText('cipher ' + (mine.secret ? (me === 'A' ? mine.secret.join(' ') : '* * * *') : '- - - -'), 20, 104);
      c.strokeStyle = '#1b2a34'; c.beginPath(); c.moveTo(20, 148); c.lineTo(W - 20, 148); c.stroke();
      const tries = mine.tries.slice(-5);
      tries.forEach((t, i) => {
        const y = 156 + i * 56; c.fillStyle = '#e6f2f7'; c.font = '40px "IBM Plex Mono", monospace'; c.fillText(t.digits.join(' '), 20, y);
        t.fb.pos.forEach((p, k) => { c.fillStyle = p === 2 ? '#00ff55' : p === 1 ? '#ffa600' : '#2a3a44'; c.beginPath(); c.arc(290 + k * 36, y + 22, 12, 0, 6.3); c.fill(); });
        c.fillStyle = '#9fb7c0'; c.font = '22px "IBM Plex Mono", monospace'; c.fillText(`${t.fb.exact}e ${t.fb.near}n`, 450, y + 12);
      });
      if (G.winner) { c.fillStyle = 'rgba(0,0,0,0.72)'; c.fillRect(0, 150, 640, 190); c.fillStyle = G.winner === me ? '#7ee787' : '#ff7a7a'; c.font = '600 46px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.fillText(G.winner === me ? 'YOU WIN' : 'YOU LOSE', 320, 180); c.fillStyle = '#e6f2f7'; c.font = '26px "IBM Plex Mono", monospace'; c.fillText(`${G.winnerGuesses} guesses`, 320, 250); c.textAlign = 'left'; }
      B.lcd.tex.needsUpdate = true;
    }
    st.onTick(() => { drawLCD('A'); drawLCD('B'); });

    // ---- the opponent (board B): guesses any code consistent with feedback so far ------------------------------------------
    const ALL = []; for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) for (let c = 0; c < 8; c++) for (let d = 0; d < 8; d++) ALL.push([a, b, c, d]);
    function aiGuess(tries) { const ok = ALL.filter((cand) => tries.every((t) => { const f = evaluate(cand, t.digits); return f.exact === t.fb.exact && f.near === t.fb.near; })); return (ok[Math.floor(Math.random() * ok.length)] || ALL[0]).slice(); }

    async function newGame() {
      const my = ++token; seq = 0; G.phase = 'connect'; G.A = { secret: null, tries: [] }; G.B = { secret: null, tries: [] }; G.turn = null; G.winner = null; G.entry = []; G.need = null; paintKeys();
      L.querySelector('#cp-log').innerHTML = ''; log('--- new game ---');
      const dead = () => killed || my !== token;
      try {
        await send('A', CMD.DISCOVERY); if (dead()) return; await send('B', CMD.ACK);
        let tA, tB; do { tA = 1 + Math.floor(Math.random() * 254); tB = 1 + Math.floor(Math.random() * 254); await send('A', CMD.FIRST_PLAYER, [tA, 0, 0, 0]); if (dead()) return; await send('B', CMD.FIRST_PLAYER, [tB, 0, 0, 0]); if (dead()) return; if (tA === tB) log('tie: negotiating again'); } while (tA === tB);
        G.turn = tA > tB ? 'A' : 'B'; log(`token ${tA} vs ${tB}: board ${G.turn} goes first`, 'ok');
        G.phase = 'cipher'; paintKeys();
        const mine = await waitDigits('cipher'); if (dead()) return; G.A.secret = mine; await send('A', CMD.CIPHER_READY); if (dead()) return;
        G.B.secret = [0, 0, 0, 0].map(() => Math.floor(Math.random() * 8)); await send('B', CMD.CIPHER_READY); if (dead()) return;
        let active = G.turn;
        for (let n = 0; n < 40 && !dead(); n++) {
          G.turn = active; const other = active === 'A' ? 'B' : 'A', me = G[active];
          await send(active, CMD.ACTIVE_PLAYER); if (dead()) return; await send(other, CMD.INACTIVE_PLAYER); if (dead()) return;
          let guess; if (active === 'A') { G.phase = 'guess'; paintKeys(); guess = await waitDigits('guess'); if (dead()) return; G.phase = 'wait'; paintKeys(); } else { G.phase = 'wait'; paintKeys(); await sleep(700); guess = aiGuess(G.B.tries); }
          const rx = await send(active, CMD.GUESS, guess); if (dead()) return;
          const fb = evaluate(G[other].secret, rx.slice(4, 8));
          await send(other, CMD.FEEDBACK, [fb.exact, fb.near, fb.packed, 0]); if (dead()) return;
          me.tries.push({ digits: guess, fb });
          if (fb.exact === 4) { G.winner = active; G.winnerGuesses = me.tries.length; await send(active, CMD.WIN, [me.tries.length, 0, 0, 0]); G.phase = 'over'; G.turn = null; G.result = `${active === 'A' ? 'You cracked board B' : 'Board B cracked you'} in ${me.tries.length}. Press “new game”.`; log(`WINNER: board ${active} in ${me.tries.length} guesses`, 'ok'); paintKeys(); return; }
          active = other;
        }
      } catch (e) { if (!killed) log('link error: ' + e.message, 'err'); }
    }
    newGame();
    return () => { killed = true; token++; window.removeEventListener('keydown', onKey); st.dispose(); };
  }
  g.Labs.cipher = { mount };
})(window);
