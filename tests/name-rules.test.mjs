// Display-name rules. 3–16 characters, matching PSN / Minecraft / Fortnite /
// Riot IDs. The client shows these live; the server re-runs the identical
// function, because a maxlength attribute stops nobody.
import { strict as assert } from "node:assert";
import { MAX_NAME_LENGTH, MIN_NAME_LENGTH, nameError, nameLength, sanitizeName } from "../packages/shared/dist/index.js";

let n = 0;
const ok = (raw, expected, why) => { assert.equal(sanitizeName(raw), expected, why); n++; };
const rejects = (raw, why) => { assert.equal(sanitizeName(raw), "", why); n++; };

assert.equal(MIN_NAME_LENGTH, 3);
assert.equal(MAX_NAME_LENGTH, 16);

// --- accepted ---------------------------------------------------------------
ok("NightCrate", "NightCrate", "a normal name passes through");
ok("abc", "abc", "exactly the minimum is allowed");
ok("ABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOP", "exactly the maximum is allowed");
ok("  spaced  out  ", "spaced out", "trims and collapses inner whitespace");
ok("Γιώργος", "Γιώργος", "non-Latin scripts are fine (Greek)");
ok("Ищейка", "Ищейка", "non-Latin scripts are fine (Cyrillic)");
ok("x_9", "x_9", "punctuation is fine alongside a letter or digit");

// --- length -----------------------------------------------------------------
rejects("ab", "under the minimum is rejected");
rejects("", "empty is rejected");
rejects("   ", "whitespace-only is rejected");
assert.equal(sanitizeName("ThisNameIsFarTooLongToFit"), "ThisNameIsFarToo", "over-length is capped, not rejected");
assert.equal(nameLength(sanitizeName("ThisNameIsFarTooLongToFit")), MAX_NAME_LENGTH, "capped to exactly the max");
n += 2;

// --- abuse ------------------------------------------------------------------
rejects("​​​​", "zero-width characters cannot fake a name");
rejects("...", "punctuation-only is rejected");
rejects("___", "underscores-only is rejected");
ok("a​bc", "abc", "zero-width padding is stripped before measuring");
ok("badname", "badname", "control characters are stripped");
rejects(null, "non-strings are rejected");
rejects(42, "non-strings are rejected");
rejects(undefined, "non-strings are rejected");

// --- unicode correctness ----------------------------------------------------
// String.slice works on UTF-16 units, so a naive cap can bisect an emoji and
// leave a broken glyph. Counting by code point avoids that.
{
  const emoji = "🎮".repeat(20);           // 20 code points, 40 UTF-16 units
  const out = sanitizeName(emoji);
  assert.equal(out, "", "an emoji-only name has no letter or digit, so it is rejected");
  const mixed = "Hunter" + "🎮".repeat(20);
  const capped = sanitizeName(mixed);
  assert.equal(nameLength(capped), MAX_NAME_LENGTH, "counted by code point, not UTF-16 unit");
  assert.ok(!capped.includes("�"), "never leaves a replacement character");
  // A valid emoji IS a surrogate pair, so only *unpaired* halves are a bug:
  // a high surrogate not followed by a low one, or a low one not preceded by a high.
  const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  assert.ok(!loneSurrogate.test(capped), "never leaves a lone surrogate half");
  n += 4;
}

// --- nameError messages are usable in the UI --------------------------------
assert.equal(nameError("NightCrate"), null, "a valid name has no error");
assert.match(nameError("ab"), /at least 3/, "too-short error names the minimum");
assert.match(nameError(""), /Enter a display name/, "empty error prompts for a name");
assert.match(nameError("..."), /letter or number/, "explains why punctuation-only fails");
n += 4;

// --- idempotence: sanitising a sanitised name changes nothing ---------------
for (const raw of ["NightCrate", "  spaced  out  ", "Hunter🎮🎮🎮🎮🎮🎮🎮🎮🎮🎮🎮🎮🎮🎮🎮"]) {
  const once = sanitizeName(raw);
  if (once) { assert.equal(sanitizeName(once), once, `sanitize is idempotent for ${JSON.stringify(raw)}`); n++; }
}

console.log(`name-rules: ${n} assertions passed (limit ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH})`);
