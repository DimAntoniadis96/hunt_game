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
  | "flash"
  | "whistle"
  | "step"
  | "axe1"
  | "axe2"
  | "axe_miss"
  | "death1"
  | "death2"
  | "damage1"
  | "damage2";

/** Looping music tracks (phase-driven, non-spatial, played via HTMLAudioElement). */
export type Music = "music_lobby" | "music_hide" | "music_hunt";

/**
 * Optional real-sample files. Any subset can be provided; missing ones fall back
 * to synthesis. Base path is served from the client `public/audio/` folder.
 * Multiple candidate extensions are tried so both .mp3 and .ogg/.wav drops work.
 */
const SAMPLE_BASE = "audio/";
const SAMPLE_EXTS = ["ogg", "mp3", "wav"];
/** Target playback volume for looping music (sits well under the SFX bus). */
const MUSIC_VOLUME = 0.28;
/** Crossfade time between music tracks (seconds). */
const MUSIC_FADE = 0.9;
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
  "flash",
  "step",
  "axe1",
  "axe2",
  "axe_miss",
  "death1",
  "death2",
  "damage1",
  "damage2",
  // "whistle" is intentionally omitted here — the 5 per-hider whistle variants
  // (whistle1..whistle5) are loaded separately; the synth is the fallback.
];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null; // pre-master (compressor input)
  private buffers = new Map<Sfx, AudioBuffer>();
  private whistleBuffers: (AudioBuffer | null)[] = [null, null, null, null, null]; // whistle1..5
  private loadTried = false;
  private routeDest: AudioNode | null = null; // where the current cue's synth nodes connect
  enabled = true;

  // ---- looping music (HTMLAudioElement layer) ------------------------------
  // Music is streamed via <audio loop> rather than WebAudio buffers: the tracks
  // are long, we only ever need one playing, and the element gives us free
  // looping + independent volume that never fights the SFX bus/compressor.
  private musicEls = new Map<Music, HTMLAudioElement>();
  private currentMusic: Music | null = null;
  private musicUnlocked = false;
  private musicFadeTimers = new Map<Music, ReturnType<typeof setInterval>>();
  private masterVolume = 0.8;
  private sfxVolume = 0.85;
  private musicVolume = MUSIC_VOLUME;

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
      this.master.gain.value = this.effectiveSfxVolume();

      this.bus.connect(lp).connect(comp).connect(this.master).connect(this.ctx.destination);

      void this.loadSamples();
    }
    this.primeMusic(); // reached from a user gesture, so music can start later
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMasterVolume(v: number) {
    this.masterVolume = clamp01(v);
    this.applyOutputVolumes();
  }

  setSfxVolume(v: number) {
    this.sfxVolume = clamp01(v);
    this.applyOutputVolumes();
  }

  setVolume(v: number) {
    this.setSfxVolume(v);
  }

  // ---- music ---------------------------------------------------------------

  /** Overall music level (0..1). Applies to whatever track is currently playing. */
  setMusicVolume(v: number) {
    this.musicVolume = clamp01(v);
    if (this.currentMusic) {
      const el = this.musicEls.get(this.currentMusic);
      if (el) {
        const existing = this.musicFadeTimers.get(this.currentMusic);
        if (existing) clearInterval(existing);
        this.musicFadeTimers.delete(this.currentMusic);
        el.volume = this.effectiveMusicVolume();
      }
    }
  }

  private effectiveSfxVolume(): number {
    return this.masterVolume * this.sfxVolume;
  }

  private effectiveMusicVolume(): number {
    return this.masterVolume * this.musicVolume;
  }

  private applyOutputVolumes() {
    if (this.master) this.master.gain.value = this.effectiveSfxVolume();
    if (this.currentMusic) {
      const el = this.musicEls.get(this.currentMusic);
      if (el) el.volume = this.effectiveMusicVolume();
    }
  }

  /**
   * Prime the looping music elements. Must be reached from a user gesture (it is
   * called from `unlock()`), so the browser lets us start playback later without
   * a fresh click. Creates one <audio> per track, muted+paused, ready to fade in.
   */
  private primeMusic() {
    if (this.musicUnlocked) return;
    this.musicUnlocked = true;
    const tracks: Music[] = ["music_lobby", "music_hide", "music_hunt"];
    for (const name of tracks) {
      const el = new Audio();
      el.loop = true;
      el.preload = "auto";
      el.volume = 0;
      // Try the same extension order the sample loader uses; the browser picks
      // the first that decodes. If none exist the element simply never plays.
      el.src = `${SAMPLE_BASE}${name}.ogg`;
      this.musicEls.set(name, el);
    }
  }

  /**
   * Switch the looping background track. Pass `null` to fade everything out.
   * Crossfades: the outgoing track fades down while the incoming fades up to
   * the effective master × music level. Calling it with the already-current
   * track is a no-op.
   */
  setMusic(name: Music | null) {
    if (!this.enabled) return;
    if (!this.musicUnlocked) this.primeMusic();
    if (name === this.currentMusic) return;

    // Fade out the previous track (and pause it once silent).
    if (this.currentMusic) {
      const prev = this.musicEls.get(this.currentMusic);
      if (prev) this.fadeTo(this.currentMusic, prev, 0, () => prev.pause());
    }

    this.currentMusic = name;
    if (!name) return;

    const el = this.musicEls.get(name);
    if (!el) return;
    // (Re)start from the top so each phase's music begins at its intro.
    try {
      el.currentTime = 0;
    } catch {
      /* ignore if not seekable yet */
    }
    el.volume = 0;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* autoplay blocked until a gesture */ });
    this.fadeTo(name, el, this.effectiveMusicVolume());
  }

  /** Stop all music immediately-ish (short fade). */
  stopMusic() {
    this.setMusic(null);
  }

  /** Linear volume ramp on an <audio> element via a small interval timer. */
  private fadeTo(key: Music, el: HTMLAudioElement, target: number, onDone?: () => void) {
    const existing = this.musicFadeTimers.get(key);
    if (existing) clearInterval(existing);
    const steps = 24;
    const stepMs = (MUSIC_FADE * 1000) / steps;
    const from = el.volume;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      const t = i / steps;
      el.volume = Math.max(0, Math.min(1, from + (target - from) * t));
      if (i >= steps) {
        clearInterval(timer);
        this.musicFadeTimers.delete(key);
        onDone?.();
      }
    }, stepMs);
    this.musicFadeTimers.set(key, timer);
  }

  /**
   * Play a random cue from a set (e.g. death1/death2, damage1/damage2). Prefers
   * the loaded real samples; if only some are present it picks among those, and
   * if none are it falls back to synthesizing the first name.
   */
  playOneOf(names: Sfx[]) {
    if (!this.ctx || !this.enabled || names.length === 0) return;
    const loaded = names.filter((n) => this.buffers.has(n));
    const pick = loaded.length > 0 ? loaded[Math.floor(Math.random() * loaded.length)] : names[Math.floor(Math.random() * names.length)];
    this.play(pick);
  }

  /** Fetch + decode an audio file by basename, trying each extension. */
  private async loadOne(base: string): Promise<AudioBuffer | null> {
    for (const ext of SAMPLE_EXTS) {
      try {
        const res = await fetch(`${SAMPLE_BASE}${base}.${ext}`);
        if (!res.ok) continue;
        const arr = await res.arrayBuffer();
        return await this.ctx!.decodeAudioData(arr);
      } catch {
        /* not present / not decodable — try the next extension */
      }
    }
    return null;
  }

  /** Try to fetch + decode any provided real samples (best-effort, non-blocking). */
  private async loadSamples() {
    if (this.loadTried || !this.ctx) return;
    this.loadTried = true;
    await Promise.all([
      // Named single cues.
      ...SAMPLE_NAMES.map(async (name) => {
        const buf = await this.loadOne(name);
        if (buf) this.buffers.set(name, buf);
      }),
      // The 5 per-hider whistle variants (whistle1..whistle5).
      ...[1, 2, 3, 4, 5].map(async (n) => {
        this.whistleBuffers[n - 1] = await this.loadOne(`whistle${n}`);
      }),
    ]);
  }

  // ---- synthesis primitives ------------------------------------------------

  /** A shaped oscillator note with attack/decay and optional pitch glide + filter. */
  private tone(
    freq: number,
    dur: number,
    opts: { type?: OscillatorType; slideTo?: number; gain?: number; attack?: number; delay?: number; cutoff?: number } = {},
    dest?: AudioNode,
  ) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    const out = dest ?? this.routeDest ?? this.bus;
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
    tail.connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** Filtered noise burst — the body of impacts, gunshots and footsteps. */
  private noise(dur: number, opts: { gain?: number; type?: BiquadFilterType; cutoff?: number; delay?: number } = {}, dest?: AudioNode) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    const out = dest ?? this.routeDest ?? this.bus;
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
    src.connect(f).connect(g).connect(out);
    src.start(t0);
  }

  private playSample(sfx: Sfx, dest?: AudioNode): boolean {
    if (!this.ctx || !this.bus) return false;
    const buf = this.buffers.get(sfx);
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dest ?? this.bus);
    src.start(this.ctx.currentTime);
    return true;
  }

  // ---- cue dispatch --------------------------------------------------------

  play(sfx: Sfx) {
    if (!this.ctx || !this.enabled) return;
    this.render(sfx, this.bus!);
  }

  /**
   * Positional playback: volume 0..1 (distance attenuation) and pan -1..1
   * (left/right). Used for prop whistles and hunter footsteps so you can tell
   * roughly where they're coming from.
   */
  playSpatial(sfx: Sfx, volume: number, pan: number) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    const vol = Math.max(0, Math.min(1, volume));
    if (vol < 0.02) return;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(panner).connect(this.bus);
    this.render(sfx, g);
  }

  /**
   * Play a specific hider's whistle (1-5) positionally. Uses the real sample if
   * present, otherwise the synthesized whistle.
   */
  playWhistle(variant: number, volume: number, pan: number) {
    if (!this.ctx || !this.bus || !this.enabled) return;
    const vol = Math.max(0, Math.min(1, volume));
    if (vol < 0.02) return;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(panner).connect(this.bus);
    const buf = this.whistleBuffers[(((variant - 1) % 5) + 5) % 5];
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start(this.ctx.currentTime);
      return;
    }
    this.render("whistle", g); // fallback: synthesized whistle
  }

  private render(sfx: Sfx, dest: AudioNode) {
    if (!this.ctx || !this.enabled) return;
    if (this.playSample(sfx, dest)) return; // real sample present — use it

    this.routeDest = dest; // synth nodes below connect here (spatial or the bus)
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
      case "flash":
        this.noise(0.11, { gain: 0.62, type: "highpass", cutoff: 2600 });
        this.tone(1800, 0.16, { type: "sine", slideTo: 4200, gain: 0.34, attack: 0.002, cutoff: 5200 });
        this.tone(420, 0.2, { type: "triangle", slideTo: 120, gain: 0.22, delay: 0.04, cutoff: 1800 });
        break;
      case "whistle": {
        // A cheeky "wheet-woo" locator whistle (up then a longer down note).
        this.tone(1500, 0.16, { type: "sine", slideTo: 2250, gain: 0.5, attack: 0.02 });
        this.tone(2200, 0.24, { type: "sine", slideTo: 1350, gain: 0.5, attack: 0.02, delay: 0.16 });
        break;
      }
      case "step": {
        // A soft footfall: a low thud + a short filtered scuff, pitch varied a
        // touch so repeated steps don't sound machine-gun identical.
        const p = 1 + (Math.random() * 0.18 - 0.09);
        this.tone(95 * p, 0.07, { type: "sine", slideTo: 55 * p, gain: 0.5, cutoff: 500, attack: 0.004 });
        this.noise(0.045, { gain: 0.22, type: "lowpass", cutoff: 700 });
        break;
      }
      case "axe1":
      case "axe2":
        // Fallback if the real axe hit samples aren't present: a chunky thunk.
        this.noise(0.08, { gain: 0.6, type: "lowpass", cutoff: 900 });
        this.tone(190, 0.12, { type: "sawtooth", slideTo: 70, gain: 0.6, cutoff: 800 });
        break;
      case "axe_miss":
        // Fallback whiff: a short airy noise swoosh, no low-end impact.
        this.noise(0.13, { gain: 0.32, type: "bandpass", cutoff: 1600 });
        this.tone(900, 0.1, { type: "sine", slideTo: 400, gain: 0.14, cutoff: 2600 });
        break;
      case "damage1":
      case "damage2":
        // Fallback pain/impact sting: a short mid thud with a bright transient.
        this.noise(0.05, { gain: 0.45, type: "bandpass", cutoff: 800 });
        this.tone(220, 0.14, { type: "sawtooth", slideTo: 90, gain: 0.5, cutoff: 1100 });
        break;
      case "death1":
      case "death2":
        // Fallback death sting: a descending two-layer tone with a noise body.
        this.noise(0.09, { gain: 0.4, type: "lowpass", cutoff: 1200 });
        this.tone(440, 0.34, { type: "sawtooth", slideTo: 110, gain: 0.5, cutoff: 2200 });
        this.tone(220, 0.4, { type: "square", slideTo: 70, gain: 0.32, delay: 0.05, cutoff: 1200 });
        break;
    }
    this.routeDest = null;
  }
}
