import { Phase, PREP_SECONDS, Team, WEAPON_MAG_SIZE, type PlayerView } from "@mimic/shared";

/**
 * Community links shown on the seeker-hold screen while hunters wait out Prep.
 * It's the one moment every hunter is guaranteed to be staring at a full-screen
 * panel with nothing to do, so it's the right place to ask them to join.
 */
const COMMUNITY_SITE = "www.study-saga.com";
const COMMUNITY_SITE_URL = "https://www.study-saga.com";
/** Invite code is case-sensitive — keep it exactly as issued by Discord. */
const COMMUNITY_DISCORD = "discord.gg/2EqQJSc6TY";
const COMMUNITY_DISCORD_URL = "https://discord.gg/2EqQJSc6TY";

interface StateLike {
  phase: Phase;
  round: number;
  roundsPerMatch: number;
  phaseEndsAt: number;
  rebuilding?: boolean;
  propsScore: number;
  huntersScore: number;
  players: { forEach: (cb: (p: PlayerView, key: string) => void) => void; size: number };
}

const PHASE_LABEL: Record<string, string> = {
  [Phase.Lobby]: "LOBBY",
  [Phase.Countdown]: "STARTING",
  [Phase.Prep]: "HIDE",
  [Phase.Hunt]: "HUNT",
  [Phase.RoundEnd]: "ROUND OVER",
  [Phase.MatchEnd]: "MATCH OVER",
};

export type BannerTone = "info" | "warn" | "good" | "alert";

export class HUD {
  private el: HTMLElement;
  private refs: Record<string, HTMLElement> = {};
  private bannerTimer = 0;
  private lastFinaleNum: number | null = null;
  private lastPromptHtml: string | null = null;
  private lastHoldSeconds = -1;
  private lastHoldProgress = -1;

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "hud hidden";
    this.el.innerHTML = `
      <div class="hud-top">
        <span class="phase" data-r="phase">LOBBY</span>
        <span class="timer" data-r="timer">--</span>
        <span class="sub" data-r="sub"></span>
      </div>
      <div class="ping" data-r="ping">ping -- ms</div>
      <div class="fps hidden" data-r="fps">fps --</div>
      <div class="crosshair hidden" data-r="crosshair"><i class="dot"></i></div>
      <div class="hud-bottom-left">
        <div data-r="teamlabel" style="font-weight:700">—</div>
        <div class="sub" data-r="lifelabel">Health</div>
        <div class="health-bar"><div class="health-fill" data-r="health" style="width:100%"></div></div>
      </div>
      <div class="hud-bottom-right hidden" data-r="weapon">
        <div class="reload-cue" data-r="reloadcue" role="status" aria-live="polite" aria-hidden="true">
          <span class="rc-key">R</span><span class="rc-label" data-r="reloadcuetext">Reload</span>
        </div>
        <div class="ammo"><span data-r="ammo">8</span><span class="mag">/${WEAPON_MAG_SIZE}</span><span class="reserve" data-r="reserve">120</span></div>
        <div class="sub" data-r="wstate">R to reload</div>
      </div>
      <div class="killfeed" data-r="killfeed"></div>
      <div class="rebuild-screen" data-r="rebuild" aria-hidden="true">
        <div class="rebuild-panel">
          <div class="rebuild-eyebrow">Teams rebuilding</div>
          <div class="rebuild-num" data-r="rebuildnum">8</div>
          <div class="rebuild-sub">A team left — assigning new roles…</div>
        </div>
      </div>
      <div class="banner" data-r="banner" role="status" aria-live="polite">
        <span class="bn-icon" data-r="bannericon" aria-hidden="true"></span>
        <span class="bn-text" data-r="bannertext"></span>
      </div>
      <div class="hunter-wait-screen" data-r="hunterwait" aria-hidden="true">
        <div class="hunter-wait-map" aria-hidden="true">
          <span class="map-house"></span>
          <span class="map-roof"></span>
          <span class="map-patio"></span>
          <span class="map-hedge map-hedge-a"></span>
          <span class="map-hedge map-hedge-b"></span>
          <span class="map-hedge map-hedge-c"></span>
          <span class="map-path map-path-a"></span>
          <span class="map-path map-path-b"></span>
          <span class="map-pool"></span>
          <span class="map-tree map-tree-a"></span>
          <span class="map-tree map-tree-b"></span>
          <span class="map-tree map-tree-c"></span>
        </div>
        <div class="hunter-wait-panel">
          <div class="hw-head">
            <div class="hunter-wait-title">SAGA HUNTING</div>
            <div class="hunter-wait-byline">A prop-hunt game by <b>D_anto</b></div>
          </div>

          <div class="hw-hold">
            <div class="hunter-wait-eyebrow"><i class="hw-pip" aria-hidden="true"></i>Seeker hold</div>
            <div class="hw-ring" data-r="hunterwaitring">
              <svg class="hw-ring-svg" viewBox="0 0 120 120" aria-hidden="true">
                <circle class="hw-ring-track" cx="60" cy="60" r="53" />
                <circle class="hw-ring-bar" cx="60" cy="60" r="53" pathLength="100" />
              </svg>
              <div class="hw-ring-inner" aria-label="Hunt begins in">
                <span class="hw-count" data-r="hunterwaittimer">--</span>
                <small class="hw-unit" data-r="hunterwaitunit">seconds</small>
              </div>
            </div>
            <div class="hunter-wait-sub">until the hunt begins</div>
          </div>

          <div class="hunter-wait-divider" aria-hidden="true"></div>

          <div class="hw-cta">
            <div class="hw-cta-title">Join our community</div>
            <div class="hw-cta-copy">Studying is better when we do it together — come play, revise and hang out with us.</div>
            <div class="hw-links">
              <a class="hw-link hw-link-site" href="${COMMUNITY_SITE_URL}" target="_blank" rel="noopener noreferrer">
                <span class="hw-link-label">Website</span>
                <span class="hw-link-value">${COMMUNITY_SITE}</span>
              </a>
              <a class="hw-link hw-link-discord" href="${COMMUNITY_DISCORD_URL}" target="_blank" rel="noopener noreferrer">
                <span class="hw-link-label">Discord</span>
                <span class="hw-link-value">${COMMUNITY_DISCORD}</span>
              </a>
            </div>
          </div>

          <div class="hunter-wait-credit">by <b>Zed Organization</b></div>
        </div>
      </div>
      <div class="finale" data-r="finale">
        <div class="fn-num" data-r="finalenum">5</div>
        <div class="fn-label" data-r="finalelabel"></div>
      </div>
      <div class="prompt" data-r="prompt"></div>
      <div class="scoreboard" data-r="scoreboard">
        <div class="sb-card">
          <div class="sb-teams">
            <div><span class="team-props">PROPS</span> <b data-r="sbprops">0</b></div>
            <div><span class="team-hunters">HUNTERS</span> <b data-r="sbhunters">0</b></div>
          </div>
          <table>
            <thead><tr><th>Player</th><th>Team</th><th>Score</th><th>Ping</th></tr></thead>
            <tbody data-r="sbrows"></tbody>
          </table>
          <p class="hint">Hold <kbd>Tab</kbd> to view scores.</p>
        </div>
      </div>
    `;
    root.appendChild(this.el);
    this.el.querySelectorAll<HTMLElement>("[data-r]").forEach((n) => {
      this.refs[n.dataset.r as string] = n;
    });
  }

  show() {
    this.el.classList.remove("hidden");
  }
  hide() {
    this.el.classList.add("hidden");
  }

  private secondsLeft(endsAt: number): number {
    return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  }

  update(state: StateLike, me: PlayerView | undefined, ping: number) {
    const phase = state.phase;
    const rebuilding = phase === Phase.Countdown && !!state.rebuilding;
    this.refs.phase.textContent = rebuilding ? "REBUILDING" : PHASE_LABEL[phase] ?? phase;

    // Full-screen "teams rebuilding" countdown after a side emptied out.
    this.refs.rebuild.classList.toggle("show", rebuilding);
    this.refs.rebuild.setAttribute("aria-hidden", rebuilding ? "false" : "true");
    if (rebuilding) this.refs.rebuildnum.textContent = String(this.secondsLeft(state.phaseEndsAt));
    this.refs.phase.className = `phase ${me?.team === Team.Props ? "team-props" : me?.team === Team.Hunters ? "team-hunters" : ""}`;

    const showTimer = phase === Phase.Prep || phase === Phase.Hunt || phase === Phase.Countdown || phase === Phase.RoundEnd;
    this.refs.timer.textContent = showTimer ? String(this.secondsLeft(state.phaseEndsAt)) : "--";

    let propsAlive = 0;
    let propsTotal = 0;
    state.players.forEach((p) => {
      if (p.team === Team.Props) {
        propsTotal++;
        if (p.alive) propsAlive++;
      }
    });
    const roundInfo = phase === Phase.Lobby ? "" : `Round ${state.round}/${state.roundsPerMatch} · `;
    this.refs.sub.textContent = `${roundInfo}Props ${propsAlive}/${propsTotal}`;

    this.refs.ping.textContent = `ping ${ping} ms`;

    this.refs.teamlabel.textContent = me ? (me.team === Team.Props ? "PROP" : me.team === Team.Hunters ? "HUNTER" : "SPECTATOR") : "—";
    this.refs.teamlabel.className = me?.team === Team.Props ? "team-props" : me?.team === Team.Hunters ? "team-hunters" : "";

    const health = me?.health ?? 0;
    this.refs.health.style.width = `${Math.max(0, Math.min(100, health))}%`;
    this.refs.lifelabel.textContent = me?.alive === false ? "Eliminated — spectating" : "Health";

    const isHunter = me?.team === Team.Hunters;
    const hunterWaiting = phase === Phase.Prep && isHunter && me?.alive !== false;
    this.refs.hunterwait.classList.toggle("show", hunterWaiting);
    this.refs.hunterwait.setAttribute("aria-hidden", hunterWaiting ? "false" : "true");
    // Only touch this screen while it is actually on: props never see it, and
    // this runs every frame.
    if (hunterWaiting) this.updateHunterHold(state.phaseEndsAt);
    this.refs.weapon.classList.toggle("hidden", !isHunter);
    this.refs.crosshair.classList.toggle("hidden", !isHunter || !me?.alive);
    if (isHunter && me) {
      this.refs.ammo.textContent = String(me.ammo);
      this.refs.reserve.textContent = String(me.reserve);
      const empty = me.ammo === 0 && me.reserve === 0;
      this.refs.weapon.classList.toggle("melee", empty);
      this.refs.wstate.textContent = me.reloading
        ? "Reloading…"
        : empty
          ? "Out of ammo · F: axe"
          : me.ammo === 0
            ? "Reload (R) · F axe"
            : "R reload · F axe";
      this.reloadCue(me);
    } else {
      this.setReloadCue(false, false);
    }
  }

  /**
   * The blinking "press R" callout floating above the ammo panel. It only earns
   * screen space when reloading is both possible and worth doing: alive, not
   * already reloading, rounds left in reserve, and the mag at or under a
   * quarter. At zero rounds chambered it escalates to the danger colour and
   * blinks faster, so "low" and "dry" feel different at a glance.
   */
  private reloadCue(me: PlayerView) {
    const dry = me.ammo === 0;
    const low = me.ammo <= Math.max(1, Math.ceil(WEAPON_MAG_SIZE * 0.25));
    const canReload = me.reserve > 0 && me.ammo < WEAPON_MAG_SIZE;
    const show = me.alive !== false && !me.reloading && canReload && low;
    this.setReloadCue(show, dry);
  }

  private setReloadCue(show: boolean, urgent: boolean) {
    const cue = this.refs.reloadcue;
    if (!cue) return;
    cue.classList.toggle("show", show);
    cue.classList.toggle("urgent", show && urgent);
    cue.setAttribute("aria-hidden", show ? "false" : "true");
    const text = urgent ? "Reload!" : "Reload";
    if (this.refs.reloadcuetext.textContent !== text) this.refs.reloadcuetext.textContent = text;
  }

  /**
   * Drive the seeker-hold countdown: the number, and the ring that drains as
   * Prep runs out. Both writes are memoised — this is called every frame but
   * the number changes once a second and the ring is quantised to 0.5% steps,
   * so we are not forcing a style recalc 60 times a second for nothing.
   */
  private updateHunterHold(phaseEndsAt: number) {
    const remainingMs = Math.max(0, phaseEndsAt - Date.now());
    const seconds = Math.ceil(remainingMs / 1000);
    if (seconds !== this.lastHoldSeconds) {
      this.lastHoldSeconds = seconds;
      this.refs.hunterwaittimer.textContent = String(seconds);
      this.refs.hunterwaitunit.textContent = seconds === 1 ? "second" : "seconds";
      // Last five seconds go amber — same language as the in-world finale.
      this.refs.hunterwaitring?.classList.toggle("urgent", seconds <= 5);
    }
    // pathLength="100" on the circle means the dash maths is just a percentage,
    // whatever radius the CSS ends up using.
    const progress = Math.round(Math.max(0, Math.min(1, remainingMs / (PREP_SECONDS * 1000))) * 200) / 200;
    if (progress !== this.lastHoldProgress) {
      this.lastHoldProgress = progress;
      this.refs.hunterwaitring?.style.setProperty("--hw-progress", String(progress));
    }
  }

  setCrosshairHit(hit: boolean, wrong = false) {
    const c = this.refs.crosshair;
    c.classList.toggle("hit", hit || wrong);
    if (hit || wrong) window.setTimeout(() => c.classList.remove("hit"), 120);
  }

  killfeed(text: string, highlight = false) {
    if (!text) return;
    const entry = document.createElement("div");
    entry.className = highlight ? "entry you" : "entry";
    entry.textContent = text;
    this.refs.killfeed.appendChild(entry);
    window.setTimeout(() => entry.remove(), 6000);
  }

  /**
   * A prominent CS-style kill banner: KILLER → [weapon] → VICTIM, role-coloured
   * (hunter orange, prop teal). Names go in via textContent (never innerHTML),
   * the weapon glyph is a fixed inline SVG. `mine` highlights the kills I made.
   * Every kill in prop-hunt is hunter → prop, so the killer is always the
   * hunter side and the victim always the prop side.
   */
  killEntry(killerName: string, victimName: string, method: "gun" | "axe" = "gun", mine = false) {
    if (!killerName || !victimName) return;
    const row = document.createElement("div");
    row.className = mine ? "kill mine" : "kill";

    const killer = document.createElement("span");
    killer.className = "k-name k-hunter";
    killer.textContent = killerName;

    const weapon = document.createElement("span");
    weapon.className = "k-weapon";
    weapon.innerHTML = method === "axe" ? AXE_SVG : GUN_SVG;

    const victim = document.createElement("span");
    victim.className = "k-name k-prop";
    victim.textContent = victimName;

    row.append(killer, weapon, victim);
    this.refs.killfeed.appendChild(row);
    // Pop-in, then a short life so it reads like a CS kill feed.
    void row.offsetWidth;
    row.classList.add("in");
    window.setTimeout(() => row.classList.add("out"), 5200);
    window.setTimeout(() => row.remove(), 5600);
  }

  /**
   * A player left mid-round → the same prominent banner, framed as a self-out:
   * NAME 💀 SUICIDE. Muted grey so it reads differently from a real kill, but
   * uses the identical layout/animation so it's just as visible.
   */
  leaveEntry(name: string) {
    if (!name) return;
    const row = document.createElement("div");
    row.className = "kill left";

    const who = document.createElement("span");
    who.className = "k-name";
    who.textContent = name;

    const skull = document.createElement("span");
    skull.className = "k-weapon";
    skull.innerHTML = SKULL_SVG;

    const tag = document.createElement("span");
    tag.className = "k-tag";
    tag.textContent = "suicide";

    row.append(who, skull, tag);
    this.refs.killfeed.appendChild(row);
    void row.offsetWidth;
    row.classList.add("in");
    window.setTimeout(() => row.classList.add("out"), 5200);
    window.setTimeout(() => row.remove(), 5600);
  }

  fps(show: boolean, value: number) {
    this.refs.fps.classList.toggle("hidden", !show);
    if (show) this.refs.fps.textContent = `fps ${Math.round(value)}`;
  }

  /**
   * A simple, centred final-seconds countdown number (used for both the last
   * seconds of hiding and of the hunt). Pass the number + an optional short
   * label, or null to clear. Idempotent per-second so calling it every frame
   * only re-triggers the pop when the number actually changes.
   */
  finale(n: number | null, label = "", tone: "hide" | "hunt" = "hunt") {
    const el = this.refs.finale;
    if (n == null) {
      if (this.lastFinaleNum !== null) {
        el.classList.remove("show");
        this.lastFinaleNum = null;
      }
      return;
    }
    if (n === this.lastFinaleNum) return;
    this.lastFinaleNum = n;
    el.classList.remove("tone-hide", "tone-hunt");
    el.classList.add(`tone-${tone}`); // colour accent for this moment
    this.refs.finalenum.textContent = String(n);
    this.refs.finalelabel.textContent = label;
    el.classList.add("show");
    const num = this.refs.finalenum;
    num.classList.remove("pop");
    void num.offsetWidth; // reflow so the CSS animation restarts each second
    num.classList.add("pop");
  }

  /**
   * A short transient message, docked just above the key-hint bar at the bottom.
   *
   * `tone` only drives the colour of the leading dot and the border accent:
   *   info  — neutral status (default)
   *   warn  — "not yet" / cooldown / unavailable
   *   good  — a successful action
   *   alert — something significant happened to you
   */
  banner(text: string, ms = 2500, tone: BannerTone = "info") {
    const b = this.refs.banner;
    this.refs.bannertext.textContent = text;
    b.classList.remove("tone-info", "tone-warn", "tone-good", "tone-alert");
    b.classList.add(`tone-${tone}`);
    // Replay the slide-in even when one message replaces another mid-flight,
    // so a second denial doesn't look like the first one simply never cleared.
    b.classList.remove("show");
    void b.offsetWidth;
    b.classList.add("show");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove("show"), ms);
  }


  prompt(html: string | null, locked = false) {
    const p = this.refs.prompt;
    if (!html) {
      p.classList.remove("show");
      p.classList.remove("locked");
      this.lastPromptHtml = null;
      return;
    }
    // This runs every frame from GameScene.updatePrompts, but the content only
    // changes about once a second (the cooldown counters). Assigning innerHTML
    // always tears down and re-parses the subtree, so an unguarded write was
    // destroying and rebuilding ~20 nodes 60x/second. Compare first.
    if (html !== this.lastPromptHtml) {
      p.innerHTML = html;
      this.lastPromptHtml = html;
    }
    p.classList.add("show");
    // Red, pulsing treatment while the player is frozen-in-place (R lock).
    p.classList.toggle("locked", locked);
  }

  scoreboard(show: boolean, state?: StateLike) {
    this.refs.scoreboard.classList.toggle("show", show);
    if (!show || !state) return;
    this.refs.sbprops.textContent = String(state.propsScore);
    this.refs.sbhunters.textContent = String(state.huntersScore);
    const rows: PlayerView[] = [];
    state.players.forEach((p) => rows.push(p));
    rows.sort((a, b) => b.score - a.score);
    this.refs.sbrows.innerHTML = rows
      .map(
        (p) =>
          `<tr><td>${escapeHtml(p.name)}${p.alive ? "" : " ☠"}</td><td class="${p.team === Team.Props ? "team-props" : "team-hunters"}">${p.team}</td><td>${p.score}</td><td>${p.ping}</td></tr>`,
      )
      .join("");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// Fixed, self-contained weapon glyphs for the kill feed (no external assets).
const GUN_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M2 9h13.5l1.2-2h4.1c.7 0 1.2.5 1.2 1.2V11c0 .6-.5 1-1 1h-2.3l-2 3.4a2 2 0 0 1-1.7 1H10a2 2 0 0 1-1.9-1.4L7.3 12H4a2 2 0 0 1-2-2V9Zm2.2 4h2l.5 1.6H6a1 1 0 0 1-1-.8L4.2 13Z"/></svg>`;
const AXE_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M14.8 2.2c2.9.2 5.6 2 6.7 4.6.3.7-.5 1.3-1.1 1-1.6-.8-3.3-.6-4.5.5l-1.9-1.9c1-1.2 1.3-2.9.5-4.5-.3-.6.2-1.3.9-1.2ZM12.4 8.2l2 2-8.6 8.6a1.4 1.4 0 0 1-2-2L12.4 8.2Z"/></svg>`;
const SKULL_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2c4.4 0 8 3.3 8 7.5 0 2.4-1.2 4.5-3 5.9V18a1.5 1.5 0 0 1-1.5 1.5H15V18a1 1 0 0 0-2 0v1.5h-2V18a1 1 0 0 0-2 0v1.5H8.5A1.5 1.5 0 0 1 7 18v-2.6c-1.8-1.4-3-3.5-3-5.9C4 5.3 7.6 2 12 2ZM8.8 9a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm6.4 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z"/></svg>`;
