/**
 * Placeholder audio: 100% procedural WebAudio tones so the prototype ships with
 * zero copyrighted assets. Every cue is synthesized on the fly. Replace `play()`
 * cases with decoded royalty-free samples later (see docs/ASSETS.md).
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

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  /** Must be called from a user-gesture handler (click/keydown). */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  private blip(freq: number, dur: number, type: OscillatorType = "sine", slideTo?: number) {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain = 0.6) {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t0 = this.ctx.currentTime;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start(t0);
  }

  play(sfx: Sfx) {
    if (!this.ctx || !this.enabled) return;
    switch (sfx) {
      case "ui":
        this.blip(520, 0.06, "triangle");
        break;
      case "shoot":
        this.noise(0.12, 0.5);
        this.blip(180, 0.08, "square", 60);
        break;
      case "reload":
        this.blip(300, 0.05, "square");
        setTimeout(() => this.blip(240, 0.06, "square"), 120);
        break;
      case "jump":
        this.blip(320, 0.12, "sine", 620);
        break;
      case "transform":
        this.blip(420, 0.18, "triangle", 880);
        break;
      case "hit":
        this.blip(140, 0.1, "sawtooth", 80);
        break;
      case "eliminate":
        this.blip(600, 0.25, "sawtooth", 120);
        break;
      case "countdown":
        this.blip(720, 0.08, "sine");
        break;
      case "round_start":
        this.blip(440, 0.12, "triangle", 660);
        setTimeout(() => this.blip(660, 0.16, "triangle", 880), 130);
        break;
      case "round_end":
        this.blip(500, 0.2, "sine", 300);
        break;
      case "taunt":
        this.blip(880, 0.15, "square", 440);
        break;
    }
  }
}
