/* main.js -- project cards, hash routing, lab lifecycle. */
(function () {
  'use strict';
  const GH = 'https://github.com/sashankvinnakota-jpg/';
  const PROJECTS = [
    { id: 'hub', n: '01', title: 'ESP32 Smart Hub', sub: 'ESP32-S3 · BLE · I²S · TFT', repo: 'esp32-smart-hub',
      blurb: 'A desk hub that pairs with a laptop over Bluetooth LE. Five buttons, a 320×240 display, a microphone, a speaker, an alarm, and a Claude assistant.',
      tags: ['ESP32-S3', 'BLE bonding', 'ILI9341', 'I²S', 'Python backend'],
      badge: 'The firmware logic (pages, menus, buttons, alarm, store, pairing) is ported from the C++. The radio, the glass and the laptop backend are simulated.' },
    { id: 'wearable', n: '02', title: 'Wearable Health Monitor', sub: 'ESP32 · IMU · PPG · OLED', repo: 'wearable-health-monitor',
      blurb: 'Wrist-worn monitor: MPU-6050 motion, MAX30102 heart-rate/SpO₂ optics, an analog pulse sensor and an OLED, on two FreeRTOS tasks and register-level drivers.',
      tags: ['FreeRTOS', 'I²C', 'MPU-6050', 'MAX30102', 'bring-up'],
      badge: 'Sensors are simulated, modelled on the firmware\'s tasks, buffers and OLED screens. Like the repo, it is at bring-up: no heart-rate algorithm is faked.' },
    { id: 'pace', n: '03', title: 'Pacemaker Pulse Detection', sub: 'Raspberry Pi Pico · DSP', repo: 'pico-pacemaker-pulse-detection',
      blurb: 'Detects pacemaker spikes in ECG on a Pico with a modified Pan–Tompkins chain tuned for very fast pulses, tested on MIT-BIH records.',
      tags: ['RP2040', 'DSP', 'Pan–Tompkins', 'C', 'ECG'],
      badge: 'The filter chain, constants and adaptive threshold are ported from Final_Project.c and run live. The ECG is synthetic so you can change it.' },
    { id: 'camera', n: '04', title: 'Camera Playground', sub: 'XIAO ESP32-S3 · OpenCV', repo: 'esp32-camera-vision',
      blurb: 'Streams camera frames over USB and turns pixels into centimetres with ArUco markers and a calibrated pinhole model.',
      tags: ['ESP32-S3', 'OpenCV', 'ArUco', 'calibration', 'Python'],
      badge: 'The pinhole maths is simulated in the browser. The real pipeline uses OpenCV (solvePnP) on frames streamed from the board.' },
    { id: 'cipher', n: '05', title: 'PSoC Cipher Game', sub: 'PSoC 6 · FreeRTOS · UART', repo: 'psoc-freertos-cipher-game',
      blurb: 'Two boards, one UART link, a custom packet protocol and a code-cracking game, built on a task-per-peripheral FreeRTOS design.',
      tags: ['PSoC 6', 'FreeRTOS', 'UART IPC', 'ModusToolbox'],
      badge: 'Packet framing, commands, payloads and checksum are the real ones. The handshake order is simplified and board B is a browser AI.' },
  ];
  const $ = (s) => document.querySelector(s);
  const shorten = { hub: 'Desk display that pairs with a laptop over BLE with bonded, encrypted reconnection: buttons, alarm, media, stocks and a Claude assistant.',
    wearable: 'ESP32 wearable with an IMU, PPG sensor and OLED. Register-level drivers and FreeRTOS tasks share one I²C bus.',
    pace: 'Real-time pacemaker spike detector on a Raspberry Pi Pico at 200 Hz: 97% sensitivity and 99% precision across five MIT-BIH records.',
    camera: 'Turns camera pixels into centimetres with ArUco markers and a calibrated pinhole model. About 0.5 cm accuracy at 40–55 cm on synthetic data.',
    cipher: 'Two PSoC boards on one UART link, a custom packet protocol and a code-cracking game.' };
  const ART = {"hub": "<svg viewBox=\"0 0 120 70\"><path d=\"M14 54 L106 54 L106 62 L14 62Z\"/><path d=\"M26 54 L34 14 L86 14 L94 54\"/><rect x=\"40\" y=\"20\" width=\"40\" height=\"26\" class=\"a\"/><path class=\"th\" d=\"M44 25h22M44 30h30M44 35h18\"/><circle cx=\"34\" cy=\"58\" r=\"1.6\"/><circle cx=\"46\" cy=\"58\" r=\"1.6\"/><circle cx=\"58\" cy=\"58\" r=\"1.6\"/><circle cx=\"70\" cy=\"58\" r=\"1.6\"/><circle cx=\"82\" cy=\"58\" r=\"1.6\" class=\"a\"/></svg>", "wearable": "<svg viewBox=\"0 0 120 70\"><path d=\"M44 4h32l3 16H41Z\"/><path d=\"M41 50h38l-3 16H44Z\"/><rect x=\"38\" y=\"20\" width=\"44\" height=\"30\" rx=\"8\"/><rect x=\"45\" y=\"26\" width=\"30\" height=\"18\" rx=\"3\" class=\"a\"/><path class=\"th\" d=\"M48 36l5-5 4 8 4-6 5 3\"/><path class=\"th\" d=\"M82 30h4v10h-4\"/></svg>", "pace": "<svg viewBox=\"0 0 120 70\"><rect x=\"30\" y=\"10\" width=\"60\" height=\"50\" rx=\"3\"/><rect x=\"48\" y=\"24\" width=\"24\" height=\"22\"/><path class=\"th\" d=\"M30 20h-8M30 30h-8M30 40h-8M30 50h-8M90 20h8M90 30h8M90 40h8M90 50h8\"/><path class=\"a\" d=\"M8 66l10-0 4-10 4 18 4-14 6 6h10\"/><circle cx=\"84\" cy=\"16\" r=\"2\" class=\"a\"/></svg>", "camera": "<svg viewBox=\"0 0 120 70\"><rect x=\"8\" y=\"22\" width=\"26\" height=\"26\" rx=\"3\"/><circle cx=\"21\" cy=\"35\" r=\"7\"/><circle cx=\"21\" cy=\"35\" r=\"3\" class=\"a\"/><path class=\"th\" d=\"M34 28L100 8M34 42L100 62M100 8v54\"/><rect x=\"82\" y=\"26\" width=\"14\" height=\"14\" class=\"a\"/><path class=\"th\" d=\"M85 29h3v3h-3zM90 34h3v3h-3z\"/></svg>", "cipher": "<svg viewBox=\"0 0 120 70\"><rect x=\"6\" y=\"14\" width=\"34\" height=\"42\" rx=\"4\"/><rect x=\"80\" y=\"14\" width=\"34\" height=\"42\" rx=\"4\"/><rect x=\"12\" y=\"20\" width=\"22\" height=\"12\"/><rect x=\"86\" y=\"20\" width=\"22\" height=\"12\"/><path class=\"a\" d=\"M40 40h40\"/><circle cx=\"60\" cy=\"40\" r=\"2.5\" class=\"a\"/><circle cx=\"14\" cy=\"44\" r=\"2\"/><circle cx=\"22\" cy=\"44\" r=\"2\"/><circle cx=\"30\" cy=\"44\" r=\"2\"/><circle cx=\"88\" cy=\"44\" r=\"2\"/><circle cx=\"96\" cy=\"44\" r=\"2\"/><circle cx=\"104\" cy=\"44\" r=\"2\"/></svg>"};


  // ---- status + long-form write-ups ---------------------------------------------------
  const STATUS = { wearable: 'In progress', camera: 'In progress' };

  const STORY = {
    hub: [
      "This started as one narrow goal: run a script on my laptop, have it connect to an ESP32, and get bytes moving both ways without corruption. No auto-discovery, no reconnection, none of the rest. Everything else on the hub grew out of that link once it was solid.",
      "The decision I'm happiest with was separating the application protocol from the transport before there was a second transport to be separate from. Application logic sits on a framing layer, and the framing layer sits on BLE. When I added the audio path later, it bolted straight on without touching the framer.",
      "I also spent a day writing down why my first instincts were wrong, before writing any code. I had assumed the ESP32 would scan for the laptop, that I could identify the laptop by its MAC address, and that I'd need RSSI filtering to judge proximity. All three were wrong: the laptop has to do the scanning, Windows hands out a rotating random address, and BLE range is already the proximity filter — if it's connected, it's near. That day on paper saved me several evenings of dead ends.",
      "Pairing ended up being a physical button and BLE bonding rather than the key-exchange scheme I'd first sketched. Simpler, and the button makes the trust decision obvious to whoever is using it. I later ported the whole thing to a plain ESP32-WROOM-32, which has no PSRAM, so the wake word became a push-to-talk button and the voice clips got shorter."
    ],
    wearable: [
      "A wrist-worn monitor built around an ESP32: an MPU-6050 for motion, a MAX30102 for heart rate and SpO2, an analog pulse sensor as a second reference, and a small OLED for status. All three I2C devices share one bus.",
      "I want to be straight about where this one is: it's at hardware bring-up. The drivers, the FreeRTOS task scaffolding and the app state machine are working, but the algorithms that turn those signals into a heart rate, an SpO2 figure or a detected fall are not written yet. I'd rather say that than show numbers I haven't earned.",
      "The most useful thing I've learned so far came from a part refusing to identify itself. The MPU-6050 on my board answers WHO_AM_I with 0x70 instead of the value the datasheet led me to expect, so my driver rejected a chip that was working fine. The breakout also ships with its own 4.7 kΩ pull-ups, which is easy to miss and easy to make worse by adding more."
    ],
    pace: [
      "A pacemaker leaves a very fast, very narrow spike in an ECG. This runs on a Raspberry Pi Pico and tries to catch every one of them in real time, at 200 Hz, without firing on the heartbeat itself.",
      "The pipeline is a modified Pan–Tompkins: high-pass filter, derivative, squaring, a moving-window integrator, then an adaptive threshold. Pan–Tompkins was built to find QRS complexes, so most of the work was retuning it in the opposite direction — toward something much shorter and sharper than a heartbeat.",
      "I tested it against records 102, 104, 107, 113 and 217 from the MIT-BIH Arrhythmia Database, and it came out at 97% sensitivity and 99% precision. A GPIO pin goes high on every detection, and a second pin gives me a timing flag I can put on the scope to measure how long the processing actually takes."
    ],
    camera: [
      "This is the one I'm still working on. The idea is small and specific: turn what the camera sees into centimetres, and be able to prove the number is right.",
      "A XIAO ESP32S3 Sense streams JPEG frames to my laptop over the USB cable — no Wi-Fi — and Python with OpenCV does the vision. Print a ChArUco board, calibrate, and then ArUco markers give you X, Y and Z in centimetres, plus where one marker sits relative to another.",
      "So far I've checked it against computer-generated images where I already know the right answer: positions came within about 0.5 cm at 40 to 55 cm, marker-to-marker within about 0.6 cm, and the calibration recovered a known focal length to within 0.1%. Synthetic images are the easy case. What's left is measuring how much worse a real camera, a real print and a real tape measure make it — which is exactly the part I'm doing now."
    ],
    cipher: [
      "Two boards, one wire between them, and a game of Mastermind. Each player picks a secret four-digit cipher using digits 0 to 7, then they take turns guessing, and each guess comes back with how many digits were exactly right and how many were right but in the wrong place.",
      "The game is the excuse; the protocol is the actual project. Every message is a packet I defined myself: a start byte, a command, a sequence number, a payload and a checksum. Two boards that both want to go first have to settle it, so each sends a random token and the higher one wins, and they retry if they tie. The per-guess feedback is packed into a single byte, two bits for each of the four positions.",
      "Inside each board, every peripheral gets its own FreeRTOS task — UART receive and transmit, the LCD, buttons, joystick, capacitive touch, the IMU, the buzzer, EEPROM — and they're synchronised with event groups. Splitting it that way meant a slow display update couldn't make the board miss a packet."
    ]
  };

  // ---- bench photographs -------------------------------------------------------------
  const SHOTS = [
    ['testboard-green-led',  'Rails up — the good-voltage LED goes green while the probes stay on.'],
    ['probing-testboard',    'Probing the regulator input on the test board.'],
    ['analog-proc-rev74',    'Analog processing board, Rev 7.4, sitting on the test fixture.'],
    ['theremin-hand-play',   'Hand near the pitch antenna. The counter follows it: 394.809 kHz.'],
    ['theremin-antenna',     'Copper antenna on a hinged stand, counter reading 447.550 kHz.'],
    ['theremin-stack',       'The board stack driving the speaker, 454.594 kHz on the counter.'],
    ['lt2940-in-hand',       'LT2940 monitor board, Rev 7.4 — about the size of a thumb.'],
    ['psu-test-board',       'Power supply test board, Rev 7.'],
    ['breadboard-filter',    'Op-amp stage on the breadboard, resistor strips taped to the sheet behind.'],
    ['led-board',            'An RGB ring chasing under my finger. My name is in the silkscreen on this one.', 'vid'],
    ['tft-tiles-lit',        'TFT driving a numbered tile grid over the parallel bus.'],
    ['tft-tiles-dark',       'The same grid with the backlight off the glass.'],
    ['ecg-scope-paced',      'ECG capture: 997.17 mHz, 105 mVpp, with a second channel above it.'],
    ['ecg-scope-digital',    'ECG on channel 1 with two digital channels running alongside.'],
    ['ecg-3ch',              'Three channels on the same beat, 1.9910 Hz.'],
    ['ecg-noisy-spikes',     'A noisier capture — 1.33 Vpp, 320 mV amplitude.'],
    ['ecg-peak-detection',   'Working through peak detection with the scope stopped on a window.'],
    ['scope-fft-ecg',        'FFT across the trace, 100 Hz centre, 200 Hz span.'],
    ['scope-fft-lab',        'Same measurement, wider shot of the bench.'],
    ['scope-fft-bench',      'Cursor parked on 15 Hz, −35.06 dBV.'],
    ['scope-square-1',       'Four channels at 5 V/div, 500 µs/div.'],
    ['scope-square-2',       'The same capture, trigger moved.'],
    ['scope-sine-100hz',     '99.96 Hz sine, 8.2 Vpp.'],
    ['scope-wavegen',        'Built-in generator driving 10 Hz at 1 Vpp.'],
    ['digital-bus-1',        'Digital bus caught on autoscale.'],
    ['digital-bus-2',        'Closer on the same bus.'],
  ];

  // ---- work list ---------------------------------------------------------------------
  $('#work-list').innerHTML = PROJECTS.map((p) => `
    <a class="row" href="#${p.id}">
      <span class="row-n">${p.n}</span>
      <span class="row-art">${ART[p.id].replace('<svg ', '<svg class="row-svg" ')}</span>
      <span class="row-main"><b>${p.title}${STATUS[p.id] ? '<em class="chip">' + STATUS[p.id] + '</em>' : ''}</b><i>${p.sub}</i></span>
      <span class="row-desc">${shorten[p.id]}</span>
      <span class="row-go">OPEN&nbsp;↗</span>
    </a>`).join('');

  const esc = (s) => s.replace(/"/g, '&quot;');
  $('#sheet').innerHTML = SHOTS.map(([f, cap, kind], i) => `
    <figure class="cell${kind === 'vid' ? ' is-vid' : ''}" data-i="${i}">
      ${kind === 'vid'
        ? `<video src="img/vid/${f}.mp4" poster="img/vid/${f}.jpg" muted loop playsinline autoplay preload="metadata" aria-label="${esc(cap)}"></video><span class="vid-tag">CLIP</span>`
        : `<img src="img/thumb/${f}.jpg" alt="${esc(cap)}" loading="lazy" decoding="async">`}
      <figcaption>${cap}</figcaption>
    </figure>`).join('');

  // ---- lightbox ----------------------------------------------------------------------
  const lb = $('#lb'), lbImg = $('#lb-img'), lbVid = $('#lb-vid'), lbCap = $('#lb-cap'), lbN = $('#lb-n');
  let li = -1;
  function openShot(i) {
    li = (i + SHOTS.length) % SHOTS.length;
    const [f, cap, kind] = SHOTS[li];
    if (kind === 'vid') {
      lbImg.removeAttribute('src'); lbImg.hidden = true;
      lbVid.hidden = false; lbVid.src = 'img/vid/' + f + '.mp4'; lbVid.poster = 'img/vid/' + f + '.jpg';
      lbVid.play().catch(() => {});
    } else {
      lbVid.pause(); lbVid.removeAttribute('src'); lbVid.hidden = true;
      lbImg.hidden = false; lbImg.src = 'img/full/' + f + '.jpg'; lbImg.alt = cap;
    }
    lbCap.textContent = cap;
    lbN.textContent = String(li + 1).padStart(2, '0') + ' / ' + SHOTS.length;
    lb.classList.add('on'); document.body.classList.add('locked');
  }
  function closeShot() { lb.classList.remove('on'); document.body.classList.remove('locked');
    lbImg.removeAttribute('src'); lbVid.pause(); lbVid.removeAttribute('src'); li = -1; }
  $('#sheet').addEventListener('click', (e) => { const c = e.target.closest('.cell'); if (c) openShot(+c.dataset.i); });
  $('#lb-close').onclick = closeShot;
  $('#lb-prev').onclick = (e) => { e.stopPropagation(); openShot(li - 1); };
  $('#lb-next').onclick = (e) => { e.stopPropagation(); openShot(li + 1); };
  lb.addEventListener('click', (e) => { if (e.target === lb || e.target.id === 'lb-stage') closeShot(); });
  document.addEventListener('keydown', (e) => {
    if (li < 0) return;
    if (e.key === 'Escape') closeShot();
    else if (e.key === 'ArrowLeft') openShot(li - 1);
    else if (e.key === 'ArrowRight') openShot(li + 1);
  });

  // ---- reveal on scroll ---------------------------------------------------------------
  if (window.IntersectionObserver) {
    const io = new IntersectionObserver((en) => en.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('seen'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.row, .cell, .rise').forEach((n) => io.observe(n));
  } else document.querySelectorAll('.row, .cell, .rise').forEach((n) => n.classList.add('seen'));

  // ---- labs ----------------------------------------------------------------------------
  const body = document.body;
  let cleanup = null, current = null, scrollY = 0;
  function openLab(id) {
    const p = PROJECTS.find((x) => x.id === id); if (!p) return closeLab();
    if (current === id) return;
    if (!current) scrollY = window.scrollY;
    closeLab(true); current = id; closeShot(); body.classList.add('in-lab');
    $('#lab-name').textContent = p.title; $('#lab-eyebrow').textContent = 'SH-' + p.n + ' / ' + p.sub.toUpperCase();
    $('#lab-desc').textContent = shorten[id];
    $('#lab-status').innerHTML = STATUS[id] ? '<em class="chip">' + STATUS[id] + '</em>' : '';
    $('#lab-story').innerHTML = '<h2>About this project</h2>' + (STORY[id] || []).map((t) => '<p>' + t + '</p>').join('');
    $('#lab-notice').textContent = 'What is real: ' + p.badge;
    $('#lab-src').href = GH + p.repo;
    try { cleanup = window.Labs[id].mount($('#lab-root')); }
    catch (e) { $('#lab-root').innerHTML = `<div class="err">This simulation needs WebGL, and it failed to start: ${String(e.message || e)}</div>`; console.error(e); }
    window.scrollTo(0, 0);
  }
  function closeLab(keep) {
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    $('#lab-root').innerHTML = ''; const was = current; current = null;
    if (!keep) { body.classList.remove('in-lab'); if (was) window.scrollTo(0, scrollY); }
  }
  function route() { const h = location.hash.replace('#', ''); if (PROJECTS.some((p) => p.id === h)) openLab(h); else closeLab(); }
  const home = () => { history.replaceState(null, '', location.pathname + location.search); route(); };
  $('#lab-back').onclick = home; $('#brand').onclick = (e) => { e.preventDefault(); home(); };
  $('#nav-home').onclick = (e) => { e.preventDefault(); home(); };
  document.querySelectorAll('[data-to]').forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    if (current) { history.replaceState(null, '', location.pathname + location.search); closeLab(); }
    const t = document.getElementById(a.dataset.to);
    requestAnimationFrame(() => t && t.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }));
  addEventListener('scroll', () => document.querySelector('.top').classList.toggle('solid', scrollY !== null && window.scrollY > 40), { passive: true });
  window.addEventListener('hashchange', route); route();
})();
