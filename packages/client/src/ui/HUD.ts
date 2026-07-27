import { Phase, Team, WEAPON_MAG_SIZE, type PlayerView } from "@mimic/shared";

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

export class HUD {
  private el: HTMLElement;
  private refs: Record<string, HTMLElement> = {};
  private bannerTimer = 0;
  private lastFinaleNum: number | null = null;

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
      <div class="banner" data-r="banner"></div>
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
          <div class="hunter-wait-title">SAGA HUNTING</div>
          <div class="hunter-wait-byline">A prop-hunt game by <b>D_anto</b></div>

          <div class="hunter-wait-eyebrow">SEEKER HOLD</div>
          <div class="hunter-wait-countdown" aria-label="Hunt begins in">
            <span data-r="hunterwaittimer">--</span>
            <small data-r="hunterwaitunit">seconds</small>
          </div>
          <div class="hunter-wait-sub">until the hunt begins</div>

          <div class="hunter-wait-divider" aria-hidden="true"></div>

          <div class="hunter-wait-copy">Studying, gamified — turn your revision into a game worth finishing.</div>
          <div class="hunter-wait-url">www.study-saga.com</div>
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
    const waitSeconds = this.secondsLeft(state.phaseEndsAt);
    this.refs.hunterwaittimer.textContent = String(waitSeconds);
    this.refs.hunterwaitunit.textContent = waitSeconds === 1 ? "second" : "seconds";
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
    }
  }

  setCrosshairHit(hit: boolean, wrong = false) {
    const c = this.refs.crosshair;
    c.classList.toggle("hit", hit || wrong);
    if (hit || wrong) window.setTimeout(() => c.classList.remove("hit"), 120);
  }

  killfeed(text: string) {
    const entry = document.createElement("div");
    entry.className = "entry";
    entry.textContent = text;
    this.refs.killfeed.appendChild(entry);
    window.setTimeout(() => entry.remove(), 6000);
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

  banner(text: string, ms = 2500) {
    const b = this.refs.banner;
    b.textContent = text;
    b.classList.add("show");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove("show"), ms);
  }


  prompt(html: string | null, locked = false) {
    const p = this.refs.prompt;
    if (!html) {
      p.classList.remove("show");
      p.classList.remove("locked");
      return;
    }
    p.innerHTML = html;
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
