import { Phase, Team, WEAPON_MAG_SIZE, type PlayerView } from "@mimic/shared";

interface StateLike {
  phase: Phase;
  round: number;
  roundsPerMatch: number;
  phaseEndsAt: number;
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
      <div class="crosshair hidden" data-r="crosshair"></div>
      <div class="hud-bottom-left">
        <div data-r="teamlabel" style="font-weight:700">—</div>
        <div class="sub" data-r="lifelabel">Health</div>
        <div class="health-bar"><div class="health-fill" data-r="health" style="width:100%"></div></div>
      </div>
      <div class="hud-bottom-right hidden" data-r="weapon">
        <div class="ammo"><span data-r="ammo">8</span><span class="mag">/${WEAPON_MAG_SIZE}</span></div>
        <div class="sub" data-r="wstate">R to reload</div>
      </div>
      <div class="killfeed" data-r="killfeed"></div>
      <div class="banner" data-r="banner"></div>
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
    this.refs.phase.textContent = PHASE_LABEL[phase] ?? phase;
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
    this.refs.weapon.classList.toggle("hidden", !isHunter);
    this.refs.crosshair.classList.toggle("hidden", !isHunter || !me?.alive);
    if (isHunter && me) {
      this.refs.ammo.textContent = String(me.ammo);
      this.refs.wstate.textContent = me.reloading ? "Reloading…" : me.ammo === 0 ? "Press R" : "R to reload";
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

  banner(text: string, ms = 2500) {
    const b = this.refs.banner;
    b.textContent = text;
    b.classList.add("show");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove("show"), ms);
  }

  prompt(html: string | null) {
    const p = this.refs.prompt;
    if (!html) {
      p.classList.remove("show");
      return;
    }
    p.innerHTML = html;
    p.classList.add("show");
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
