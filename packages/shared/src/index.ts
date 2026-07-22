/**
 * @mimic/shared — the single source of truth shared by the client and the
 * authoritative server. It contains NO runtime dependencies (no Colyseus, no
 * Babylon) so both sides can import it freely.
 *
 * The server owns the actual Colyseus @schema classes; the interfaces here only
 * *describe* the shape of the synchronized state so the client gets type-safety
 * when reading it. Enums and constants are genuine shared runtime values.
 */
export * from "./constants.js";
export * from "./types.js";
export * from "./maps.js";
