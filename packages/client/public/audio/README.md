# Drop game sound effects here

Put royalty-free (ideally **CC0**) audio files in this folder, named exactly after
the cue they replace. The game loads them automatically on the first click — no
code changes needed. Anything missing keeps its synthesized fallback.

Expected file names (any of `.ogg`, `.mp3`, `.wav` — the loader tries them in that
order):

```
ui            e.g. ui.ogg          — menu / button click
shoot         e.g. shoot.ogg       — hunter fires
reload        e.g. reload.ogg      — magazine reload
jump          e.g. jump.ogg        — any player hops
transform     e.g. transform.ogg   — prop disguises / drops a decoy
hit           e.g. hit.ogg         — a shot connects
eliminate     e.g. eliminate.ogg   — a prop is killed
countdown     e.g. countdown.ogg   — lobby countdown tick
round_start   e.g. round_start.ogg — round begins
round_end     e.g. round_end.ogg   — round / match ends
taunt         e.g. taunt.ogg       — prop taunt locator
step          e.g. step.ogg        — hunter footstep (played positionally)
```

Per-hider whistles (5 variants — each hider is randomly assigned one per round):

```
whistle1  whistle2  whistle3  whistle4  whistle5   (.ogg / .mp3 / .wav)
```

Axe hit (2 variants — one is picked at random on each axe hit, including when the
axe smashes a decoy clone, so a clone sounds just like a real hider):

```
axe1  axe2
```

Axe miss — played when an axe swing connects with nothing (empty air, no prop and
no clone):

```
axe_miss
```

Death & damage stings (one of each pair is picked at random per event):

```
death1   death2    — played when a hider is killed (fires from the killfeed)
damage1  damage2    — played when the local player takes damage from a seeker
```

Looping background music (phase-driven, streamed via `<audio loop>`, mixed well
under the SFX at ~0.28 volume). Only `.ogg` is loaded for these:

```
music_lobby   — Lobby / countdown: players waiting to ready up ("preload")
music_hide    — Prep phase: props hiding while hunters are frozen
music_hunt    — Hunt phase: hunters released, main game
```

The four stings ship as −19 LUFS mono ~22 kHz clips (peaks kept ≤ −2.5 dBFS so
they never clip); the three music tracks are loudness-matched to −18 LUFS
stereo. Replace any of them with a like-named file and keep similar levels so the
mix stays balanced.

`whistle1..5` and `step` are played **spatially** (volume fades from loud up
close to zero far away, plus left/right pan by direction), so use short, dry,
mono clips — a single footfall for `step`, one short whistle per `whistleN`. The
five shipped `whistle*.ogg` were loudness-matched to −16 LUFS and compressed to
mono 22 kHz (~6–7 KB each); if you replace them, keep them at a similar level so
one hider isn't louder than another. If no `whistleN` file is present the game
falls back to a synthesized whistle. Keep other clips short (a few hundred ms)
and pre-normalized. Record the
license of every file you add in `CREDITS.md`. Recommended packs: Kenney.nl
"Interface", "Impact", and "Shooting" sound packs (all CC0).
