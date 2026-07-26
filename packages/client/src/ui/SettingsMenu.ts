import {
  DEFAULT_SETTINGS,
  type GameSettings,
  type RenderQuality,
  resetSettings,
  saveSettings,
} from "../settings/GameSettings";

type SettingsContext = "menu" | "lobby" | "game";
type Tab = "audio" | "controls" | "video";

const sensitivityToSlider = (v: number) => Math.round(v * 10000);
const sliderToSensitivity = (v: number) => v / 10000;

export class SettingsMenu {
  private el: HTMLElement;
  private settings: GameSettings;
  private context: SettingsContext = "menu";
  private activeTab: Tab = "audio";

  onChange?: (settings: GameSettings) => void;
  onClose?: (context: SettingsContext) => void;
  onPreviewSfx?: () => void;
  onFullscreen?: () => void;

  constructor(root: HTMLElement, settings: GameSettings) {
    this.settings = { ...settings };
    this.el = document.createElement("div");
    this.el.className = "settings-screen hidden";
    this.el.innerHTML = `
      <div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="settings-head">
          <div>
            <h2 id="settings-title">Settings</h2>
            <p data-r="settings-context">Game preferences</p>
          </div>
          <button class="icon-btn" type="button" data-a="settings-close" aria-label="Close settings">×</button>
        </div>

        <div class="settings-tabs" role="tablist" aria-label="Settings sections">
          <button type="button" role="tab" data-tab="audio" class="active">Audio</button>
          <button type="button" role="tab" data-tab="controls">Controls</button>
          <button type="button" role="tab" data-tab="video">Video</button>
        </div>

        <div class="settings-body">
          <section class="settings-section active" data-section="audio">
            ${rangeRow("masterVolume", "Master volume", 0, 100, 1)}
            ${rangeRow("sfxVolume", "Sound effects", 0, 100, 1)}
            ${rangeRow("musicVolume", "Background music", 0, 100, 1)}
            <button class="secondary wide" type="button" data-a="preview-sfx">Test sound</button>
          </section>

          <section class="settings-section" data-section="controls">
            ${rangeRow("mouseSensitivity", "Mouse sensitivity", 8, 45, 1)}
            ${rangeRow("cameraDistance", "Prop camera distance", 32, 70, 1)}
            ${toggleRow("invertMouseY", "Invert mouse Y")}
          </section>

          <section class="settings-section" data-section="video">
            ${rangeRow("fov", "Field of view", 55, 90, 1)}
            <label class="setting-row">
              <span>
                <b>Render quality</b>
                <small>Internal 3D resolution</small>
              </span>
              <select data-s="renderQuality">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            ${toggleRow("showFps", "Show FPS")}
            ${toggleRow("reduceMotion", "Reduce motion")}
            <button class="secondary wide" type="button" data-a="fullscreen">Fullscreen</button>
          </section>
        </div>

        <div class="settings-foot">
          <button class="ghost" type="button" data-a="settings-reset">Reset defaults</button>
          <button type="button" data-a="settings-done">Done</button>
        </div>
      </div>
    `;
    root.appendChild(this.el);
    this.bind();
    this.render();
  }

  get value(): GameSettings {
    return { ...this.settings };
  }

  get open(): boolean {
    return !this.el.classList.contains("hidden");
  }

  show(context: SettingsContext) {
    this.context = context;
    this.el.classList.remove("hidden");
    this.el.querySelector<HTMLElement>('[data-r="settings-context"]')!.textContent =
      context === "game" ? "Game menu" : context === "lobby" ? "Lobby preferences" : "Game preferences";
    this.render();
    window.setTimeout(() => this.el.querySelector<HTMLButtonElement>('[data-a="settings-done"]')?.focus(), 0);
  }

  hide() {
    if (!this.open) return;
    this.el.classList.add("hidden");
    this.onClose?.(this.context);
  }

  private bind() {
    this.el.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => this.showTab(button.dataset.tab as Tab));
    });
    this.el.querySelectorAll<HTMLInputElement>('input[type="range"][data-s]').forEach((input) => {
      input.addEventListener("input", () => this.onRange(input));
    });
    this.el.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-s]').forEach((input) => {
      input.addEventListener("change", () => this.update({ [input.dataset.s!]: input.checked } as Partial<GameSettings>));
    });
    this.el.querySelector<HTMLSelectElement>('select[data-s="renderQuality"]')!.addEventListener("change", (e) => {
      this.update({ renderQuality: (e.currentTarget as HTMLSelectElement).value as RenderQuality });
    });
    this.el.querySelector('[data-a="preview-sfx"]')!.addEventListener("click", () => this.onPreviewSfx?.());
    this.el.querySelector('[data-a="fullscreen"]')!.addEventListener("click", () => this.onFullscreen?.());
    this.el.querySelector('[data-a="settings-close"]')!.addEventListener("click", () => this.hide());
    this.el.querySelector('[data-a="settings-done"]')!.addEventListener("click", () => this.hide());
    this.el.querySelector('[data-a="settings-reset"]')!.addEventListener("click", () => {
      this.settings = resetSettings();
      this.render();
      this.onChange?.(this.value);
    });
    this.el.addEventListener("keydown", (e) => {
      if (e.code === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });
  }

  private showTab(tab: Tab) {
    this.activeTab = tab;
    this.el.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    this.el.querySelectorAll<HTMLElement>("[data-section]").forEach((section) => {
      section.classList.toggle("active", section.dataset.section === tab);
    });
  }

  private onRange(input: HTMLInputElement) {
    const key = input.dataset.s as keyof GameSettings;
    const raw = Number(input.value);
    let value: number;
    if (key === "mouseSensitivity") value = sliderToSensitivity(raw);
    else if (key === "cameraDistance") value = raw / 10;
    else if (key === "fov") value = raw;
    else value = raw / 100;
    this.update({ [key]: value } as Partial<GameSettings>);
  }

  private update(patch: Partial<GameSettings>) {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.render();
    this.onChange?.(this.value);
  }

  private render() {
    this.setRange("masterVolume", Math.round(this.settings.masterVolume * 100), `${Math.round(this.settings.masterVolume * 100)}%`);
    this.setRange("sfxVolume", Math.round(this.settings.sfxVolume * 100), `${Math.round(this.settings.sfxVolume * 100)}%`);
    this.setRange("musicVolume", Math.round(this.settings.musicVolume * 100), `${Math.round(this.settings.musicVolume * 100)}%`);
    this.setRange("mouseSensitivity", sensitivityToSlider(this.settings.mouseSensitivity), `${Math.round((this.settings.mouseSensitivity / DEFAULT_SETTINGS.mouseSensitivity) * 100)}%`);
    this.setRange("cameraDistance", Math.round(this.settings.cameraDistance * 10), `${this.settings.cameraDistance.toFixed(1)}m`);
    this.setRange("fov", Math.round(this.settings.fov), `${Math.round(this.settings.fov)}°`);

    this.setChecked("invertMouseY", this.settings.invertMouseY);
    this.setChecked("showFps", this.settings.showFps);
    this.setChecked("reduceMotion", this.settings.reduceMotion);
    this.el.querySelector<HTMLSelectElement>('select[data-s="renderQuality"]')!.value = this.settings.renderQuality;
    this.showTab(this.activeTab);
  }

  private setRange(key: string, value: number, label: string) {
    const input = this.el.querySelector<HTMLInputElement>(`input[data-s="${key}"]`)!;
    const out = this.el.querySelector<HTMLElement>(`[data-v="${key}"]`)!;
    input.value = String(value);
    out.textContent = label;
  }

  private setChecked(key: string, value: boolean) {
    this.el.querySelector<HTMLInputElement>(`input[data-s="${key}"]`)!.checked = value;
  }
}

function rangeRow(key: keyof GameSettings, label: string, min: number, max: number, step: number): string {
  return `
    <label class="setting-row range-row">
      <span>
        <b>${label}</b>
        <small data-v="${key}">0</small>
      </span>
      <input type="range" data-s="${key}" min="${min}" max="${max}" step="${step}" />
    </label>`;
}

function toggleRow(key: keyof GameSettings, label: string): string {
  return `
    <label class="setting-row toggle-row">
      <span>
        <b>${label}</b>
      </span>
      <input type="checkbox" data-s="${key}" />
    </label>`;
}
