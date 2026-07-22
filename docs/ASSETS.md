# Assets — placeholders & how to replace them

The prototype ships with **zero copyrighted assets**. Everything is generated at
runtime:

- **Audio:** synthesized WebAudio tones (`packages/client/src/audio/AudioManager.ts`).
- **Props & characters:** procedural Babylon meshes (`packages/client/src/game/mapBuilder.ts`).

Replace them with your own original or royalty-free assets when polishing (Phase 3).

## Audio

Today each cue (`shoot`, `jump`, `transform`, `countdown`, …) is an oscillator/noise
burst. To use real samples:

1. Put royalty-free `.ogg`/`.mp3` files under `packages/client/public/audio/`.
   Good sources: **Kenney.nl** (CC0), **freesound.org** (check each license),
   **OpenGameArt.org** (CC0/CC-BY). Verify the license per file.
2. In `AudioManager`, load them once (after `unlock()`), decode to `AudioBuffer`s,
   and in `play(sfx)` play the matching buffer through `this.master` instead of
   calling `blip()/noise()`. Keep the autoplay rule: audio only starts after a
   real user gesture (the "Click to play" button already provides it).

Cues to provide: `ui, shoot, reload, jump, transform, hit, eliminate, countdown,
round_start, round_end, taunt`.

## 3D models (props & characters)

Props are keyed by `modelKey` in `packages/shared/src/maps.ts` (`PROP_MODELS`).
Each has a collision `radius`/`height` the **server** relies on for hitscan — keep
those roughly matching your visual so hitboxes stay fair.

To swap procedural shapes for real art:

1. Export **glTF/glb** (Blender → glTF is ideal). Keep them low-poly and stylized
   for performance; author consistent scale (metres).
2. Drop files in `packages/client/public/models/` (e.g. `barrel.glb`).
3. In `mapBuilder.ts`, replace `createPropVisual()`'s procedural branch with
   `ImportMeshAsync`/`AppendSceneAsync` from `@babylonjs/loaders` keyed by
   `modelKey`, and **cache + instance** loaded meshes (don't load per player).
4. Same idea for `createHunterVisual()` (a rigged character + idle/run animations).

## Maps

A map is pure data (`MapDefinition` in `maps.ts`): floor size, walls, spawn points,
and the prop whitelist. Add new maps by adding entries to `MAPS` and setting
`state.mapId`. For art-authored maps, load a glTF environment and keep the data
file for spawns, bounds (anti-teleport), and the disguise whitelist.

## Licensing reminder

Track the license of every third-party asset in a `CREDITS.md`. Prefer **CC0** to
avoid attribution obligations. Never import assets, code, sounds, or branding from
Call of Duty or any other proprietary game.
