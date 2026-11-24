/* pace-dsp.js -- the BME463 pacemaker-pulse detector, ported from
 * pico-pacemaker-pulse-detection/BME463_Receiver/Labs/Final_Project.c
 *
 *   ADC/4095 -> HPF(31) -> derivative(5) -> square*100 -> MWI(10)*25 -> adaptive threshold
 *
 * Coefficients, scales, thresholds and the blanking/init logic are the ones in the C file.
 */
(function (g) {
  'use strict';
  const HP = [-0.03125, 0, 0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 0, 0, 0.03125, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const DER = [2, 1, 0, -1, -2], A_DER = 0.125, SQ = 100, MWI_N = 10, A_MWI = 1 / MWI_N, MWI_GAIN = 25;
  const MIN_T = 0.02, MAX_T = 0.80, BLANK = 4, INIT_N = 400;

  class PaceDetector {
    constructor() { this.reset(); }
    reset() {
      this.xhp = new Float32Array(HP.length); this.xd = new Float32Array(DER.length); this.xm = new Float32Array(MWI_N);
      this.xt = [0, 0, 0]; this.spki = 0.3; this.npki = 0; this.thr = 0.10; this.peakt = 0; this.peaki = 0;
      this.blank = 0; this.inBlank = false; this.initCount = 0; this.initDone = false; this.initMax = 0; this.initSum = 0;
      this.count = 0; this.paceHigh = false;
    }
    static fir(a, x, c) { let s = 0; for (let i = 0; i < c.length; i++) s += c[i] * x[i]; return a * s; }
    static shift(buf) { for (let i = buf.length - 1; i > 0; i--) buf[i] = buf[i - 1]; }
    // adcRaw: 0..4095. returns {hp, der, sq, mwi, thr, spki, detected, init}
    step(adcRaw) {
      const x = adcRaw / 4095;
      PaceDetector.shift(this.xhp); this.xhp[0] = x;
      const hp = PaceDetector.fir(1, this.xhp, HP);
      PaceDetector.shift(this.xd); this.xd[0] = hp;
      const der = PaceDetector.fir(A_DER, this.xd, DER);
      const sq = der * der * SQ;
      PaceDetector.shift(this.xm); this.xm[0] = sq;
      let mwi = 0; for (let i = 0; i < MWI_N; i++) mwi += this.xm[i];
      mwi = mwi * A_MWI * MWI_GAIN;

      let detected = false;
      if (!this.initDone) {
        if (mwi > this.initMax) this.initMax = mwi;
        this.initSum += mwi; this.initCount++;
        if (this.initCount >= INIT_N) {
          this.spki = this.initMax * 0.25; this.npki = (this.initSum / INIT_N) * 0.1;
          this.thr = this.npki + 0.25 * (this.spki - this.npki); if (this.thr < MIN_T) this.thr = MIN_T;
          this.initDone = true;
        }
        this.paceHigh = false;
        return { x, hp, der, sq, mwi, thr: this.thr, spki: this.spki, detected: false, init: true };
      }
      detected = this.detect(mwi);
      return { x, hp, der, sq, mwi, thr: this.thr, spki: this.spki, detected, init: false };
    }
    detect(m) {
      const xt = this.xt;
      if (this.inBlank) {
        if (--this.blank <= 0) { this.inBlank = false; this.blank = 0; }
        xt[2] = xt[1]; xt[1] = xt[0]; xt[0] = m; return false;
      }
      xt[2] = xt[1]; xt[1] = xt[0]; xt[0] = m;
      if (xt[1] >= xt[2] && xt[1] > this.peakt) this.peakt = xt[1];
      let detected = false;
      if (xt[1] <= xt[2] && xt[1] < 0.5 * this.peakt && this.peakt > 0) {
        this.peaki = this.peakt;
        const clamp = () => { this.thr = this.npki + 0.25 * (this.spki - this.npki); if (this.thr < MIN_T) this.thr = MIN_T; if (this.thr > MAX_T) this.thr = MAX_T; };
        if (this.peaki > this.thr) {
          this.spki = 0.125 * this.peaki + 0.875 * this.spki; clamp();
          this.paceHigh = true; this.inBlank = true; this.blank = BLANK; detected = true; this.count++;
        } else { this.npki = 0.125 * this.peaki + 0.875 * this.npki; clamp(); this.paceHigh = false; }
        this.peakt = 0;
      }
      return detected;
    }
  }

  // ---- synthetic ECG, normalised to the Pico's ADC range ------------------------------
  const gauss = (t, mu, s) => Math.exp(-0.5 * ((t - mu) / s) ** 2);
  function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  class EcgSource {
    constructor() { this.t = 0; this.beatT = 0; this.rr = 0.8; this.nextPaced = false; this.opts = { bpm: 72, paced: true, spike: 0.30, noise: 0.004, wander: 0.02 }; this.spikes = []; this.beatNo = 0; this.beats = []; }
    // returns {adc, pacePulse(true on the true spike sample)}
    sample(dt = 0.005) {
      const o = this.opts; this.t += dt; this.beatT += dt;
      if (this.beatT >= 60 / o.bpm * (1 + 0.04 * Math.sin(this.beatNo * 1.3))) { this.beatT = 0; this.beatNo++; this.spikeDone = false; this.paceThisBeat = o.paced && (this.beatNo % 5 !== 0); }
      const b = this.beatT;
      let v = 0;
      const wide = this.paceThisBeat ? 1.8 : 1;                           // paced QRS is wider
      v += 0.025 * gauss(b, 0.12, 0.025);                                  // P
      v -= 0.02 * gauss(b, 0.30 - 0.05, 0.015 * wide);                    // Q
      v += (this.paceThisBeat ? 0.08 : 0.10) * gauss(b, 0.30, 0.022 * wide); // R
      v -= 0.03 * gauss(b, 0.30 + 0.05, 0.018 * wide);                           // S
      v += 0.05 * gauss(b, 0.56, 0.045);                                   // T
      let pulse = false;
      if (this.paceThisBeat && !this.spikeDone && b >= 0.255) { v += o.spike; this.spikeDone = 'a'; pulse = true; }
      else if (this.spikeDone === 'a') { v -= o.spike * 0.4; this.spikeDone = 'b'; }
      v += o.wander * Math.sin(2 * Math.PI * 0.25 * this.t) + o.noise * randn();
      const adc = Math.max(0, Math.min(4095, Math.round((0.5 + v) * 4095)));
      return { adc, pulse };
    }
  }

  g.PaceDSP = { PaceDetector, EcgSource };
  if (typeof module !== 'undefined') module.exports = g.PaceDSP;
})(typeof window !== 'undefined' ? window : globalThis);
