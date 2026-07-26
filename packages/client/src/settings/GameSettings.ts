export type RenderQuality = "low" | "medium" | "high";

export interface GameSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  mouseSensitivity: number;
  invertMouseY: boolean;
  fov: number;
  cameraDistance: number;
  renderQuality: RenderQuality;
  showFps: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  sfxVolume: 0.85,
  musicVolume: 0.32,
  mouseSensitivity: 0.0022,
  invertMouseY: false,
  fov: 66,
  cameraDistance: 5.0,
  renderQuality: "high",
  showFps: false,
  reduceMotion: false,
};

const STORAGE_KEY = "mimic:settings";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const number = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, min, max) : fallback);

function quality(v: unknown): RenderQuality {
  return v === "low" || v === "medium" || v === "high" ? v : DEFAULT_SETTINGS.renderQuality;
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      masterVolume: number(parsed.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 1),
      sfxVolume: number(parsed.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 0, 1),
      musicVolume: number(parsed.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1),
      mouseSensitivity: number(parsed.mouseSensitivity, DEFAULT_SETTINGS.mouseSensitivity, 0.0008, 0.0045),
      invertMouseY: bool(parsed.invertMouseY, DEFAULT_SETTINGS.invertMouseY),
      fov: number(parsed.fov, DEFAULT_SETTINGS.fov, 55, 90),
      cameraDistance: number(parsed.cameraDistance, DEFAULT_SETTINGS.cameraDistance, 3.2, 7),
      renderQuality: quality(parsed.renderQuality),
      showFps: bool(parsed.showFps, DEFAULT_SETTINGS.showFps),
      reduceMotion: bool(parsed.reduceMotion, DEFAULT_SETTINGS.reduceMotion),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function resetSettings(): GameSettings {
  const settings = { ...DEFAULT_SETTINGS };
  saveSettings(settings);
  return settings;
}

export function renderScaleForQuality(q: RenderQuality): number {
  switch (q) {
    case "low":
      return 1.65;
    case "medium":
      return 1.25;
    case "high":
    default:
      return 1;
  }
}
