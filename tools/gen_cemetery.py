#!/usr/bin/env python3
"""
Generate the Hollow Row cemetery map as TypeScript.

DESIGN NOTE — why this is not another open field
------------------------------------------------
The first pass at this map was a big rectangle with a perimeter wall and props
sprinkled over it. That is structurally the same map as Sunnyside Yard with
different furniture: one space, every sightline available from everywhere, and
hiding reduced to "stand still somewhere far away".

This version is built as FOUR ENCLOSED ROOMS around a cross of open lanes:

                          N
        +--------------------------------------+
        |  chapel ruin      |    tomb alley    |
        |  (roofless nave)  |  (3 mausoleums)  |
        |===== doorway =====|==== doorway =====|
     W  |         c e n t r a l   c r o s s    |  E
        |===== doorway =====|==== doorway =====|
        |  family plots     |  caretaker yard  |
        |  (low pen walls)  |  (shed + gate)   |
        +--------------------------------------+
                          S   <- hunters enter here

Consequences that matter for play:
  * A hunter in the lane can see a long way but into nothing. Every hider is
    behind a wall until the hunter commits to a doorway.
  * Each room has its OWN prop vocabulary — pews in the chapel, mausoleum
    stonework in the alley, headstones in the plots, tools in the yard. Picking
    the right disguise for the room you are in becomes a real decision, which
    is the whole point of prop hunt. On one uniform field it never was.
  * The family plots use LOW walls (1.1m): you can see over them but not walk
    through, so that quadrant reads as cover rather than as another box maze.

Prop count is deliberately sparse. Clutter is not content: 130 props on one
field meant no prop was a landmark and the frame was soup, and even the second
pass at ~115 was still dense enough that rooms read as heaps rather than places.
Each room now gets the smallest set that still gives hiders a real choice —
roughly two of most things, so a third one is a landmark and not noise.

The client draws its geometry straight from CEMETERY_BLOCKS, and the server's
occluders are derived from the SAME array, so the two can never drift apart.

Deterministic: fixed seed, so re-running produces the identical map.
"""
import math
import os
import random

random.seed(20260803)

# --- bounds -----------------------------------------------------------------
# Smaller than the first pass (68x58). Rooms make a map feel big; floor area
# just makes it empty.
MIN_X, MAX_X = -30.0, 30.0
MIN_Z, MAX_Z = -25.0, 25.0
WIDTH, DEPTH = MAX_X - MIN_X, MAX_Z - MIN_Z
WALL_H = 3.0
STEP_HEIGHT = 0.45  # must stay in sync with InputController

# Lane geometry. The cross of open ground that every room opens onto.
LANE = 4.0  # half-width of each lane, so the lanes are 8m across

# --- prop models used here (radius, height) ---------------------------------
# EVERY entry has to belong in a graveyard. No crates, barrels, buckets, tyres,
# pallets or toolboxes: a stack of pallets here reads as placeholder art, and a
# hider who becomes one is announcing themselves from across the map. If a model
# would look at home in the warehouse, it does not go on this list.
#
# Keep this in sync with PROP_MODELS in packages/shared/src/maps.ts — the
# radius/height pairs are what the layout solver spaces things by.
MODELS = {
    # stonework
    "headstone":      (0.45, 1.00),
    "grave_cross":    (0.35, 1.30),
    "urn":            (0.34, 0.80),
    "angel_statue":   (0.45, 1.70),
    "sarcophagus":    (0.85, 0.95),
    "gargoyle":       (0.46, 1.30),
    "broken_pillar":  (0.42, 1.15),
    "stone_well":     (0.88, 1.15),
    # the dead
    "coffin":         (0.70, 0.60),
    "coffin_open":    (0.62, 1.90),
    "skeleton":       (0.42, 1.75),
    "skull":          (0.26, 0.34),
    "bone_pile":      (0.55, 0.42),
    "grave_mound":    (0.82, 0.55),
    # light and fire
    "lantern":        (0.28, 0.75),
    "candelabra":     (0.30, 1.35),
    "brazier":        (0.44, 1.05),
    "cauldron":       (0.52, 0.80),
    "jack_o_lantern": (0.44, 0.55),
    # creatures and relics
    "raven":          (0.30, 0.60),
    "bat":            (0.32, 0.58),
    "grave_sword":    (0.30, 1.45),
    "shield":         (0.42, 1.05),
    "scarecrow":      (0.45, 2.00),
    # the chapel's pews
    "bench":          (0.85, 0.85),
}

# --- blocks ------------------------------------------------------------------
# One list, drawn by the client and turned into occluders by the server. `kind`
# only picks the material on the client; collision comes from the same numbers.
BLOCKS = []

def block(cx, cz, w, d, h, kind, label):
    assert h > STEP_HEIGHT + 0.05, f"{label} is {h}m — at or under the step height, players would walk through it"
    assert w > 0 and d > 0, f"{label} has a zero dimension"
    BLOCKS.append(dict(cx=round(cx, 2), cz=round(cz, 2), w=round(w, 2), d=round(d, 2),
                       h=h, kind=kind, label=label))

def span_x(x0, x1, z, thick, h, kind, label):
    """A wall running along x from x0 to x1, centred on z."""
    block((x0 + x1) / 2, z, x1 - x0, thick, h, kind, label)

def span_z(z0, z1, x, thick, h, kind, label):
    """A wall running along z from z0 to z1, centred on x."""
    block(x, (z0 + z1) / 2, thick, z1 - z0, h, kind, label)

# Perimeter.
span_x(MIN_X, MAX_X, MIN_Z + 0.4, 0.8, 2.8, "wall", "perim_s")
span_x(MIN_X, MAX_X, MAX_Z - 0.4, 0.8, 2.8, "wall", "perim_n")
span_z(MIN_Z, MAX_Z, MIN_X + 0.4, 0.8, 2.8, "wall", "perim_w")
span_z(MIN_Z, MAX_Z, MAX_X - 0.4, 0.8, 2.8, "wall", "perim_e")

# --- room shells -------------------------------------------------------------
# Each room is closed off from the lanes except for one doorway per side. The
# doorways are 4m so two players can pass, and deliberately NOT aligned across
# the map: a hunter standing in the crossing can never see into two rooms at
# once.
ROOM_WALL_H = 3.2
DOOR = 4.0

def wall_with_door(axis, a0, a1, fixed, door_at, h, label):
    """A run of wall with a DOOR-wide hole centred on `door_at`."""
    lo, hi = door_at - DOOR / 2, door_at + DOOR / 2
    assert a0 < lo and hi < a1, f"{label}: doorway {door_at} is not inside the wall run"
    if axis == "x":
        span_x(a0, lo, fixed, 0.7, h, "wall", label + "_a")
        span_x(hi, a1, fixed, 0.7, h, "wall", label + "_b")
    else:
        span_z(a0, lo, fixed, 0.7, h, "wall", label + "_a")
        span_z(hi, a1, fixed, 0.7, h, "wall", label + "_b")

# North-west: the chapel ruin. Doors on the south and the east.
wall_with_door("x", MIN_X, -LANE, LANE, -19.0, ROOM_WALL_H, "chapel_s")
wall_with_door("z", LANE, MAX_Z, -LANE, 17.0, ROOM_WALL_H, "chapel_e")
# North-east: the tomb alley. Doors on the south and the west, offset from the
# chapel's so the crossing never opens both at once.
wall_with_door("x", LANE, MAX_X, LANE, 11.0, ROOM_WALL_H, "alley_s")
wall_with_door("z", LANE, MAX_Z, LANE, 21.0, ROOM_WALL_H, "alley_w")
# South-west: the family plots. Doors on the north and the east.
wall_with_door("x", MIN_X, -LANE, -LANE, -21.0, ROOM_WALL_H, "plots_n")
wall_with_door("z", MIN_Z, -LANE, -LANE, -16.5, ROOM_WALL_H, "plots_e")
# South-east: the caretaker's yard. Doors on the north and the west.
wall_with_door("x", LANE, MAX_X, -LANE, 13.0, ROOM_WALL_H, "yard_n")
wall_with_door("z", MIN_Z, -LANE, LANE, -10.0, ROOM_WALL_H, "yard_w")

# --- room interiors ----------------------------------------------------------
# Chapel ruin (NW): a nave. Two rows of broken columns down the middle and an
# altar block at the north end. Roofless, so moonlight reaches the floor — a
# roofed interior on a night map is a black hole you cannot fight in.
for i, cz in enumerate((9.5, 13.5, 17.5, 21.0)):
    block(-22.0, cz, 0.9, 0.9, 4.2, "pillar", f"chapel_colw{i}")
    block(-11.0, cz, 0.9, 0.9, 4.2, "pillar", f"chapel_cole{i}")
block(-16.5, 22.0, 5.0, 1.4, 1.2, "altar", "chapel_altar")
# The surviving gable end, twice the height of anything else on the map. It
# carries the lit window and stands well clear of the 3.2m room walls, so from
# anywhere in the crossing it tells you which way is north. Every map needs one
# thing you can navigate by; on a dark map it has to be tall AND lit.
block(-16.5, 23.9, 13.0, 0.9, 8.0, "gable", "chapel_gable")
# A fallen section of the west wall, so the ruin reads as ruined.
block(-27.0, 15.0, 2.4, 3.2, 1.0, "wall", "chapel_rubble")

# Tomb alley (NE): three mausoleums with gaps, forming two north-south alleys
# you have to walk into. Solid: these are the map's hard cover.
for i, cx in enumerate((10.5, 17.5, 24.5)):
    block(cx, 15.0, 4.8, 11.0, 3.6, "tomb", f"tomb{i}")

# Family plots (SW): three pens of LOW wall. You can see over them, so this
# quadrant is about partial cover and angles rather than blind corners.
PLOT_H = 1.1
for i, (px, pz) in enumerate(((-23.0, -18.0), (-11.5, -18.0), (-23.0, -9.0))):
    span_x(px - 4.0, px + 4.0, pz - 3.0, 0.5, PLOT_H, "plot", f"plot{i}_s")
    span_x(px - 4.0, px + 4.0, pz + 3.0, 0.5, PLOT_H, "plot", f"plot{i}_n")
    span_z(pz - 3.0, pz + 3.0, px - 4.0, 0.5, PLOT_H, "plot", f"plot{i}_w")

# Caretaker's yard (SE): the shed is the only true building, plus its lean-to.
block(22.0, -19.0, 8.0, 6.0, 3.0, "shed", "shed")
block(14.5, -20.5, 3.4, 3.4, 2.2, "shed", "lean_to")
block(24.0, -9.0, 6.0, 1.0, 1.4, "plot", "yard_stack")

# The crossing: one obelisk dead centre. It is the only thing breaking the two
# 50m lane sightlines, and it is what you steer by when you have lost the plot.
block(0.0, 0.0, 2.2, 2.2, 6.0, "obelisk", "obelisk")

# --- dead trees --------------------------------------------------------------
# Round, so approximate them as square footprints for clearance. Placed at the
# lane mouths where they break a straight run without closing it.
TREES = [(-6.5, 8.0), (6.5, -8.0), (-6.5, -20.0), (6.5, 20.0)]
for i, (tx, tz) in enumerate(TREES):
    block(tx, tz, 1.1, 1.1, 5.5, "tree", f"tree{i}")

# --- ground surfaces ---------------------------------------------------------
# Every patch of paving on the map, as data.
#
# These are FLUSH decals: they sit at the same height as the ground and win the
# depth test with a negative zOffset rather than being physically raised, so
# props standing on them are not sliced off at the ankles. The catch is that two
# coplanar surfaces with the SAME bias z-fight — the pixels flicker between them
# as the camera moves, which is what the crossing did when the north-south and
# east-west lanes were each drawn full-length and overlapped in the middle.
#
# So: the cross is cut into three pieces that do not overlap, and the assertion
# below refuses to emit a layout where any two surfaces share ground.
FLOORS = []

def floor(cx, cz, w, d, hexcol, kind, z_pri, label):
    FLOORS.append(dict(cx=round(cx, 2), cz=round(cz, 2), w=round(w, 2), d=round(d, 2),
                       hex=hexcol, kind=kind, zPri=z_pri, label=label))

LANE_HEX = "#4a4741"
# The north-south lane runs the full depth; the east-west lane is cut into two
# arms that stop where the other begins.
floor(0.0, 0.0, LANE * 2, DEPTH, LANE_HEX, "concrete", -1, "lane_ns")
floor((MIN_X - LANE) / 2, 0.0, abs(MIN_X) - LANE, LANE * 2, LANE_HEX, "concrete", -1, "lane_w")
floor((MAX_X + LANE) / 2, 0.0, MAX_X - LANE, LANE * 2, LANE_HEX, "concrete", -1, "lane_e")
# One surface per room, so you always know which room you are standing in even
# at a glance in the dark. Each is inset to the room's own quadrant.
floor(-17.0, 14.75, 25.0, 19.5, "#4f4b45", "concrete", -3, "floor_chapel")
floor(17.0, 14.75, 25.0, 19.5, "#3f3d39", "concrete", -3, "floor_alley")
floor(-17.0, -14.75, 25.0, 19.5, "#3d3a33", "concrete", -3, "floor_plots")
floor(17.0, -14.75, 25.0, 19.5, "#4a3f31", "sand", -3, "floor_yard")

# --- scare anchors -----------------------------------------------------------
# Places a jumpscare is allowed to come from. Deliberately tied to landmarks —
# a tomb doorway, the well, the altar — because a noise from a believable place
# makes a player look there, and a noise from open ground just reads as a bug.
# (x, z, y) — the height is last because it is the least interesting number.
SCARE_POINTS = [
    (-16.5, 22.0, 1.4),   # the chapel altar
    (-22.0, 13.5, 2.2),   # among the nave columns
    (-27.0, 15.0, 1.2),   # the collapsed west wall
    (14.0, 12.0, 2.4),    # west tomb alley
    (21.0, 18.0, 2.4),    # east tomb alley
    (17.5, 22.0, 3.0),    # behind the tombs
    (-23.0, -18.0, 1.0),  # inside a family plot
    (-11.5, -15.0, 1.0),  # the near plot's gate
    (10.5, -8.5, 1.6),    # the old well
    (22.0, -19.0, 3.2),   # the gravedigger's shed roof
    (0.0, 0.0, 6.5),      # the obelisk, above the crossing
]

# --- spawns ------------------------------------------------------------------
# Hunters enter together at the south mouth of the main lane and have to choose
# a room. Two hiders start in each room, so no room is empty at the whistle.
HUNTER_SPAWNS = [(x, -22.5) for x in (-3.0, -1.5, 0.0, 1.5, 3.0)] + [(-2.0, -20.0), (0.0, -20.0), (2.0, -20.0)]
PROP_SPAWNS = [
    (-16.0, 12.0), (-13.0, 20.0),      # chapel ruin
    (13.5, 11.5), (21.0, 17.5),        # tomb alley — one at each alley mouth
    (-16.5, -22.5), (-25.5, -12.8),    # family plots
    (11.0, -13.0), (25.0, -23.0),      # caretaker's yard
]

# --- placement helpers -------------------------------------------------------
PLACED = []  # (x, z, radius)

def hits_block(x, z, r, pad=0.3):
    for s in BLOCKS:
        if abs(x - s["cx"]) < s["w"] / 2 + r + pad and abs(z - s["cz"]) < s["d"] / 2 + r + pad:
            return True
    return False

def hits_prop(x, z, r, gap=0.35):
    return any(math.hypot(x - px, z - pz) < r + pr + gap for (px, pz, pr) in PLACED)

def hits_spawn(x, z, r, clear=2.0):
    return any(math.hypot(x - sx, z - sz) < r + clear for (sx, sz) in HUNTER_SPAWNS + PROP_SPAWNS)

def free(x, z, r):
    if not (MIN_X + 1.6 + r < x < MAX_X - 1.6 - r):
        return False
    if not (MIN_Z + 1.6 + r < z < MAX_Z - 1.6 - r):
        return False
    return not (hits_block(x, z, r) or hits_prop(x, z, r) or hits_spawn(x, z, r))

PROPS = []

def place(model, x, z, ry=None):
    r = MODELS[model][0]
    if not free(x, z, r):
        return False
    PLACED.append((x, z, r))
    PROPS.append(dict(model=model, x=round(x, 2), z=round(z, 2),
                      ry=round(random.uniform(0, math.tau) if ry is None else ry, 3)))
    return True

def scatter(model, count, x0, x1, z0, z1, tries=600):
    made = 0
    for _ in range(tries):
        if made >= count:
            break
        if place(model, random.uniform(x0, x1), random.uniform(z0, z1)):
            made += 1
    return made

def row(model, x0, x1, z, step, facing=0.0, jitter=0.18):
    made = 0
    x = x0
    while x <= x1:
        if place(model, x + random.uniform(-jitter, jitter), z + random.uniform(-jitter, jitter),
                 facing + random.uniform(-0.04, 0.04)):
            made += 1
        x += step
    return made

counts = {}
def tally(model, n):
    counts[model] = counts.get(model, 0) + n

# ---- fixed lighting, placed before anything else --------------------------
# These are asserted, not scattered. place() fails silently when something is
# in the way, and a scatter that ran first would quietly take a lamp's spot —
# leaving a 12m corridor with no light in it, which is a room players never
# enter. Claiming the lit positions up front makes that impossible.
# Candelabra flanking the altar, lit. They are the reason you can see the far
# end of the nave at all.
for (cx, cz) in ((-20.4, 22.4), (-12.6, 22.4)):
    assert place("candelabra", cx, cz), f"altar candelabra at ({cx},{cz}) was blocked"
    tally("candelabra", 1)
# Hand-placed and ASSERTED: place() fails silently if something is in the way,
# and a silently-dropped lantern here means a 12m corridor with no light in it,
# which is a room players simply do not enter.
for (lx, lz) in ((14.0, 8.6), (21.0, 8.6), (14.0, 21.4), (21.0, 21.4)):
    assert place("lantern", lx, lz), f"alley lantern at ({lx},{lz}) was blocked"
    tally("lantern", 1)
# Braziers at the alley mouths: warmer and taller than a lantern, so from the
# crossing you can see there is something lit down there worth walking into.
for (bx, bz) in ((14.0, 22.6), (21.0, 22.6)):
    assert place("brazier", bx, bz), f"alley brazier at ({bx},{bz}) was blocked"
    tally("brazier", 1)
# Lane lanterns at the four doorways, so a doorway is a lit gap in a dark wall
# rather than something you walk past twice.
for (lx, lz) in ((-5.2, -19.0), (5.2, 11.0), (-5.2, 17.0), (5.2, -10.0), (-18.0, -5.3), (13.0, 5.3)):
    assert place("lantern", lx, lz), f"lane lantern at ({lx},{lz}) was blocked"
    tally("lantern", 1)

# Each room draws from its own vocabulary. Two rooms sharing a model is fine;
# a model appearing in all four is not, because then knowing the room tells you
# nothing about what to become.

# ---- chapel ruin: pews, candles, and what the roof left behind -------------
# Two pew rows either side of the central aisle. Pews are the room's signature —
# a bench anywhere else on the map is conspicuous.
# Placed explicitly rather than scattered: pews in a row is the whole read, and
# the row spacing has to clear the bench radius (0.85) or half of them get
# rejected as overlapping and the nave ends up half empty.
for cz in (10.4, 13.4, 16.4, 19.4):
    for cx in (-19.6, -13.4):
        tally("bench", 1 if place("bench", cx, cz, 0.0) else 0)
tally("candelabra", scatter("candelabra", 1, -27, -8, 9.0, 20.0))
# Fallen masonry along the collapsed west wall.
tally("broken_pillar", scatter("broken_pillar", 2, -28.5, -23.0, 9.0, 22.0))
tally("urn", scatter("urn", 1, -27, -8, 8.5, 22.5))
tally("brazier", scatter("brazier", 1, -27, -8, 8.5, 22.5))
tally("skull", scatter("skull", 1, -28, -8, 8.5, 22.5))
tally("bat", scatter("bat", 1, -28, -8, 8.5, 22.5))

# ---- tomb alley: the stone-carving room ------------------------------------
tally("sarcophagus", scatter("sarcophagus", 2, 6.0, 28.0, 8.5, 23.0))
tally("angel_statue", scatter("angel_statue", 2, 6.0, 28.0, 8.5, 23.0))
tally("gargoyle", scatter("gargoyle", 2, 6.0, 28.0, 8.5, 23.0))
tally("coffin_open", scatter("coffin_open", 2, 6.0, 28.0, 8.5, 23.0))
tally("raven", scatter("raven", 2, 6.0, 28.0, 8.5, 23.0))
tally("grave_cross", row("grave_cross", 6.4, 8.2, 10.0, 2.4, facing=math.pi))
tally("urn", row("urn", 6.4, 8.2, 20.0, 2.4, facing=math.pi))
# Lanterns placed by hand at both alley mouths and the far end. Random scatter
# left the alleys pitch dark on some seeds, and an unlit corridor is not
# atmosphere, it is a room nobody enters.

# ---- family plots: the headstone room --------------------------------------
for (px, pz) in ((-23.0, -18.0), (-11.5, -18.0), (-23.0, -9.0)):
    tally("headstone", row("headstone", px - 2.4, px + 2.4, pz + 1.4, 3.2, facing=0.0))
    tally("headstone", row("headstone", px - 2.4, px + 2.4, pz - 1.2, 3.2, facing=0.0))
# Warrior graves: a sword driven into the earth and a shield left beside it.
tally("grave_sword", scatter("grave_sword", 2, -28, -6, -23, -6))
tally("shield", scatter("shield", 2, -28, -6, -23, -6))
tally("grave_cross", scatter("grave_cross", 2, -28, -6, -23, -6))
# No grave flowers: the flower_pot model's blooms are backyard primary reds and
# yellows, and at night they are the single brightest thing in the quadrant.
# Realistic for a cemetery, wrong for this one.
tally("urn", scatter("urn", 1, -28, -6, -23, -6))
tally("bone_pile", scatter("bone_pile", 1, -28, -6, -23, -6))
tally("skull", scatter("skull", 1, -28, -6, -23, -6))
tally("lantern", scatter("lantern", 2, -28, -6, -23, -6))

# ---- gravedigger's yard: the working end of a cemetery ----------------------
# Was a builder's yard full of crates and tyres, which is the one thing on this
# map that could have been lifted straight out of the warehouse. It is now where
# the digging actually happens.
tally("grave_mound", scatter("grave_mound", 3, 7.0, 28.0, -23.0, -6.5))
tally("bone_pile", scatter("bone_pile", 2, 7.0, 28.0, -23.0, -6.5))
tally("skeleton", scatter("skeleton", 2, 7.0, 28.0, -23.0, -6.5))
tally("coffin", scatter("coffin", 2, 7.0, 28.0, -23.0, -6.5))
tally("cauldron", scatter("cauldron", 2, 7.0, 28.0, -23.0, -6.5))
tally("jack_o_lantern", scatter("jack_o_lantern", 2, 7.0, 28.0, -23.0, -6.5))
tally("skull", scatter("skull", 2, 7.0, 28.0, -23.0, -6.5))
tally("scarecrow", scatter("scarecrow", 2, 7.0, 28.0, -23.0, -6.5))
tally("stone_well", 1 if place("stone_well", 10.5, -8.5) else 0)
tally("brazier", scatter("brazier", 1, 7.0, 28.0, -23.0, -6.5))

# ---- the lanes: sparse on purpose. This is the space you fight in. ---------
# A raven on the obelisk steps and one at each lane end. Nothing else: this is
# the ground you fight over, and a prop standing in it is a hider with nowhere
# to blend in.
tally("raven", scatter("raven", 2, -3.4, 3.4, -20, 20))

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
    if hits_block(p["x"], p["z"], MODELS[p["model"]][0], pad=0.0):
        errs.append(f"prop {p['model']} at ({p['x']},{p['z']}) is inside a block")
for s in BLOCKS:
    if s["h"] <= STEP_HEIGHT:
        errs.append(f"block {s['label']} is walk-through at {s['h']}m")

# Ground surfaces must never overlap another surface drawn at the same depth
# bias. Two flush coplanar quads with equal zOffset flicker between each other
# as the camera moves — the shimmer you see is the depth test tie-breaking
# differently per pixel per frame. Nothing in the renderer can fix that; the
# layout has to not produce it.
for i in range(len(FLOORS)):
    for j in range(i + 1, len(FLOORS)):
        a, b = FLOORS[i], FLOORS[j]
        ox = min(a["cx"] + a["w"] / 2, b["cx"] + b["w"] / 2) - max(a["cx"] - a["w"] / 2, b["cx"] - b["w"] / 2)
        oz = min(a["cz"] + a["d"] / 2, b["cz"] + b["d"] / 2) - max(a["cz"] - a["d"] / 2, b["cz"] - b["d"] / 2)
        if ox > 0.001 and oz > 0.001 and a["zPri"] == b["zPri"]:
            errs.append(
                f"ground surfaces '{a['label']}' and '{b['label']}' overlap by "
                f"{ox:.2f}x{oz:.2f}m at the same depth bias ({a['zPri']}) — they will z-fight"
            )

# Scare anchors have to be inside the map and not buried in a wall, or the sound
# comes from somewhere the player cannot look at.
for (sx, sz, sy) in SCARE_POINTS:
    if not (MIN_X + 1.0 < sx < MAX_X - 1.0 and MIN_Z + 1.0 < sz < MAX_Z - 1.0):
        errs.append(f"scare point ({sx},{sz}) is outside the map")
    if sy < 0.5 or sy > 8.0:
        errs.append(f"scare point ({sx},{sz}) has an implausible height {sy}")

# Every spawn must be standable: clear of blocks by at least the player radius.
PLAYER_R = 0.4
for (sx, sz) in HUNTER_SPAWNS + PROP_SPAWNS:
    if hits_block(sx, sz, PLAYER_R, pad=0.15):
        errs.append(f"spawn ({sx},{sz}) is inside a block")

# Every room must be reachable from the hunters' start. Flood-fill a 0.5m grid,
# so a doorway accidentally walled shut by a later edit fails the build rather
# than the match.
STEP = 0.5
def walkable(x, z):
    return (MIN_X + 1.2 < x < MAX_X - 1.2 and MIN_Z + 1.2 < z < MAX_Z - 1.2
            and not hits_block(x, z, PLAYER_R, pad=0.05))

start = HUNTER_SPAWNS[2]
seen = set()
stack = [(round(start[0] / STEP), round(start[1] / STEP))]
while stack:
    cell = stack.pop()
    if cell in seen:
        continue
    gx, gz = cell
    if not walkable(gx * STEP, gz * STEP):
        continue
    seen.add(cell)
    stack.extend([(gx + 1, gz), (gx - 1, gz), (gx, gz + 1), (gx, gz - 1)])

for (sx, sz) in PROP_SPAWNS:
    if (round(sx / STEP), round(sz / STEP)) not in seen:
        errs.append(f"prop spawn ({sx},{sz}) is walled off from the hunters' start")

near = lambda p: any((round(p["x"] / STEP) + dx, round(p["z"] / STEP) + dz) in seen
                     for dx in range(-3, 4) for dz in range(-3, 4))
sealed = [p for p in PROPS if not near(p)]
if sealed:
    errs.append(f"{len(sealed)} props sit in sealed pockets, e.g. {sealed[0]}")

if errs:
    raise SystemExit("LAYOUT INVALID:\n" + "\n".join(errs))

# --- emit --------------------------------------------------------------------
lines = []
lines.append("/**")
lines.append(" * Hollow Row's solid geometry — generated by tools/gen_cemetery.py.")
lines.append(" *")
lines.append(" * The client builds its meshes from this array and the server derives its")
lines.append(" * occluders from the same entries, so the thing you see and the thing that")
lines.append(" * stops a bullet cannot drift apart. `kind` only selects a material.")
lines.append(" */")
lines.append("export interface CemeteryBlock {")
lines.append("  /** Footprint centre. */")
lines.append("  x: number;")
lines.append("  z: number;")
lines.append("  /** Footprint size on x and z, and height from the ground. */")
lines.append("  w: number;")
lines.append("  d: number;")
lines.append("  h: number;")
lines.append('  kind: "wall" | "pillar" | "altar" | "gable" | "tomb" | "plot" | "shed" | "obelisk" | "tree";')
lines.append("}")
lines.append("")
lines.append("export const CEMETERY_BLOCKS: CemeteryBlock[] = [")
for s in BLOCKS:
    lines.append(f'  {{ x: {s["cx"]}, z: {s["cz"]}, w: {s["w"]}, d: {s["d"]}, h: {s["h"]}, kind: "{s["kind"]}" }}, // {s["label"]}')
lines.append("];")
lines.append("")
lines.append("/** Occluders derived from the blocks above — never hand-written. */")
lines.append("export const CEMETERY_STRUCTURES: Occluder[] = CEMETERY_BLOCKS.map((b) =>")
lines.append("  occ(b.x, b.z, b.w, b.d, b.h),")
lines.append(");")
lines.append("")
lines.append("/**")
lines.append(" * Flush ground surfaces — paving laid at ground level, drawn with a negative")
lines.append(" * depth bias instead of being physically raised (a raised plane slices the")
lines.append(" * bottoms off props standing on it).")
lines.append(" *")
lines.append(" * No two entries here overlap at the same `zPri`. That is enforced by")
lines.append(" * tools/gen_cemetery.py and re-checked in tests/ground-overlap.test.mjs,")
lines.append(" * because two coplanar quads with the same bias flicker against each other")
lines.append(" * as the camera moves and there is nothing the renderer can do about it.")
lines.append(" */")
lines.append("export interface GroundSurface {")
lines.append("  x: number;")
lines.append("  z: number;")
lines.append("  w: number;")
lines.append("  d: number;")
lines.append("  /** Base colour. */")
lines.append("  hex: string;")
lines.append('  kind: "concrete" | "sand" | "grass";')
lines.append("  /** Depth bias. More negative draws in front. */")
lines.append("  zPri: number;")
lines.append("}")
lines.append("")
lines.append("export const CEMETERY_FLOORS: GroundSurface[] = [")
for f in FLOORS:
    lines.append(f'  {{ x: {f["cx"]}, z: {f["cz"]}, w: {f["w"]}, d: {f["d"]}, hex: "{f["hex"]}", kind: "{f["kind"]}", zPri: {f["zPri"]} }}, // {f["label"]}')
lines.append("];")
lines.append("")
lines.append("/** Places a jumpscare may come from — landmarks, not open ground. */")
lines.append("export const CEMETERY_SCARE_POINTS: Array<{ x: number; y: number; z: number }> = [")
for (sx, sz, sy) in SCARE_POINTS:
    lines.append(f"  {{ x: {sx}, y: {sy}, z: {sz} }},")
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
lines.append('  tagline: "Four walled rooms around a crossing. Midnight, and fog.",')
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
lines.append("  scarePoints: CEMETERY_SCARE_POINTS,")
lines.append("};")

# Written next to this script, not to a scratch path: `python3
# tools/gen_cemetery.py` has to work from a fresh clone. Paste the contents into
# packages/shared/src/maps.ts, replacing the block between the "Hollow Row's
# solid geometry" comment and the MAP_ORDER declaration.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cemetery_block.generated.ts")
with open(OUT, "w") as fh:
    fh.write("\n".join(lines) + "\n")

from collections import Counter
print(f"wrote      : {OUT}")
print(f"map        : {WIDTH:.0f} x {DEPTH:.0f} m, diagonal {math.hypot(WIDTH, DEPTH):.1f} m")
print(f"blocks     : {len(BLOCKS)}")
print(f"floors     : {len(FLOORS)} ground surfaces, none overlapping at the same depth bias")
print(f"scare pts  : {len(SCARE_POINTS)}")
print(f"props total: {len(PROPS)}")
print("prop mix   :", ", ".join(f"{k} x{v}" for k, v in Counter(p['model'] for p in PROPS).most_common()))
print(f"walkable   : {len(seen)} cells reachable from the hunters' start; all 8 prop spawns connected")
print("layout verified: no prop/prop or prop/block overlaps, no walk-through blocks, no sealed pockets")
