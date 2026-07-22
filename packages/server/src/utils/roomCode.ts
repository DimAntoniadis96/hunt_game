import { randomInt } from "node:crypto";
import { ROOM_CODE_LENGTH } from "@mimic/shared";

// Excludes easily-confused characters (0/O, 1/I/L) for readable, shareable codes.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Cryptographically-random room code. Uses crypto.randomInt (not Math.random)
 * so codes aren't predictable/guessable.
 */
export function generateRoomCode(length = ROOM_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return code;
}
