/**
 * Game audio.
 *
 * Two layers, in priority order:
 *   1. Real samples — if a file exists at `public/audio/<name>.*` it is decoded
 *      once and played back. This is the path for shipping polished CC0 sound
 *      effects: drop files matching SAMPLE_MANIFEST into packages/client/public/
 *      audio/ and they are picked up automatically (see docs/ASSETS.md).
 *   2. Procedural fallback — richer WebAudio synthesis (layered oscillators +
 *      filtered noise through a soft master bus) so the game always has sound
 *      even with zero bundled assets.
 *
 * Browser autoplay policy: the AudioContext starts suspended and is only resumed
 * after a real user gesture (see `unlock()`), called from the click-to-play flow.
 */
export type Sfx =
  | "ui"
  | "shoot"
  | "reload"
  | "jump"
  | "transform"
  | "hit"
  | "eliminate"
  | "countdown"
  | "round_start"
  | "round_end"
  | "taunt";

/**
 * Optional real-sample files. Any subset can be provided; missing ones fall back
 * to synthesis. Base path is served from the client `public/audio/` folder.
 * Multiple candidate extensions are tried so both .mp3 and .ogg/.wav drops work.
 */
const SAMPLE_BASE = "audio/";
const SAMPLE_EXTS = ["ogg", "mp3", "wav"];
const SAMPLE_NAMES: Sfx[] = [
  "ui",
  "shoot",
  "reload",
  "jump",
  "transform",
  "hit",
  "eliminate",
  "countdown",
  "round_start",
  "round_end",
  "taunt",
];

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null; // pre-master (compressor input)
  private buffers = new Map<Sfx, AudioBuffer>();
  private loadTried = false;
  enabled = true;

  /** Must be called from a user-gesture handler (click/keydown). */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();

      // Soft master bus: everything -> gentle low-pass (tames harsh synth highs)
      // -> compressor (glues + prevents clipping when cues overlap) -> master gain.
      this.bus = this.ctx.createGain();
      this.bus.gain.value = 1;

      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 7200;
      lp.Q.value = 0.4;

      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 24;
      comp.ratio.value = 3.2;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;

      this.bus.connect(lp).connect(comp).connect(this.master).connect(this.ctx.destination);

      void this.loadSamples();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Try to fetch + decode any provided real samples (best-effort, non-blocking). */
  private async loadSamples() {
    if (this.loadTried || !this.ctx) return;
    this.loadTried = true;
    await Promise.all(
      SAMPLE_NAMES.map(async (name) => {
        for (const ext of SAMPLE_EXTS) {
          try {
            const res = await fetch(`${SAMPLE_BASE}${name}.${ext}`);
            if (!res.ok) continue;
            const arr = await res.arrayBuffer();
            const buf = await this.ctx!.decodeAudioData(arr);
            this.buffers.set(name, buf);
            return; // first successful extension wins
          } catch {
            /* not present / not decodable — fall through to synthesis */
          }
        }
      }),
    );
  }

  // ---- synthesis primitives ------------------------------------------------

  /** A shaped oscillator note with attack/decay and optional pitch glide + filter. */
  private tone(
    freq: number,
    dur: number,
    opts: { type?: OscillatorType; slideTo?: number; gain?: number; attack?: number; delay?: number; cutoff?: number } = {},
  ) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    const { type = "sine", slideTo, gain = 0.8, attack = 0.008, delay = 0, cutoff } = opts;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    let tail: AudioNode = g;
    if (cutoff) {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cutoff;
      g.connect(f);
      tail = f;
    }
    osc.connect(g);
    tail.connect(this.bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** Filtered noise burst — the body of impacts, gunshots and footsteps. */
  private noise(dur: number, opts: { gain?: number; type?: BiquadFilterType; cutoff?: number; delay?: number } = {}) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    const { gain = 0.6, type = "lowpass", cutoff = 2000, delay = 0 } = opts;
    const t0 = this.ctx.currentTime + delay;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.bus);
    src.start(t0);
  }

  private playSample(sfx: Sfx): boolean {
    if (!this.ctx || !this.bus) return false;
    const buf = this.buffers.get(sfx);
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.bus);
    src.start(this.ctx.currentTime);
    return true;
  }

  // ---- cue dispatch --------------------------------------------------------

  play(sfx: Sfx) {
    if (!this.ctx || !this.enabled) return;
    if (this.playSample(sfx)) return; // real sample present — use it

    switch (sfx) {
      case "ui":
        this.tone(660, 0.05, { type: "triangle", gain: 0.5, cutoff: 3000 });
        this.tone(990, 0.04, { type: "sine", gain: 0.25, delay: 0.02 });
        break;
      case "shoot":
        // Punchy crack: filtered noise transient + a fast down-swept body thump.
        this.noise(0.07, { gain: 0.7, type: "highpass", cutoff: 1400 });
        this.noise(0.14, { gain: 0.5, type: "lowpass", cutoff: 900 });
        this.tone(240, 0.1, { type: "square", slideTo: 55, gain: 0.7, cutoff: 1200 });
        break;
      case "reload":
        // Two mechanical clicks: mag out, mag in.
        this.noise(0.03, { gain: 0.4, type: "highpass", cutoff: 2500 });
        this.tone(320, 0.04, { type: "square", gain: 0.4 });
        this.tone(210, 0.05, { type: "square", gain: 0.5, delay: 0.14 });
        this.noise(0.03, { gain: 0.45, type: "highpass", cutoff: 2200, delay: 0.14 });
        break;
      case "jump":
        this.tone(300, 0.14, { type: "sine", slideTo: 640, gain: 0.55, cutoff: 2600 });
        break;
      case "transform":
        // Shimmery rising sparkle.
        this.tone(420, 0.22, { type: "triangle", slideTo: 960, gain: 0.5, cutoff: 4000 });
        this.tone(630, 0.2, { type: "sine", slideTo: 1280, gain: 0.28, delay: 0.05 });
        break;
      case "hit":
        this.noise(0.06, { gain: 0.5, type: "bandpass", cutoff: 500 });
        this.tone(150, 0.12, { type: "sawtooth", slideTo: 70, gain: 0.6, cutoff: 900 });
        break;
      case "eliminate":
        this.tone(520, 0.28, { type: "sawtooth", slideTo: 120, gain: 0.55, cutoff: 2400 });
        this.tone(260, 0.3, { type: "square", slideTo: 90, gain: 0.35, delay: 0.03, cutoff: 1400 });
        break;
      case "countdown":
        this.tone(760, 0.09, { type: "sine", gain: 0.5, cutoff: 3200 });
        break;
      case "round_start":
        // Rising two-note fanfare.
        this.tone(440, 0.14, { type: "triangle", slideTo: 560, gain: 0.5, cutoff: 3600 });
        this.tone(660, 0.18, { type: "triangle", slideTo: 880, gain: 0.5, delay: 0.14, cutoff: 3600 });
        break;
      case "round_end":
        // Falling two-note resolve.
        this.tone(560, 0.18, { type: "sine", slideTo: 440, gain: 0.5, cutoff: 3000 });
        this.tone(420, 0.26, { type: "sine", slideTo: 300, gain: 0.45, delay: 0.16, cutoff: 2600 });
        break;
      case "taunt":
        this.tone(880, 0.12, { type: "square", slideTo: 520, gain: 0.4, cutoff: 3000 });
        this.tone(660, 0.14, { type: "triangle", slideTo: 990, gain: 0.35, delay: 0.1 });
        break;
    }
  }
}
