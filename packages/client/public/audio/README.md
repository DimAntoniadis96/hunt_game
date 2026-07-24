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
```

Keep clips short (a few hundred ms for effects) and pre-normalized. Record the
license of every file you add in `CREDITS.md`. Recommended packs: Kenney.nl
"Interface", "Impact", and "Shooting" sound packs (all CC0).
