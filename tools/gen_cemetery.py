#!/usr/bin/env python3
"""
Generate the Hollow Row cemetery map as TypeScript.

Placing ~70 props by hand and hoping they don't intersect is how you get props
embedded in walls and spawns inside headstones. So the layout is solved here
against the same rules the test suite enforces:

  * props never overlap each other        (tests/map-layout.test.mjs)
  * props never overlap solid structures  (visual + spawn correctness)
  * every occluder is taller than the 0.45m step height
                                          (tests/step-offset.test.mjs)
  * spawns land clear                     (tests/spawn-clearance.test.mjs)

Deterministic: fixed seed, so re-running produces the identical map.
"""
import math
import random

random.seed(20260803)

# --- bounds -----------------------------------------------------------------
# Tighter than the backyard (96x88). A cemetery should feel closed-in, and a
# smaller map keeps every sound meaningfully audible.
MIN_X, MAX_X = -34.0, 34.0
MIN_Z, MAX_Z = -29.0, 29.0
WIDTH, DEPTH = MAX_X - MIN_X, MAX_Z - MIN_Z
WALL_H = 3.0
STEP_HEIGHT = 0.45  # must stay in sync with InputController

# --- prop models used here (radius, height) ---------------------------------
MODELS = {
    # new, cemetery-specific
    "headstone":    (0.45, 1.00),
    "grave_cross":  (0.35, 1.30),
    "urn":          (0.34, 0.80),
    "angel_statue": (0.45, 1.70),
    "coffin":       (0.70, 0.60),
    # existing models, reused as groundskeeping clutter
    "bush":         (0.60, 0.95),
    "rock":         (0.55, 0.60),
    "tree_stump":   (0.50, 0.60),
    "plant":        (0.40, 1.20),
    "planter":      (0.60, 0.60),
    "flower_pot":   (0.35, 0.70),
    "lantern":      (0.28, 0.75),
    "bench":        (0.85, 0.85),
    "wheelbarrow":  (0.60, 0.70),
    "barrel":       (0.42, 1.15),
    "crate_small":  (0.45, 0.90),
    "crate_large":  (0.70, 1.40),
    "bucket":       (0.30, 0.50),
    "bin":          (0.40, 1.05),
    "trash_can":    (0.35, 1.00),
    "toolbox":      (0.50, 0.55),
    "pallet_stack": (0.75, 1.10),
    "mushroom":     (0.35, 0.70),
    "pumpkin":      (0.45, 0.55),
    "birdhouse":    (0.34, 0.85),
    "watering_can": (0.38, 0.65),
    "cooler":       (0.50, 0.60),
    "tire":         (0.50, 0.80),
}

# --- solid structures --------------------------------------------------------
# (cx, cz, width_x, depth_z, height, label). Every one is well above STEP_HEIGHT
# so nothing here becomes walk-through.
STRUCTURES = []

def solid(cx, cz, w, d, h, label):
    assert h > STEP_HEIGHT + 0.05, f"{label} is {h}m — at or under the step height, players would walk through it"
    STRUCTURES.append(dict(cx=cx, cz=cz, w=w, d=d, h=h, label=label))

# Perimeter wall — four slabs just inside the bounds.
solid(0, MIN_Z + 0.4, WIDTH, 0.8, 2.6, "wall_s")
solid(0, MAX_Z - 0.4, WIDTH, 0.8, 2.6, "wall_n")
solid(MIN_X + 0.4, 0, 0.8, DEPTH, 2.6, "wall_w")
solid(MAX_X - 0.4, 0, 0.8, DEPTH, 2.6, "wall_e")

# Chapel (north-centre) — the landmark, with a porch you can duck behind.
solid(0, 20.0, 16.0, 11.0, 7.0, "chapel")
solid(0, 13.6, 6.0, 2.2, 3.4, "chapel_porch")

# Mausoleum row (east) — three tombs with gaps to slip between.
for i, z in enumerate((-13.0, -3.0, 7.0)):
    solid(22.0, z, 6.0, 5.0, 3.4, f"crypt_e{i}")

# Older tombs (west)
solid(-22.0, -8.0, 5.5, 5.5, 3.0, "crypt_w0")
solid(-23.0, 6.0, 4.5, 6.5, 2.8, "crypt_w1")

# Caretaker's shed (south-west corner) and its lean-to.
solid(-24.0, -20.0, 7.0, 5.0, 2.8, "shed")
solid(-17.5, -21.0, 3.0, 3.0, 2.2, "lean_to")

# Interior stone dividers — sightline breakers between the grave fields.
solid(-6.0, -2.0, 0.7, 14.0, 1.6, "divider_a")
solid(9.0, 4.0, 0.7, 12.0, 1.6, "divider_b")
solid(4.0, -14.0, 13.0, 0.7, 1.5, "divider_c")

# Dead trees — round, so approximate them as square footprints for clearance.
TREES = [(-13.0, 14.0), (14.0, -20.0), (-30.0, 18.0), (28.0, 21.0), (-3.0, -24.0)]
for i, (tx, tz) in enumerate(TREES):
    solid(tx, tz, 1.1, 1.1, 5.5, f"tree{i}")

# --- spawns ------------------------------------------------------------------
# Hunters enter through the south gate, together and away from the graves.
HUNTER_SPAWNS = [(x, -26.0) for x in (-9, -6, -3, 0, 3, 6, 9)] + [(0.0, -23.5)]
# Props scatter across the grave fields and the crypt aisles.
PROP_SPAWNS = [
    (-14.0, -6.0), (13.0, -8.0), (-16.0, 2.0), (16.0, 12.0),
    (-9.0, 22.0), (7.0, 24.0), (-27.0, -12.0), (27.0, -22.0),
]

# --- placement helpers -------------------------------------------------------
PLACED = []  # (x, z, radius)

def hits_structure(x, z, r, pad=0.25):
    for s in STRUCTURES:
        hw, hd = s["w"] / 2 + r + pad, s["d"] / 2 + r + pad
        if abs(x - s["cx"]) < hw and abs(z - s["cz"]) < hd:
            return True
    return False

def hits_prop(x, z, r, gap=0.18):
    for (px, pz, pr) in PLACED:
        if math.hypot(x - px, z - pz) < r + pr + gap:
            return True
    return False

def hits_spawn(x, z, r, clear=2.2):
    for (sx, sz) in HUNTER_SPAWNS + PROP_SPAWNS:
        if math.hypot(x - sx, z - sz) < r + clear:
            return True
    return False

def free(x, z, r):
    if not (MIN_X + 1.6 + r < x < MAX_X - 1.6 - r):
        return False
    if not (MIN_Z + 1.6 + r < z < MAX_Z - 1.6 - r):
        return False
    return not (hits_structure(x, z, r) or hits_prop(x, z, r) or hits_spawn(x, z, r))

PROPS = []

def place(model, x, z, ry=None):
    r = MODELS[model][0]
    if not free(x, z, r):
        return False
    PLACED.append((x, z, r))
    PROPS.append(dict(model=model, x=round(x, 2), z=round(z, 2),
                      ry=round(random.uniform(0, math.tau) if ry is None else ry, 3)))
    return True

def scatter(model, count, x0, x1, z0, z1, tries=400):
    made = 0
    for _ in range(tries):
        if made >= count:
            break
        if place(model, random.uniform(x0, x1), random.uniform(z0, z1)):
            made += 1
    return made

# --- grave rows --------------------------------------------------------------
# Regular rows read as a real graveyard, and give hiders a crowd to blend into.
# All headstones in a row share a facing, like real plots.
rows = [
    (-28.0, -4.0, -18.0, 0.0),   # west field
    (-28.0, -4.0, -13.5, 0.0),
    (-28.0, -4.0, -9.0, 0.0),
    (1.0, 17.0, -20.0, 0.0),     # south-east field
    (1.0, 17.0, -16.0, 0.0),
    (-20.0, -9.0, 10.0, math.pi),   # north-west field
    (-20.0, -9.0, 15.0, math.pi),
    (2.0, 16.0, 15.0, math.pi),  # north-east field
]
row_marks = 0
for (x0, x1, z, facing) in rows:
    x = x0
    while x <= x1:
        model = "headstone"
        roll = random.random()
        if roll < 0.16:
            model = "grave_cross"
        elif roll < 0.24:
            model = "urn"
        if place(model, x + random.uniform(-0.22, 0.22), z + random.uniform(-0.3, 0.3), facing + random.uniform(-0.05, 0.05)):
            row_marks += 1
        x += 2.4

# --- landmarks and clutter ---------------------------------------------------
counts = {}
counts["angel_statue"] = scatter("angel_statue", 4, -26, 26, -18, 24)
counts["coffin"] = scatter("coffin", 3, -26, 26, -22, 24)
# Groundskeeper's corner. Kept to a strip along the south-west wall, BEHIND the
# shed and clear of every grave row: these are the only saturated props on the
# map (red buckets, a blue barrel, orange crates) and among headstones at night
# they are the first thing your eye lands on, which looks like a mistake.
for model, n in (("wheelbarrow", 2), ("barrel", 4), ("crate_small", 4), ("crate_large", 2),
                 ("bucket", 3), ("toolbox", 2), ("pallet_stack", 2), ("tire", 2), ("cooler", 1)):
    counts[model] = scatter(model, n, -31, -11, -26.5, -22.5)
# Scattered stonework outside the tidy rows: leaning markers, family urns and a
# few crosses, so the fields don't read as a single grid.
for model, n in (("headstone", 10), ("urn", 6), ("grave_cross", 5)):
    counts[model] = counts.get(model, 0) + scatter(model, n, -30, 30, -25, 25)
# Groundcover and lamps. Deliberately limited to things that belong in a
# graveyard at night. Pumpkins, toadstools, birdhouses and the backyard's
# vivid-green bush are all excluded: their palette is tuned for a sunlit lawn
# and at night they glow like stickers against the dark grass.
for model, n in (("rock", 9), ("tree_stump", 6), ("lantern", 8), ("bench", 5)):
    counts[model] = scatter(model, n, -31, 31, -26, 26)
# A handful of grave flowers, kept to the tended plots near the chapel.
counts["flower_pot"] = scatter("flower_pot", 4, -14, 14, 4, 22)

# --- verify against the same rules the test suite uses -----------------------
errs = []
for i in range(len(PROPS)):
    for j in range(i + 1, len(PROPS)):
        a, b = PROPS[i], PROPS[j]
        need = MODELS[a["model"]][0] + MODELS[b["model"]][0]
        dist = math.hypot(a["x"] - b["x"], a["z"] - b["z"])
        if dist + 0.01 < need:
            errs.append(f"props {i}/{j} overlap: {dist:.2f} < {need:.2f}")
for p in PROPS:
    if hits_structure(p["x"], p["z"], MODELS[p["model"]][0], pad=0.0):
        errs.append(f"prop {p['model']} at ({p['x']},{p['z']}) is inside a structure")
for s in STRUCTURES:
    if s["h"] <= STEP_HEIGHT:
        errs.append(f"structure {s['label']} is walk-through at {s['h']}m")
if errs:
    raise SystemExit("LAYOUT INVALID:\n" + "\n".join(errs))

# --- emit --------------------------------------------------------------------
def occ_line(s):
    return (f"  occ({s['cx']}, {s['cz']}, {s['w']}, {s['d']}, {s['h']}), // {s['label']}")

lines = []
lines.append("/** Solid structures on the cemetery — mirrors the collidable meshes the")
lines.append(" *  client builds in mapBuilder's buildCemetery(). */")
lines.append("export const CEMETERY_STRUCTURES: Occluder[] = [")
lines += [occ_line(s) for s in STRUCTURES]
lines.append("];")
lines.append("")
lines.append("/** Dead trees (x, z) — the client draws trunks and bare branches here. */")
lines.append("export const CEMETERY_TREES: Array<[number, number]> = [")
lines.append("  " + ", ".join(f"[{x}, {z}]" for x, z in TREES) + ",")
lines.append("];")
lines.append("")
lines.append("export const HOLLOW_ROW: MapDefinition = {")
lines.append('  id: "hollow_row",')
lines.append('  displayName: "Hollow Row",')
lines.append('  theme: "cemetery",')
lines.append(f"  width: {WIDTH},")
lines.append(f"  depth: {DEPTH},")
lines.append(f"  wallHeight: {WALL_H},")
lines.append(f"  bounds: {{ minX: {MIN_X}, maxX: {MAX_X}, minZ: {MIN_Z}, maxZ: {MAX_Z} }},")
lines.append("  hunterSpawns: [")
for (x, z) in HUNTER_SPAWNS:
    lines.append(f"    {{ x: {x}, y: 0, z: {z}, ry: 0 }},")
lines.append("  ],")
lines.append("  propSpawns: [")
for (x, z) in PROP_SPAWNS:
    lines.append(f"    {{ x: {x}, y: 0, z: {z}, ry: Math.PI }},")
lines.append("  ],")
lines.append("  props: [")
for i, p in enumerate(PROPS):
    lines.append(f'    {{ id: "c{i:02d}", modelKey: "{p["model"]}", x: {p["x"]}, y: 0, z: {p["z"]}, ry: {p["ry"]} }},')
lines.append("  ],")
lines.append("  occluders: CEMETERY_STRUCTURES,")
lines.append("};")

open("/tmp/spawn/cemetery_block.ts", "w").write("\n".join(lines) + "\n")

print(f"structures : {len(STRUCTURES)}")
print(f"grave marks: {row_marks}")
print(f"props total: {len(PROPS)}")
from collections import Counter
c = Counter(p["model"] for p in PROPS)
print("prop mix   :", ", ".join(f"{k} x{v}" for k, v in c.most_common()))
print(f"map        : {WIDTH:.0f} x {DEPTH:.0f} m, diagonal {math.hypot(WIDTH, DEPTH):.1f} m")
print("layout verified: no prop/prop, prop/structure overlaps; all structures above step height")
