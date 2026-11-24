/* =============================================================================
 *  hub-core.js -- a JavaScript port of the ESP32-S3 Smart Hub firmware logic.
 *
 *  Ported from github.com/sashankvinnakota-jpg/esp32-smart-hub (s3/firmware/src):
 *    state_store.h  -> StateStore      (owners, $SYNC clears REMOTE only, 96 keys)
 *    input.cpp      -> Btn             (debounce-free timing: repeat, long, multi-click)
 *    display.cpp    -> render*()       (same 320x240 layout, same pages, same menus)
 *    alarm.h        -> alarm*          (software clock, edit mode, ring, 9 min snooze)
 *    main.cpp       -> handle()        (the input switch, wheel, ask overlay, BLE link)
 *
 *  It is a port, not the C++ itself: same rules, same field rectangles, same
 *  strings. The only thing it does not model is the radio and the glass.
 * ============================================================================= */
(function (global) {
  'use strict';

  // ---- palette (RGB565 values from display.cpp, converted) -------------------
  const C = {
    BG: '#000000', PANEL: '#101410', TEXT: '#ffffff', DIM: '#848284',
    ACCENT: '#00bdff', WARM: '#ffa600', GOOD: '#00ff00', BAD: '#ff0000',
  };
  const W = 320, H = 240, HEADER_H = 26, BODY_Y = 32;
  const MENU_ROWS = 5, MENU_ROW_H = 26;
  const DYN_MAX = 10;
  const WHEEL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789?.,'-";

  // TFT_eSPI built-in font heights, and the canvas size that fits inside them.
  const FONT_H = { 2: 16, 4: 26, 6: 48 };
  const FONT_PX = { 2: 13, 4: 21, 6: 43 };
  const FONT_FAMILY = { 2: '"Inter", "Helvetica Neue", Arial, sans-serif',
                        4: '"Inter", "Helvetica Neue", Arial, sans-serif',
                        6: '"Inter", "Helvetica Neue", Arial, sans-serif' };

  // ===========================================================================
  //  StateStore -- every entry records WHO WROTE IT.
  // ===========================================================================
  const Owner = { REMOTE: 0, LOCAL: 1, CONFIG: 2 };
  const OWNER_NAME = ['remote', 'local', 'config'];

  class StateStore {
    constructor(log) { this.k = []; this.v = []; this.o = []; this.log = log || (() => {}); }
    static get MAX_KEYS() { return 96; }
    get count() { return this.k.length; }
    find(k) { return this.k.indexOf(k); }
    has(k) { return this.find(k) >= 0; }
    value(k, d = '') { const i = this.find(k); return i >= 0 ? this.v[i] : d; }
    set(k, v, owner = Owner.REMOTE) {
      v = String(v);
      const i = this.find(k);
      if (i >= 0) {
        if (this.o[i] !== owner && owner === Owner.REMOTE) {
          this.log(`[state] refused: remote tried to write ${OWNER_NAME[this.o[i]]}-owned '${k}'`);
          return false;
        }
        if (this.v[i] === v) return false;
        this.v[i] = v;
        return true;
      }
      if (this.k.length >= StateStore.MAX_KEYS) {
        this.log(`[state] *** STORE FULL (${StateStore.MAX_KEYS} keys) -- DROPPING '${k}' ***`);
        return false;
      }
      this.k.push(k); this.v.push(v); this.o.push(owner);
      return true;
    }
    setLocal(k, v) { return this.set(k, v, Owner.LOCAL); }
    setConfig(k, v) { return this.set(k, v, Owner.CONFIG); }
    // the whole point of Stage 7a: $SYNC clears REMOTE only
    clearRemote(ns = '') {
      let removed = 0;
      for (let i = 0; i < this.k.length;) {
        if (this.o[i] === Owner.REMOTE && (!ns || this.k[i].startsWith(ns))) {
          this.k.splice(i, 1); this.v.splice(i, 1); this.o.splice(i, 1); removed++;
        } else i++;
      }
      return removed;
    }
    entries() { return this.k.map((k, i) => ({ k, v: this.v[i], owner: OWNER_NAME[this.o[i]] })); }
  }

  // ===========================================================================
  //  Btn -- one physical button, as input.cpp times it.
  //    repeat  : UP/DOWN report on PRESS, then auto-repeat (450 ms, then 140 ms)
  //    long    : fires while still held at `longMs`
  //    clicks  : MEDIA counts 1/2/3 presses inside a 320 ms gap
  // ===========================================================================
  const REPEAT_FIRST_MS = 450, REPEAT_NEXT_MS = 140, CLICK_GAP_MS = 320;
  const UI_LONG_MS = 700, BOOT_LONG_MS = 3000;

  class Btn {
    constructor(longMs, maxClicks, repeat) {
      this.longMs = longMs; this.maxClicks = maxClicks; this.repeat = repeat;
      this.stable = false; this.longFired = false; this.pressedAt = 0;
      this.clicks = 0; this.lastClickAt = 0; this.nextRepeat = 0; this.wasRepeat = false;
      this.edge = 0; // 1 = just pressed, -1 = just released (consumed by poll)
    }
    down(now) { if (!this.stable) { this.stable = true; this.edge = 1; this.pressedAt = now; this.longFired = false; } }
    up(now)   { if (this.stable)  { this.stable = false; this.edge = -1; this.releasedAt = now; } }
    // returns 0 = nothing, 1..3 = click count, 'LONG'
    poll(now) {
      this.wasRepeat = false;
      if (this.edge === 1) {
        this.edge = 0;
        if (this.repeat) { this.nextRepeat = now + REPEAT_FIRST_MS; return 1; }
      } else if (this.edge === -1) {
        this.edge = 0;
        if (!this.longFired && (now - this.pressedAt) < this.longMs) {
          if (this.repeat) return 0;               // already reported on press
          this.clicks++; this.lastClickAt = now;
          if (this.clicks >= this.maxClicks) { const n = this.clicks; this.clicks = 0; return n; }
        }
      }
      if (this.repeat && this.stable && now >= this.nextRepeat) {
        this.nextRepeat = now + REPEAT_NEXT_MS; this.wasRepeat = true; return 1;
      }
      if (this.clicks > 0 && !this.stable && (now - this.lastClickAt) > CLICK_GAP_MS) {
        const n = this.clicks; this.clicks = 0; return n;
      }
      if (!this.repeat && this.stable && !this.longFired && (now - this.pressedAt) >= this.longMs) {
        this.longFired = true; this.clicks = 0; return 'LONG';
      }
      return 0;
    }
  }

  // ===========================================================================
  //  Firmware
  // ===========================================================================
  class HubFirmware {
    constructor(opts = {}) {
      this.onLog = opts.onLog || (() => {});
      this.onSend = opts.onSend || (() => {});        // frames the hub sends to the laptop
      this.onBeep = opts.onBeep || (() => {});
      this.onLink = opts.onLink || (() => {});
      this.store = new StateStore((s) => this.log(s));
      this.bootAt = 0;
      this.now = 0;

      // pages ------------------------------------------------------------------
      this.MEDIA_MENU = [
        ['Play / Pause', 'MEDIA.PLAYPAUSE'], ['Next track', 'MEDIA.NEXT'],
        ['Previous', 'MEDIA.PREV'], ['Volume up', 'MEDIA.VOLUP'],
        ['Volume down', 'MEDIA.VOLDOWN'], ['Mute', 'MEDIA.MUTE'], ['Stop', 'MEDIA.STOP'],
      ];
      this.PAGES = [
        { name: 'HOME',   draw: 'Home' },
        { name: 'MEDIA',  draw: 'Media', menu: this.MEDIA_MENU },
        { name: 'NOTIFY', draw: 'Notify' },
        { name: 'STOCKS', draw: 'Stocks' },
        { name: 'STATUS', draw: 'Status' },
        { name: 'CLAUDE', draw: 'Claude', dynamic: true },
        { name: 'ALARM',  draw: 'Alarm' },
      ];
      this.page = 0;
      this.menuOpen = false; this.menuCursor = 0; this.menuTop = 0;
      this.dynLabel = []; this.dynAction = [];
      this.toastText = ''; this.toastUntil = 0;
      this.overlay = null;       // {kind:'asking'|'answer', ...}
      this.wheel = { on: false, idx: 0, text: '' };

      // link / BLE -------------------------------------------------------------
      this.linkState = 'ADVERTISING';   // ADVERTISING | PAIRING | LINKED | ACTIVE
      this.bonded = true;               // an already-paired board comes back by itself
      this.pairingUntil = 0;

      // alarm ------------------------------------------------------------------
      this.al = { clockSet: false, syncMs: 0, syncMin: 0, h: 7, m: 0, on: false,
                  ringing: false, lastFiredMin: -1, snoozeUntil: 0, lastBeep: 0,
                  editing: false, eh: 7, em: 0, eon: false, field: 'HOUR' };

      // inputs -----------------------------------------------------------------
      this.btn = {
        UP: new Btn(UI_LONG_MS, 1, true), DOWN: new Btn(UI_LONG_MS, 1, true),
        SELECT: new Btn(UI_LONG_MS, 1, false), LEFT: new Btn(UI_LONG_MS, 1, false),
        RIGHT: new Btn(UI_LONG_MS, 1, false), MEDIA: new Btn(UI_LONG_MS, 3, false),
        BOOT: new Btn(BOOT_LONG_MS, 1, false),
      };
      this.evq = [];
      this.asks = []; this.nextAskId = 1;
      this.answerLines = {};
      this.wantSync = false;
      this.lastTick = 0;
      this.lastHeartbeat = 0;
      this.leds = 'ADVERTISING';
    }

    log(s) { this.onLog(s); }

    // Power-cycle: RAM is lost (clock, remote keys, UI), NVS survives (bonds, CFG.* incl. the alarm).
    reset(now) {
      const keep = this.store.entries().filter((e) => e.owner === 'config');
      this.store = new StateStore((s) => this.log(s));
      keep.forEach((e) => this.store.setConfig(e.k, e.v));
      const a = this.al;
      this.al = { clockSet: false, syncMs: 0, syncMin: 0, h: +this.store.value('CFG.ALARM_H', 7), m: +this.store.value('CFG.ALARM_M', 0),
                  on: this.store.value('CFG.ALARM_ON') === '1', ringing: false, lastFiredMin: -1, snoozeUntil: 0, lastBeep: 0,
                  editing: false, eh: 7, em: 0, eon: false, field: 'HOUR' };
      this.page = 0; this.menuOpen = false; this.overlay = null; this.wheel = { on: false, idx: 0, text: '' };
      this.toastUntil = 0; this.asks = []; this.evq = [];
      this.linkState = 'ADVERTISING'; this.leds = '';
      this.begin(now);
    }

    // ---- lifecycle ----------------------------------------------------------
    begin(now) {
      this.bootAt = now; this.now = now;
      this.log('[boot] ESP32-S3 Smart Hub');
      this.log('[disp] ILI9341 up: 320x240, 7 pages');
      this.log('[in  ] buttons: up=5 down=6 select=7 left=8 right=9 media=4 boot=0');
      this.store.setLocal('DEV.NAME', 'ESP32-Hub');
      this.store.setLocal('UI.PAGE', 'HOME');
      const dflt = (k, v) => { if (!this.store.has(k)) this.store.setConfig(k, v); };
      dflt('CFG.BRIGHTNESS', '255'); dflt('CFG.ALARM_H', '7'); dflt('CFG.ALARM_M', '0'); dflt('CFG.ALARM_ON', '0');
      this.al.h = +this.store.value('CFG.ALARM_H'); this.al.m = +this.store.value('CFG.ALARM_M');
      this.al.on = this.store.value('CFG.ALARM_ON') === '1';
      this.log(this.bonded ? '[boot] bonded laptop found -- advertising'
                           : '[boot] no bonded laptop yet -- SHORT PRESS the PAIR button');
      this.setLink('ADVERTISING');
    }

    // ---- BLE link state -------------------------------------------------------
    setLink(s) {
      if (s === this.linkState && this.leds === s) return;
      this.linkState = s; this.leds = s;
      this.store.setLocal('DEV.LINK', s);
      this.onLink(s);
    }
    get linkView() {
      return { ADVERTISING: 'OFFLINE', PAIRING: 'PAIRING', LINKED: 'LINKING', ACTIVE: 'ONLINE' }[this.linkState];
    }
    linkUsable() { return this.linkState === 'ACTIVE'; }
    ledColor() {
      return { ADVERTISING: '#0a2a6b', PAIRING: '#ffb000', LINKED: '#a040ff', ACTIVE: '#10ff50' }[this.linkState];
    }
    enterPairingMode() {
      this.pairingUntil = this.now + 120000;
      this.log('[pair] PAIRING MODE OPEN for 120 s');
      this.setLink('PAIRING');
    }
    forgetAllBonds() {
      this.bonded = false;
      this.log('[bond] erased ALL bonds (long press)');
      this.toast('bonds erased');
      if (this.linkState !== 'ADVERTISING') this.peerDisconnect('bonds erased');
      this.setLink('ADVERTISING');
    }
    // called by the laptop simulation
    peerConnect() {
      if (this.linkState !== 'ADVERTISING' && this.linkState !== 'PAIRING') return false;
      const pairingOpen = this.linkState === 'PAIRING';
      if (!this.bonded && !pairingOpen) { this.log('[sec ] rejected: not bonded and pairing window closed'); return false; }
      this.log('[link] connected peer=laptop -> LINKED (awaiting encryption)');
      this.setLink('LINKED');
      this.log('[sec ] requesting encryption');
      return true;
    }
    peerEncrypted() {
      if (this.linkState !== 'LINKED') return;
      this.log('[sec ] encrypted=1 bonded=1 authenticated=0 keysize=16');
      if (!this.bonded) { this.bonded = true; this.log('[pair] bond established -- pairing window closed'); this.log('[bond] 1 bonded device(s)'); }
      this.log('[sec ] TRUSTED laptop -> ACTIVE');
      this.setLink('ACTIVE');
      this.toast('laptop connected');
    }
    peerDisconnect(why) {
      if (this.linkState === 'ACTIVE' || this.linkState === 'LINKED') {
        this.log(`[link] disconnected (${why || 'peer gone'}) -- advertising`);
        // $SYNC semantics: the laptop will re-author remote keys on reconnect
        this.setLink('ADVERTISING');
      }
    }

    // ---- protocol frames from the laptop ----------------------------------------
    recvLine(line) {
      if (line === '$SYNC') { const n = this.store.clearRemote(); this.log(`[sync] cleared ${n} remote key(s)`); return; }
      if (line === '$END') return;
      let m;
      if ((m = line.match(/^\$PROG (\d+) (.*)$/))) { this.showProgress(m[2]); return; }
      if ((m = line.match(/^\$ANL (\d+) (\d+) (.*)$/))) { (this.answerLines[m[1]] = this.answerLines[m[1]] || [])[+m[2]] = m[3]; return; }
      if ((m = line.match(/^\$ANS (\d+) (\w+) (.*)$/))) {
        const lines = (this.answerLines[m[1]] || []).filter(Boolean); delete this.answerLines[m[1]];
        this.asks = this.asks.filter((a) => a.id !== +m[1]);
        this.log(`[ask ] <- #${m[1]} ${m[2]}`);
        this.showAnswer(m[3], lines); return;
      }
      const eq = line.indexOf('=');
      if (eq > 0) {
        const k = line.slice(0, eq), v = line.slice(eq + 1);
        if (k === 'CLOCK.TIME') {
          const [hh, mm] = v.split(':').map(Number);
          this.syncClock(hh, mm);
        }
        this.store.set(k, v, Owner.REMOTE);
      }
    }
    send(line) { this.onSend(line); }
    sendCommand(c) {
      if (!this.linkUsable()) { this.log(`[cmd ] '${c}' ignored -- no link`); return; }
      this.log(`[cmd ] -> ${c}`);
      this.send('$CMD ' + c);
    }
    askSend(cap, arg) {
      if (!this.linkUsable()) { this.log(`[ask ] '${cap}' ignored -- no link`); this.toast('no link'); return; }
      if (this.asks.length >= 4) { this.log('[ask ] all request slots busy'); this.toast('busy'); return; }
      const id = this.nextAskId++;
      this.asks.push({ id, cap, sentAt: this.now });
      this.log(`[ask ] -> #${id} ${cap} ${arg}`);
      this.showAsking(cap);
      this.send(`$ASK ${id} ${cap}${arg ? ' ' + arg : ''}`);
    }

    // ---- software clock + alarm (alarm.h) ------------------------------------------
    syncClock(hh, mm) {
      if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return;
      const a = this.al; a.syncMin = hh * 60 + mm; a.syncMs = this.now; a.clockSet = true;
    }
    nowMinutes() {
      const a = this.al; if (!a.clockSet) return -1;
      return (a.syncMin + Math.floor((this.now - a.syncMs) / 60000)) % 1440;
    }
    alarmTick() {
      const a = this.al, s = this.store, nowMin = this.nowMinutes();
      s.setLocal('CLOCK.NOW', nowMin >= 0 ? `${String(Math.floor(nowMin / 60)).padStart(2, '0')}:${String(nowMin % 60).padStart(2, '0')}` : '--:--');
      if (a.snoozeUntil && this.now >= a.snoozeUntil) { a.snoozeUntil = 0; a.ringing = true; }
      if (a.on && nowMin >= 0) {
        const alarmMin = a.h * 60 + a.m;
        if (!a.ringing && !a.snoozeUntil && nowMin === alarmMin && a.lastFiredMin !== nowMin) {
          a.ringing = true; a.lastFiredMin = nowMin; this.log('[alrm] RINGING');
        }
        if (nowMin !== alarmMin) a.lastFiredMin = -1;
      }
      if (a.ringing && this.now - a.lastBeep > 900) { this.onBeep(); a.lastBeep = this.now; }
      s.setLocal('ALARM.RINGING', a.ringing ? '1' : '0');
      s.setLocal('ALARM.SNOOZING', a.snoozeUntil ? '1' : '0');
      s.setLocal('ALARM.H', a.h); s.setLocal('ALARM.M', a.m); s.setLocal('ALARM.ON', a.on ? '1' : '0');
      s.setLocal('ALARM.EDITING', a.editing ? '1' : '0');
      if (a.editing) {
        s.setLocal('ALARM.EDIT_H', a.eh); s.setLocal('ALARM.EDIT_M', a.em);
        s.setLocal('ALARM.EDIT_ON', a.eon ? '1' : '0');
        s.setLocal('ALARM.EDIT_FIELD', a.field);
      }
    }
    alarmEditEnter() { const a = this.al; a.editing = true; a.eh = a.h; a.em = a.m; a.eon = a.on; a.field = 'HOUR'; }
    alarmEditExit() {
      const a = this.al; if (!a.editing) return;
      a.h = a.eh; a.m = a.em; a.on = a.eon; a.editing = false; a.lastFiredMin = -1;
      this.store.setConfig('CFG.ALARM_H', a.h); this.store.setConfig('CFG.ALARM_M', a.m);
      this.store.setConfig('CFG.ALARM_ON', a.on ? '1' : '0');
      this.log(`[alrm] saved: ${String(a.h).padStart(2, '0')}:${String(a.m).padStart(2, '0')} ${a.on ? 'ON' : 'OFF'}`);
    }
    alarmEditStep(dir) {
      const a = this.al;
      if (a.field === 'HOUR') a.eh = (a.eh + dir + 24) % 24;
      else if (a.field === 'MIN') a.em = (a.em + dir + 60) % 60;
      else a.eon = !a.eon;
    }
    alarmEditMove(dir) {
      const order = ['HOUR', 'MIN', 'ON'], a = this.al;
      a.field = order[(order.indexOf(a.field) + dir + 3) % 3];
    }

    // ---- display state ---------------------------------------------------------------
    get pageName() { return this.PAGES[this.page].name; }
    pageHasMenu() { const p = this.PAGES[this.page]; return !!(p.menu || p.dynamic); }
    rowCount() { const p = this.PAGES[this.page]; return p.dynamic ? this.dynLabel.length : (p.menu ? p.menu.length : 0); }
    rowLabel(i) { const p = this.PAGES[this.page]; return p.dynamic ? (this.dynLabel[i] || '') : (p.menu[i] ? p.menu[i][0] : ''); }
    rowAction(i) { const p = this.PAGES[this.page]; return p.dynamic ? (this.dynAction[i] || '') : (p.menu[i] ? p.menu[i][1] : ''); }
    setPage(i) {
      const n = this.PAGES.length; this.page = ((i % n) + n) % n;
      this.menuOpen = false; this.overlay = null;
      this.log(`[page] -> ${this.pageName} (${this.page + 1}/${n})`);
    }
    enterMenu() { if (!this.pageHasMenu()) return; this.menuOpen = true; this.menuCursor = 0; this.menuTop = 0; }
    exitMenu() { this.menuOpen = false; }
    menuMove(d) {
      const n = this.rowCount(); if (n <= 0) return;
      let c = this.menuCursor + d; if (c < 0) c = n - 1; if (c >= n) c = 0;
      this.menuCursor = c;
      if (c < this.menuTop) this.menuTop = c;
      else if (c >= this.menuTop + MENU_ROWS) this.menuTop = c - MENU_ROWS + 1;
      if (n <= MENU_ROWS) this.menuTop = 0;
    }
    toast(t) { if (this.overlay) return; this.toastText = t; this.toastUntil = this.now + 2000; }
    showAsking(cap) { this.overlay = { kind: 'asking', cap, progress: '' }; }
    showProgress(t) { if (this.overlay && this.overlay.kind === 'asking') this.overlay.progress = t; }
    showAnswer(title, lines) { this.overlay = { kind: 'answer', title, lines, until: this.now + 15000 }; }
    buildClaudeMenu() {
      const labels = [], actions = [];
      for (let i = 0; i < this.store.count && labels.length < 9; i++) {
        if (!this.store.k[i].startsWith('CLAUDE.P')) continue;
        const t = this.store.v[i]; if (!t) continue;
        labels.push(t); actions.push('ASK:CLAUDE ' + t);
      }
      labels.push('Type a question...'); actions.push('WHEEL:');
      this.dynLabel = labels.slice(0, DYN_MAX); this.dynAction = actions.slice(0, DYN_MAX);
      if (this.menuCursor >= this.dynLabel.length) this.menuCursor = 0;
    }

    // ---- buttons -----------------------------------------------------------------------
    press(name) { this.btn[name].down(this.now); }
    release(name) { this.btn[name].up(this.now); }
    pollInput() {
      const b = this.btn, q = this.evq;
      let r;
      if ((r = b.UP.poll(this.now)))   q.push(['UP', b.UP.wasRepeat]);
      if ((r = b.DOWN.poll(this.now))) q.push(['DOWN', b.DOWN.wasRepeat]);
      r = b.SELECT.poll(this.now); if (r === 'LONG') q.push(['SELECT_LONG']); else if (r) q.push(['SELECT']);
      if (b.LEFT.poll(this.now))  q.push(['LEFT']);
      if (b.RIGHT.poll(this.now)) q.push(['RIGHT']);
      r = b.MEDIA.poll(this.now); if (r >= 1 && r <= 3) q.push(['MEDIA_' + r]);
      r = b.BOOT.poll(this.now); if (r === 'LONG') q.push(['BOOT_LONG']); else if (r) q.push(['BOOT']);
      return q.length ? q.shift() : null;
    }

    handle(evt) {
      if (!evt) return;
      const [ev, isRepeat] = evt, a = this.al;
      this.log(`[in  ] ${ev}${isRepeat ? ' (repeat)' : ''}`);
      const notBoot = ev !== 'BOOT' && ev !== 'BOOT_LONG';

      if (a.ringing && notBoot) {                                   // a ringing alarm owns everything
        if (ev === 'SELECT' || ev === 'SELECT_LONG') { a.ringing = false; a.snoozeUntil = 0; this.toast('alarm dismissed'); }
        else { a.ringing = false; a.snoozeUntil = this.now + 9 * 60000; this.toast('snoozed 9 min'); }
        return;
      }
      if (a.editing) {                                               // alarm editing owns everything
        if (ev === 'UP') this.alarmEditStep(+1);
        else if (ev === 'DOWN') this.alarmEditStep(-1);
        else if (ev === 'RIGHT') this.alarmEditMove(+1);
        else if (ev === 'LEFT') this.alarmEditMove(-1);
        else if (ev === 'SELECT' || ev === 'SELECT_LONG') { this.alarmEditExit(); this.toast('alarm saved'); }
        return;
      }
      if (this.wheel.on) {                                           // the character wheel
        const w = this.wheel, N = WHEEL_CHARS.length;
        if (ev === 'UP') w.idx = (w.idx + N - 1) % N;
        else if (ev === 'DOWN') w.idx = (w.idx + 1) % N;
        else if (ev === 'SELECT') { if (w.text.length < 96) w.text += WHEEL_CHARS[w.idx]; }
        else if (ev === 'SELECT_LONG') {
          if (!w.text.length) { this.toast('nothing typed'); return; }
          if (!this.linkUsable()) { this.toast('laptop not connected'); return; }
          const q = w.text.trim(); this.wheel = { on: false, idx: 0, text: '' }; this.askSend('CLAUDE', q);
        } else if (ev === 'LEFT') {
          if (w.text.length) w.text = w.text.slice(0, -1); else this.wheel = { on: false, idx: 0, text: '' };
        } else if (ev === 'RIGHT') { if (w.text.length < 96) w.text += ' '; }
        return;
      }
      if (this.overlay && notBoot) { this.overlay = null; return; }   // any button dismisses an answer

      switch (ev) {
        case 'DOWN':
          if (!this.menuOpen) {
            if (!this.pageHasMenu()) { this.toast('no list on this page'); break; }
            if (this.PAGES[this.page].dynamic) this.buildClaudeMenu();
            this.enterMenu();
          } else this.menuMove(+1);
          break;
        case 'UP':
          if (!this.menuOpen) break;
          if (this.menuCursor === 0) this.exitMenu(); else this.menuMove(-1);
          break;
        case 'LEFT': case 'RIGHT': {
          const right = ev === 'RIGHT';
          if (this.menuOpen && !right) this.exitMenu();
          else { this.setPage(this.page + (right ? 1 : -1)); this.store.setLocal('UI.PAGE', this.pageName); }
          break;
        }
        case 'SELECT':
          if (this.menuOpen) {
            const act = this.rowAction(this.menuCursor);
            if (act.startsWith('WHEEL:')) { this.exitMenu(); this.wheel = { on: true, idx: 0, text: '' }; }
            else if (act.startsWith('ASK:')) {
              const rest = act.slice(4), sp = rest.indexOf(' ');
              const cap = sp < 0 ? rest : rest.slice(0, sp), arg = sp < 0 ? '' : rest.slice(sp + 1);
              if (!this.linkUsable()) this.toast('laptop not connected'); else this.askSend(cap, arg);
            } else if (!act.length) this.toast('nothing bound to this row');
            else if (!this.linkUsable()) this.toast('laptop not connected');
            else { this.sendCommand(act); this.toast(this.rowLabel(this.menuCursor)); }
          } else if (this.pageHasMenu()) {
            if (this.PAGES[this.page].dynamic) this.buildClaudeMenu();
            this.enterMenu();
          } else if (this.pageName === 'ALARM') this.alarmEditEnter();
          else this.toast('no list on this page');
          break;
        case 'SELECT_LONG':
          if (this.menuOpen) this.exitMenu();
          else { this.wantSync = true; this.toast('resyncing'); }
          break;
        case 'MEDIA_1': this.sendCommand('MEDIA.PLAYPAUSE'); break;
        case 'MEDIA_2': this.sendCommand('MEDIA.NEXT'); break;
        case 'MEDIA_3': this.sendCommand('MEDIA.PREV'); break;
        case 'BOOT':
          if (!this.linkUsable()) this.enterPairingMode(); else this.toast('already connected');
          break;
        case 'BOOT_LONG': this.forgetAllBonds(); break;
      }
    }

    // ---- the main loop --------------------------------------------------------------------
    tick(now) {
      this.now = now;
      if (this.linkState === 'PAIRING' && now > this.pairingUntil) {
        this.log('[pair] pairing window closed'); this.setLink('ADVERTISING');
      }
      const up = Math.floor((now - this.bootAt) / 1000);
      this.store.setLocal('DEV.UPTIME', up);
      this.store.setLocal('DEV.HEAP', 212 - (up % 7));
      this.alarmTick();
      for (let guard = 0; guard < 4; guard++) {
        const evt = this.pollInput(); if (!evt) break; this.handle(evt);
      }
      if (this.toastUntil && now > this.toastUntil) this.toastUntil = 0;
      if (this.overlay && this.overlay.kind === 'answer' && now > this.overlay.until) this.overlay = null;
      if (this.wantSync) {
        this.wantSync = false;
        if (this.linkUsable()) { this.log('[sync] requesting resync'); this.send('$SYNC?'); }
      }
    }

    // =========================================================================
    //  Rendering -- display.cpp, on a 320x240 canvas
    // =========================================================================
    render(ctx) {
      this.ctx = ctx;
      const t = this.now - this.bootAt;
      ctx.save();
      ctx.textBaseline = 'top';
      if (t < 600) {                                                   // selfTest colour bars
        const bars = ['#ff0000', '#00ff00', '#0000ff', '#ffffff'];
        bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * (W / 4), 0, W / 4, H); });
        ctx.restore(); return;
      }
      this.fill(C.BG, 0, 0, W, H);
      if (t < 1100) {                                                   // splash
        this.text('ESP32 Hub', W / 2, H / 2 - 16 + 13, 4, C.ACCENT, 'center', true);
        this.text('waiting for laptop', W / 2, H / 2 + 14 + 8, 2, C.DIM, 'center', true);
        ctx.restore(); return;
      }
      if (this.wheel.on) { this.drawWheel(); this.drawToast(); ctx.restore(); return; }
      if (this.overlay) { this.drawOverlay(); ctx.restore(); return; }

      this.drawHeader();
      this.drawLinkDot();
      if (this.menuOpen) this.drawMenu(); else this['draw' + this.PAGES[this.page].draw]();
      this.drawToast();
      ctx.restore();
    }

    // ---- primitives ---------------------------------------------------------------------
    setFont(font) { this.ctx.font = `${font === 6 ? '600 ' : ''}${FONT_PX[font]}px ${FONT_FAMILY[font]}`; }
    textWidth(s, font) { this.setFont(font); return this.ctx.measureText(s).width; }
    fill(c, x, y, w, h) { this.ctx.fillStyle = c; this.ctx.fillRect(x, y, w, h); }
    text(s, x, y, font, color, align = 'left', mid = false) {
      this.setFont(font); this.ctx.fillStyle = color; this.ctx.textAlign = align;
      const dy = Math.round((FONT_H[font] - FONT_PX[font]) / 2) - 1;
      this.ctx.textBaseline = mid ? 'alphabetic' : 'top';
      this.ctx.fillText(s, x, mid ? y + FONT_PX[font] * 0.35 : y + dy);
      this.ctx.textAlign = 'left'; this.ctx.textBaseline = 'top';
    }
    fitWidth(s, maxW, font) {
      if (this.textWidth(s, font) <= maxW) return s;
      let out = s;
      while (out.length > 1 && this.textWidth(out + '...', font) > maxW) out = out.slice(0, -1);
      return out.trim() + '...';
    }
    drawWrapped(s, x, y, maxW, font, color, maxH = 140) {
      const lineH = FONT_H[font]; let rest = s, used = 0;
      while (rest.length > 0 && used + lineH <= maxH) {
        let cut = rest.length;
        while (cut > 0 && this.textWidth(rest.slice(0, cut), font) > maxW) {
          const sp = rest.lastIndexOf(' ', cut - 1);
          cut = sp > 0 ? sp : cut - 1;
        }
        if (cut <= 0) cut = 1;
        this.text(rest.slice(0, cut), x, y + used, font, color);
        used += lineH; rest = rest.slice(cut).trim();
      }
      return used;
    }
    field(f, s, color) {                       // drawField(): tall fields wrap, short ones truncate
      color = color || f.color;
      this.fill(C.BG, f.x, f.y, f.w, f.h);
      if (!s) return;
      if (f.h >= FONT_H[f.font] * 2) this.drawWrapped(s, f.x, f.y, f.w, f.font, color, f.h);
      else this.text(this.fitWidth(s, f.w, f.font), f.x, f.y, f.font, color);
    }

    // ---- chrome --------------------------------------------------------------------------
    drawHeader() {
      const g = this.ctx, name = this.pageName, n = this.PAGES.length;
      this.text(name, 8, 5, 4, this.menuOpen ? C.DIM : C.ACCENT);
      const nameW = this.textWidth(name, 4);
      if (this.menuOpen) this.text('^ up', 12 + nameW, 9, 2, C.DIM);
      else {
        this.fill(C.ACCENT, 8, 24, nameW, 1);
        if (this.pageHasMenu()) this.text('v menu', 12 + nameW, 9, 2, C.DIM);
      }
      const x0 = W - 30 - n * 10;
      for (let i = 0; i < n; i++) {
        g.beginPath(); g.arc(x0 + i * 10, 13, 3, 0, 6.2832);
        if (i === this.page) { g.fillStyle = C.ACCENT; g.fill(); } else { g.strokeStyle = '#3a4a3a'; g.lineWidth = 1; g.stroke(); }
      }
      this.fill(C.PANEL, 0, HEADER_H + 2, W, 1);
    }
    drawLinkDot() {
      const col = { ONLINE: C.GOOD, LINKING: C.ACCENT, PAIRING: C.WARM, OFFLINE: C.BAD }[this.linkView];
      const g = this.ctx; g.beginPath(); g.arc(W - 13, 13, 6, 0, 6.2832); g.fillStyle = col; g.fill();
    }
    drawToast() {
      if (!this.toastUntil || this.now > this.toastUntil) return;
      this.fill(C.PANEL, 0, H - 22, W, 22);
      this.text(this.fitWidth(this.toastText, W - 16, 2), 8, H - 19, 2, C.TEXT);
    }

    // ---- pages -----------------------------------------------------------------------------
    drawHome() {
      const s = this.store, F = (x, y, w, h, font, color) => ({ x, y: BODY_Y + y, w, h, font, color });
      this.field(F(8, 4, 170, 48, 6, C.TEXT), s.value('CLOCK.NOW', '--:--'));
      this.field(F(185, 16, 128, 18, 2, C.DIM), s.value('CLOCK.NICE'));
      this.field(F(8, 54, 110, 48, 6, C.ACCENT), s.has('WX.TEMPC') ? s.value('WX.TEMPC') + '°' : '--');
      this.field(F(125, 54, 188, 22, 4, C.TEXT), s.value('WX.COND'));
      let place = s.value('WX.PLACE');
      if (s.has('WX.MAXC') && s.has('WX.MINC')) place += `  H${s.value('WX.MAXC')} L${s.value('WX.MINC')}`;
      this.field(F(125, 80, 188, 18, 2, C.DIM), place);
      this.field(F(8, 132, 304, 18, 2, C.WARM), s.has('NOTIF.TITLE') ? `${s.value('NOTIF.APP')}: ${s.value('NOTIF.TITLE')}` : '');
    }
    drawMedia() {
      const s = this.store, F = (x, y, w, h, font, color) => ({ x, y: BODY_Y + y, w, h, font, color });
      const playing = s.value('MEDIA.STATE') === 'playing';
      if (s.has('MEDIA.TITLE')) {
        this.field(F(8, 8, 304, 24, 4, C.TEXT), s.value('MEDIA.TITLE'), playing ? C.TEXT : C.DIM);
        this.field(F(8, 36, 304, 20, 4, C.DIM), s.value('MEDIA.ARTIST'));
        this.field(F(8, 62, 304, 18, 2, C.DIM), s.value('MEDIA.ALBUM'));
        this.field(F(8, 110, 304, 24, 4, C.WARM), playing ? '> playing' : '|| ' + s.value('MEDIA.STATE', 'paused'), playing ? C.GOOD : C.WARM);
        this.field(F(8, 140, 304, 18, 2, C.DIM), s.value('MEDIA.APP', 'media'));
      } else this.field(F(8, 8, 304, 24, 4, C.TEXT), 'Nothing playing', C.DIM);
    }
    drawNotify() {
      const s = this.store, F = (x, y, w, h, font, color) => ({ x, y: BODY_Y + y, w, h, font, color });
      if (s.has('NOTIF.TITLE') || s.has('NOTIF.APP')) {
        this.field(F(8, 8, 304, 24, 4, C.ACCENT), s.value('NOTIF.APP', 'notification'));
        this.field(F(8, 38, 304, 20, 4, C.TEXT), s.value('NOTIF.TITLE'));
        this.field(F(8, 64, 304, 40, 2, C.DIM), s.value('NOTIF.BODY'));
        this.field(F(8, 140, 304, 18, 2, C.DIM), 'total since start: ' + s.value('NOTIF.COUNT', '0'));
      } else this.field(F(8, 8, 304, 24, 4, C.ACCENT), 'No notifications', C.DIM);
    }
    rowField(i) { return { x: 8, y: BODY_Y + 4 + i * 26, w: 304, h: 22, font: 4, color: C.TEXT }; }
    drawStocks() {
      const s = this.store; let row = 0;
      for (let i = 0; i < s.count && row < 6; i++) {
        const k = s.k[i]; if (!k.startsWith('STOCK.') || k.endsWith('.PCT')) continue;
        const sym = k.slice(6), pct = s.value(`STOCK.${sym}.PCT`), up = !pct.startsWith('-');
        this.field(this.rowField(row), `${sym}   ${s.v[i]}   ${pct}%`, pct ? (up ? C.GOOD : C.BAD) : C.TEXT);
        row++;
      }
      if (row === 0) this.field(this.rowField(row++), 'No watchlist', C.DIM);
    }
    drawStatus() {
      const s = this.store, R = (i) => this.rowField(i);
      this.field(R(0), 'link    ' + s.value('DEV.LINK', '?'), s.value('DEV.LINK') === 'ACTIVE' ? C.GOOD : C.WARM);
      this.field(R(1), 'uptime  ' + s.value('DEV.UPTIME', '0') + 's', C.TEXT);
      this.field(R(2), 'heap    ' + s.value('DEV.HEAP', '?') + ' KB', C.TEXT);
      this.field(R(3), 'keys    ' + s.count, C.TEXT);
      this.field(R(4), 'bright  ' + s.value('CFG.BRIGHTNESS', '?'), C.DIM);
      this.field(R(5), s.value('DEV.NAME', 'ESP32-Hub'), C.DIM);
    }
    drawClaude() {
      const s = this.store, F = (x, y, w, h, font, color) => ({ x, y: BODY_Y + y, w, h, font, color });
      if (s.has('CLAUDE.LAST')) {
        this.field(F(8, 8, 304, 24, 4, C.ACCENT), 'last answer');
        this.field(F(8, 38, 304, 20, 4, C.DIM), s.value('CLAUDE.ASKED'));
        this.field(F(8, 64, 304, 40, 2, C.TEXT), s.value('CLAUDE.LAST'));
      } else {
        this.field(F(8, 8, 304, 24, 4, C.ACCENT), 'Claude');
        this.field(F(8, 38, 304, 20, 4, C.TEXT), 'press SELECT to ask');
      }
      this.field(F(8, 140, 304, 18, 2, C.DIM), s.has('CLAUDE.COUNT') ? `asked ${s.value('CLAUDE.COUNT')} times` : '');
    }
    drawAlarm() {
      const s = this.store, F = (x, y, w, h, font, color) => ({ x, y: BODY_Y + y, w, h, font, color });
      this.field(F(8, 4, 200, 48, 6, C.TEXT), s.value('CLOCK.NOW', '--:--'));
      const editing = s.value('ALARM.EDITING') === '1';
      const h = +(editing ? s.value('ALARM.EDIT_H') : s.value('ALARM.H'));
      const m = +(editing ? s.value('ALARM.EDIT_M') : s.value('ALARM.M'));
      const on = (editing ? s.value('ALARM.EDIT_ON') : s.value('ALARM.ON')) === '1';
      this.field(F(8, 58, 140, 48, 6, C.ACCENT), `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, editing ? C.WARM : C.ACCENT);
      this.field(F(155, 80, 90, 24, 4, C.TEXT), on ? 'ON' : 'OFF', on ? C.GOOD : C.DIM);
      let hint, col = C.DIM;
      if (s.value('ALARM.RINGING') === '1') { hint = 'RINGING -- SELECT stops it, any other key snoozes'; col = C.BAD; }
      else if (editing) {
        const f = s.value('ALARM.EDIT_FIELD'), which = f === 'HOUR' ? 'hour' : f === 'MIN' ? 'minute' : 'on/off';
        hint = `editing ${which} -- up/down change, left/right move, SELECT save`; col = C.WARM;
      } else if (s.value('ALARM.SNOOZING') === '1') { hint = 'snoozing'; col = C.WARM; }
      else hint = 'SELECT to set';
      this.field(F(8, 144, 304, 40, 2, C.DIM), hint, col);
    }

    // ---- menu / overlays / wheel ----------------------------------------------------------------
    drawMenu() {
      const x = 8, w = W - 16, n = this.rowCount(), g = this.ctx;
      for (let r = 0; r < MENU_ROWS; r++) {
        const idx = this.menuTop + r, y = BODY_Y + 2 + r * MENU_ROW_H;
        if (idx >= n) continue;
        const sel = idx === this.menuCursor;
        if (sel) {
          g.fillStyle = C.ACCENT; g.beginPath();
          if (g.roundRect) g.roundRect(x, y, w, MENU_ROW_H - 3, 4); else g.rect(x, y, w, MENU_ROW_H - 3);
          g.fill();
        }
        this.text(this.fitWidth(this.rowLabel(idx), w - 20, 4), x + 10, y + 3, 4, sel ? C.BG : C.TEXT);
      }
      if (n > MENU_ROWS) {
        const barH = Math.floor((MENU_ROWS * (H - BODY_Y - 8)) / n), barY = BODY_Y + Math.floor((this.menuTop * (H - BODY_Y - 8)) / n);
        this.fill('#2a3a2a', W - 5, barY, 3, barH);
      }
    }
    drawOverlay() {
      const o = this.overlay;
      if (o.kind === 'asking') {
        this.text('asking', 10, 12, 2, C.DIM);
        this.text(this.fitWidth(o.cap, W - 20, 4), 10, 34, 4, C.ACCENT);
        const dots = '.'.repeat(1 + (Math.floor(this.now / 400) % 3));
        this.text(o.progress ? '' : dots, 10, 80, 6, C.WARM);
        if (o.progress) this.text(this.fitWidth(o.progress, W - 20, 4), 10, 82, 4, C.WARM);
      } else {
        this.text(this.fitWidth(o.title, W - 20, 2), 10, 8, 2, C.DIM);
        this.fill(C.PANEL, 0, 28, W, 1);
        let y = 40;
        o.lines.forEach((ln, i) => {
          if (y >= H - 24) return;
          y += this.drawWrapped(ln, 10, y, W - 20, i === 0 ? 4 : 2, i === 0 ? C.TEXT : C.DIM, H - 24 - y); y += 6;
        });
      }
    }
    drawWheel() {
      const w = this.wheel;
      this.text('ask claude', 10, 6, 2, C.DIM);
      this.fill(C.PANEL, 0, 26, W, 1);
      this.drawWrapped(w.text.length ? w.text : '_', 10, 32, W - 20, 2, C.TEXT, 60);
      const prev = WHEEL_CHARS[(w.idx + WHEEL_CHARS.length - 1) % WHEEL_CHARS.length];
      const next = WHEEL_CHARS[(w.idx + 1) % WHEEL_CHARS.length];
      this.text(prev === ' ' ? '␣' : prev, W / 2 - 70, 112, 4, '#3a4a3a', 'center');
      this.text(WHEEL_CHARS[w.idx] === ' ' ? '␣' : WHEEL_CHARS[w.idx], W / 2, 114 + 24, 6, C.ACCENT, 'center', true);
      this.text(next === ' ' ? '␣' : next, W / 2 + 70, 112, 4, '#3a4a3a', 'center');
      const hint = w.text.length === 0 ? 'UP/DN letter  SEL add  RIGHT space  LEFT exit' : 'SEL add  hold SEL send  LEFT del  RIGHT space';
      this.text(this.fitWidth(hint, W - 20, 2), 10, H - 26, 2, C.DIM);
    }

    // ---- serial console (a subset of main.cpp's handleConsole) ---------------------------------------
    console(raw) {
      const cmd = raw.trim().toLowerCase();
      this.log('> ' + raw);
      if (cmd === 'next' || cmd === 'n') this.sendCommand('MEDIA.NEXT');
      else if (cmd === 'prev' || cmd === 'p') this.sendCommand('MEDIA.PREV');
      else if (cmd === 'pp') this.sendCommand('MEDIA.PLAYPAUSE');
      else if (cmd === 'stop') this.sendCommand('MEDIA.STOP');
      else if (cmd === 'sync') this.wantSync = true;
      else if (cmd === 'keys') {
        this.store.entries().forEach((e) => this.log(`[state] ${e.k.padEnd(18)} = ${e.v}  (${e.owner})`));
        this.log(`[state] ${this.store.count}/${StateStore.MAX_KEYS} keys`);
      } else if (cmd === 'btn') {
        const b = this.btn; this.log('[in  ] ' + ['UP', 'DOWN', 'SELECT', 'LEFT', 'RIGHT', 'MEDIA'].map((n) => `${n}=${b[n].stable ? 'DOWN' : 'up'}`).join(' '));
      } else if (cmd === 'page' || cmd === 'p+') this.setPage(this.page + 1);
      else if (cmd === 'hw') {
        ['[hw  ] ---- chip ----', '[hw  ] ESP32-S3 rev 0, 2 core(s) @ 240 MHz', '[hw  ] Arduino core 3.3.9',
         '[hw  ] ---- flash ----', '[hw  ] configured: 16777216 bytes (16 MB)', '[hw  ] ---- PSRAM ----',
         '[hw  ] BOARD_HAS_PSRAM is defined in the build', '[hw  ] total 8388608 bytes (8.0 MB), free 8386000',
         '[hw  ] ---- audio budget ----', '[hw  ] usable contiguous: 8386000 bytes -> 262.1 s of 16k mono int16']
          .forEach((l) => this.log(l));
      } else if (cmd === 'help') this.log('commands: next prev pp stop sync keys btn page hw help');
      else this.log(`unknown command '${cmd}' -- try help`);
    }
  }

  global.HubFirmware = HubFirmware;
  global.HubConst = { C, W, H, WHEEL_CHARS };
  if (typeof module !== 'undefined') module.exports = { HubFirmware, StateStore, Btn };
})(typeof window !== 'undefined' ? window : globalThis);
