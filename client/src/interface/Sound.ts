/**
 * Mesin suara KOTA KITA — semua suara DIBUAT dengan kode (WebAudio synth),
 * tanpa file audio eksternal, jadi tidak ada masalah lisensi sama sekali.
 * Suara: ambience angin + kicau burung acak, langkah kaki, klik UI, pop chat.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private chirpTimer = 0;
  muted = false;

  /** Harus dipanggil dari gestur pengguna (klik tombol Masuk) — aturan browser. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this.startWind();
    this.scheduleChirps();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  private noiseBuffer(seconds = 1): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Angin kota yang lembut: noise loop lewat lowpass pelan. */
  private startWind() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(2);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    // Napas angin: LFO mengubah volume pelan-pelan.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    src.start();
    lfo.start();
  }

  /** Kicau burung acak setiap 5–12 detik (siang terasa hidup). */
  private scheduleChirps() {
    const chirp = () => {
      if (this.ctx && !this.muted) {
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = ctx.currentTime;
        osc.type = "sine";
        osc.frequency.setValueAtTime(2300 + Math.random() * 500, t0);
        osc.frequency.exponentialRampToValueAtTime(3100 + Math.random() * 600, t0 + 0.09);
        osc.frequency.exponentialRampToValueAtTime(2500, t0 + 0.16);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.045, t0 + 0.03);
        gain.gain.linearRampToValueAtTime(0, t0 + 0.18);
        osc.connect(gain);
        gain.connect(this.master!);
        osc.start(t0);
        osc.stop(t0 + 0.2);
      }
      this.chirpTimer = window.setTimeout(chirp, 5000 + Math.random() * 7000);
    };
    this.chirpTimer = window.setTimeout(chirp, 2500);
  }

  /** Langkah kaki: semburan noise pendek berfilter rendah. */
  step(running: boolean) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.09);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = running ? 520 : 420;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(running ? 0.16 : 0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.085);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t0);
    src.stop(t0 + 0.09);
  }

  /** Klik UI pendek. */
  click() {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(660, t0);
    osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.06);
    gain.gain.setValueAtTime(0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }

  /** Pop lembut saat pesan chat datang/pergi. */
  pop() {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.07);
    gain.gain.setValueAtTime(0.07, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.1);
  }
}
