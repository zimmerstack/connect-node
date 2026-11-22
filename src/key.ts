/**
 * What a ZimmerStack key looks like, checked without sending it anywhere.
 *
 * A key made since 22 Nov 2026 is `zsk_live_` (or `zsk_test_` on a sandbox), 40 letters and digits, then
 * 6 characters that are a checksum of everything before them (CRC32, written in base 62). So a key that
 * was mistyped or cut short can be told from a real one offline, before any request. A key made before
 * that day is the prefix and 43 characters with no checksum; it keeps working until it is rotated.
 *
 * The checksum is not a secret and proves nothing about who holds the key. It says only "this was made
 * by ZimmerStack and not mistyped". Nothing here ever returns or prints the key itself.
 */

const LEGACY = /^zsk_(live|test)_[A-Za-z0-9_-]{43}$/;
const CHECKSUMMED = /^zsk_(live|test)_[A-Za-z0-9]{46}$/;
const PREFIX = /^zsk_(live|test)_/;
const CHECKSUM_CHARS = 6;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

let table: number[] | undefined;

/** CRC32 (IEEE, the zlib one) of a string's bytes. A key is plain ASCII, so a character is a byte. */
function crc32(text: string): number {
  table ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (let i = 0; i < text.length; i++) crc = table[(crc ^ text.charCodeAt(i)) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The six characters a key ends in: the CRC32 of what comes before them, in base 62, zero-padded. */
export function keyChecksum(head: string): string {
  let n = crc32(head);
  let out = "";
  while (n > 0) {
    out = BASE62[n % 62]! + out;
    n = Math.floor(n / 62);
  }
  return out.padStart(CHECKSUM_CHARS, "0");
}

/** What `checkKey` found. `message` is for a person and never contains the key. */
export type KeyCheck =
  | {
      ok: true;
      /** "test": a sandbox key, nothing it sends reaches a booking site. "live": a real hotel. */
      mode: "live" | "test";
      /** "checksummed": made since 22 Nov 2026. "legacy": made before, no checksum; it works until it is rotated. */
      format: "checksummed" | "legacy";
      message: string;
    }
  | {
      ok: false;
      mode: "live" | "test" | null;
      /** empty · not-a-key (no zsk_ prefix) · wrong-length (cut short, or something extra around it) · bad-checksum (a character changed) */
      problem: "empty" | "not-a-key" | "wrong-length" | "bad-checksum";
      message: string;
    };

/**
 * Is this string a ZimmerStack key? Checked here, with no request: the key is sent nowhere.
 *
 * Use it where a person pastes a key (a settings screen, a deploy script), so a slip is caught at once
 * and never spends a failed sign-in. It cannot say whether the key is still valid: only a request can.
 *
 * @example
 * const check = checkKey(process.env.ZIMMERSTACK_CONNECT_KEY);
 * if (!check.ok) throw new Error(check.message);
 */
export function checkKey(key: unknown): KeyCheck {
  const value = typeof key === "string" ? key.trim() : "";
  if (!value) return { ok: false, mode: null, problem: "empty", message: "No key was given. A ZimmerStack key starts with zsk_test_ (a sandbox) or zsk_live_." };
  const prefix = PREFIX.exec(value);
  if (!prefix) {
    return { ok: false, mode: null, problem: "not-a-key", message: "This is not a ZimmerStack key: one starts with zsk_test_ (a sandbox) or zsk_live_ (a real hotel)." };
  }
  const mode = prefix[1] as "live" | "test";
  const what = mode === "test" ? "a sandbox key (zsk_test_)" : "a live key (zsk_live_)";
  if (CHECKSUMMED.test(value)) {
    if (keyChecksum(value.slice(0, -CHECKSUM_CHARS)) === value.slice(-CHECKSUM_CHARS)) return { ok: true, mode, format: "checksummed", message: `This is ${what}, and its checksum holds.` };
    return {
      ok: false,
      mode,
      problem: "bad-checksum",
      message: "The key's last six characters are a checksum of the rest, and they do not match: a character was mistyped or changed. Copy the whole key again from where it was shown.",
    };
  }
  if (LEGACY.test(value)) {
    return { ok: true, mode, format: "legacy", message: `This is ${what} in the format used before 22 Nov 2026. It keeps working; rotating it gives you a key whose typing slips are caught before they are sent.` };
  }
  const length = value.length - prefix[0].length;
  return {
    ok: false,
    mode,
    problem: "wrong-length",
    message: `This starts like a ZimmerStack key but is not one: after the prefix a key has 46 letters and digits (43 characters on a key made before 22 Nov 2026), and this one has ${length}${
      /[^A-Za-z0-9_-]/.test(value.slice(prefix[0].length)) ? ", with a character a key never contains" : ""
    }. It was cut short, or something was copied with it (a quote, a space, a line break).`,
  };
}
