import { ZimmerStackError, ZimmerStackUsageError } from "./errors.ts";
import {
  API_ORIGIN,
  API_PREFIX,
  IDEMPOTENCY_HEADER,
  OPERATIONS,
  PROPERTY_HEADER,
  SDK_VERSION,
  type AvailabilityWrite,
  type BatchStatus,
  type Billing,
  type BillingInvoices,
  type BillingNextInvoice,
  type Booking,
  type BookingCancel,
  type BookingCreate,
  type Catalog,
  type CatalogDeleteResult,
  type CatalogUpsertResult,
  type ChannelBooking,
  type CloseResult,
  type CloseRoomType,
  type ConnectLink,
  type ConnectLinkCreate,
  type ConnectLinkCreated,
  type ConnectLinkList,
  type DirectBookingCancel,
  type DirectBookingCancelResult,
  type EventsList,
  type Explain,
  type FullSyncResult,
  type GoLiveResult,
  type HotelKey,
  type HotelKeyCreate,
  type HotelKeyCreated,
  type HotelKeyList,
  type HotelKeyRevoke,
  type HotelKeyRotated,
  type Limits,
  type LoggedEvent,
  type ModifierResult,
  type OperationKey,
  type Operations,
  type PropertyChange,
  type PropertyChanged,
  type PropertyCreate,
  type PropertyCreated,
  type PropertyFullSyncResult,
  type PropertyRemoved,
  type RatePlansUpsert,
  type RatesResendAccepted,
  type RatesWrite,
  type Readiness,
  type ReopenRoomType,
  type RequestLog,
  type RestrictionsWrite,
  type RoomTypesUpsert,
  type SandboxBooking,
  type SandboxBookingCreate,
  type SandboxBookingModify,
  type SandboxFault,
  type SandboxFaultView,
  type SandboxNoShow,
  type SandboxSyncEvent,
  type SandboxSyncEventView,
  type Status,
  type SupportTicket,
  type SupportTicketCreate,
  type SupportTicketList,
  type WebhookDelivery,
  type WebhookDeliveryDetail,
  type WebhookDeliveryList,
  type WebhookEndpoint,
  type WebhookEndpointCreate,
  type WebhookEndpointCreated,
  type WebhookEndpointDeleted,
  type WebhookEndpointList,
  type WebhookEndpointResumed,
  type WebhookEndpointUpdate,
  type WebhookRecoverResult,
  type WebhookSecretRotated,
  type WebhookTest,
  type WebhookTestQueued,
  type WriteAccepted,
  type WritePreview,
} from "./generated.ts";
import { checkKey } from "./key.ts";
import { buildGrid, cellsOf, chunk, toRanges, type Grid, type GridEdits, type ModifierStep } from "./grid.ts";

/* ───────────────────────────── options ───────────────────────────── */

export interface ZimmerStackOptions {
  /**
   * `zsk_test_…` (a sandbox: nothing reaches a channel) or `zsk_live_…`. Defaults to the environment
   * variable `ZIMMERSTACK_CONNECT_KEY`, which is where it should live: never in code, a log or a browser.
   */
  apiKey?: string;
  /** A software vendor's company key only: the hotel every call acts on. See also `forProperty`. */
  propertyId?: number;
  /** Only for a local stand-in of the API while testing (http://localhost:…). The key is sent to no other host. */
  baseUrl?: string;
  /** A replacement for the global `fetch`, for tests. */
  fetch?: typeof fetch;
  /** How long one attempt may take. Default 30 s. Adding a hotel and removing one are given at least 95 s. */
  timeoutMs?: number;
  /** How many times a request that may pass later is sent again. Default 3 (four attempts in all), at most 5. */
  maxRetries?: number;
  /**
   * The longest the client holds a call open for a budget before giving the refusal back to you. Default
   * 120 s: a minute's budget is waited out, an hour's or a day's comes back as a retryable error that says
   * when it frees (`retryAfterSeconds`, `freesAt`). Raise it (3600 for a nightly job) and the client holds
   * the call across the longer budget and tells `onEvent` when it lands. Any call can set its own.
   */
  maxWaitSeconds?: number;
  /**
   * A live key under a test runner (NODE_ENV=test, Vitest, Jest, node --test) may read but not write,
   * because a test that loops would change a real hotel. Set true only for a test that is meant to.
   */
  allowLiveWritesInTests?: boolean;
  /** What the client is doing, for your logs: every answer, every wait, every retry. Never carries the key. */
  onEvent?: (event: ClientEvent) => void;
}

export type ClientEvent =
  | { type: "response"; operation: string; status: number; attempt: number; ms: number }
  | { type: "retry"; operation: string; attempt: number; waitMs: number; reason: string }
  /** The client is waiting for a budget the last answers reported, before it sends. `scope` names the budget. */
  | { type: "pace"; operation: string; waitMs: number; scope?: string }
  /** A wait of more than a minute that the client is holding the call for. `message` reads "PUT /rates lands in about 25 minutes (…)". */
  | { type: "wait"; operation: string; scope: string | undefined; waitMs: number; landsAt: string; message: string }
  /** A budget frees too late to hold the call for: it comes back to you as a retryable error. `freesAt` is when to send it again. */
  | { type: "deferred"; operation: string; scope: string | undefined; retryAfterSeconds: number; freesAt: string; message: string };

/** Per-call options of a write. */
export interface WriteOptions {
  /**
   * Your own key for this write (10 to 64 of A–Z a–z 0–9 _ -), when a retry may come from another
   * process: the same key with the same body within 7 days replays the first answer instead of
   * writing twice. Without one the client makes a fresh key and reuses it on its own retries.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** The longest this call is held open for a budget, in seconds; the client's `maxWaitSeconds` when left out. */
  maxWaitSeconds?: number;
  /**
   * A company key sending to a hotel that is NOT LIVE yet (`zs.readiness.get()` says `live: false`): true
   * sends the header `X-ZS-Before-Go-Live: true`, which says you know. Prices and stay rules are then
   * stored and wait for `zs.readiness.goLive()` (the answer says `heldUntilGoLive: true`).
   *
   * ROOM COUNTS ARE DIFFERENT. Until the hotel is live a room count may only LOWER what is on sale: a
   * count at or below what is on sale is sent to the booking sites AT ONCE (a held count would oversell
   * a room), and a count that RAISES it is refused, in the answer's `rejected` list (422
   * NOTHING_ACCEPTED when nothing else in the request landed), because the hotel's own people may still
   * be running its counts. So send your room counts again right after going live.
   *
   * Without the option such a hotel answers 409 ARI_NOT_AUTHORITATIVE. On a live hotel it changes nothing.
   */
  beforeGoLive?: boolean;
}

export interface ReadOptions {
  signal?: AbortSignal;
  /** The longest this call is held open for a budget, in seconds; the client's `maxWaitSeconds` when left out. */
  maxWaitSeconds?: number;
  /** A company key reading the calendar of a hotel that is not live yet: see `WriteOptions.beforeGoLive`. */
  beforeGoLive?: boolean;
}

/** The header a company key sends with what it writes ahead of go-live (`beforeGoLive: true` on a call). */
export const BEFORE_GO_LIVE_HEADER = "x-zs-before-go-live";

/** What `zs.availability.close` and `.closeDryRun` take: one room type, a range of nights, optionally only some weekdays. */
export type CloseRequest = Omit<CloseRoomType, "dryRun">;
/** What `zs.availability.reopen` and `.reopenDryRun` take: the same, and optionally the count to put on sale. */
export type ReopenRequest = Omit<ReopenRoomType, "dryRun">;
/** A close or a reopen that was DONE: `batches` names the writes to watch land. */
export type CloseDone = CloseResult & { dryRun: false };
/** What a close or a reopen WOULD do. Nothing was written: `batches` is empty. */
export type ClosePreview = CloseResult & { dryRun: true };

/**
 * The body of a real close or reopen. A caller without types may have put `dryRun` in it, meaning "do not
 * do it": that is refused here, never silently done for real.
 */
function realOnly<T extends object>(method: "close" | "reopen", body: T): T {
  if (body !== null && typeof body === "object" && "dryRun" in body) {
    throw new ZimmerStackUsageError(`zs.availability.${method} does it for real and takes no dryRun. To see what it would do, call zs.availability.${method}DryRun with the same room type and nights. Nothing was sent.`);
  }
  return body;
}

/** A dry run that came back as anything but a preview is never passed on as one. */
function previewOnly<T extends { dryRun?: unknown }>(operation: string, answer: T): T {
  if (answer?.dryRun === true) return answer;
  throw new Error(`${operation} was sent as a dry run and the answer is not a preview. Treat it as a real write: read zs.sync.get() and the calendar before you send anything else.`);
}

/**
 * What `zs.limits.get()` answers (GET /limits): every budget this key sits under, with what is left of it
 * right now. The contract's own shape (`Limits`); the name is kept from 0.8.0, when it was written by hand.
 */
export type LimitsNow = Limits;
/** One budget of `zs.limits.get()`: a row of the API's limits table with what is left of it right now. */
export type LimitNow = Limits["budgets"][number];

/** One room type, as `zs.roomTypes.save` takes it. */
export type RoomTypeInput = RoomTypesUpsert["roomTypes"][number];
/** One rate plan, as `zs.ratePlans.save` takes it. */
export type RatePlanInput = RatePlansUpsert["ratePlans"][number];
/**
 * What saving one room type or one rate plan answers: its ZimmerStack `id`, what was done (`action`),
 * how far it has travelled (`sync`), anything to know (`notice`), and where the hotel stands on its
 * channels after the save (`channelManager`).
 */
export type StructureSaved = CatalogUpsertResult["items"][number] & { channelManager: CatalogUpsertResult["channelManager"] };

/** One entity was sent, so the answer names exactly one. */
function savedOne(result: CatalogUpsertResult): StructureSaved {
  const item = result.items[0];
  if (!item) throw new Error("ZimmerStack's answer named no entity for this save. Read zs.catalog.get() to see what the hotel holds before sending it again.");
  return { ...item, channelManager: result.channelManager };
}

/**
 * The last part of a delete's address on /catalog: ZimmerStack's id as it is, or `ref:` and your own
 * ref (DELETE /catalog/room-types/ref:deluxe). What a ref names, and whether the text can be a ref at
 * all, is the API's to say: it answers its 404 for either.
 */
function deleteTarget(what: "room type" | "rate plan", idOrRef: number | { ref: string }): string | number {
  if (typeof idOrRef !== "object" || idOrRef === null) return idOrRef;
  if (typeof idOrRef.ref !== "string" || idOrRef.ref.trim() === "") {
    throw new ZimmerStackUsageError(`To delete a ${what} by your own ref, pass { ref } with the ref you gave it (a string). Or pass ZimmerStack's id (a number).`);
  }
  return `ref:${idOrRef.ref}`;
}

type Op<K extends OperationKey> = Operations[K];
/** What `request` takes for an operation: its path values, its query, its body. */
export type RequestArgs<K extends OperationKey> = (Op<K>["path"] extends undefined ? { path?: undefined } : { path: Op<K>["path"] }) &
  (Op<K>["query"] extends undefined ? { query?: undefined } : { query?: Op<K>["query"] }) &
  (Op<K>["body"] extends undefined ? { body?: undefined } : { body: Op<K>["body"] }) &
  WriteOptions;

/* ───────────────────────────── the shared core ───────────────────────────── */

/** Requests in flight at once. Writes go one at a time per hotel on top of that. */
const PARALLEL = 4;
const KEY_SHAPE = /^zsk_(live|test)_[A-Za-z0-9_-]{16,}$/;
const IDEMPOTENCY_SHAPE = /^[A-Za-z0-9_-]{10,64}$/;
/** After one of these the key will never work again: every later call is refused here, not sent. */
const KEY_IS_DEAD = new Set(["API_KEY_INVALID", "API_KEY_REVOKED", "API_KEY_EXPIRED"]);
const CATALOG_TTL_MS = 10 * 60_000;

/**
 * Writes whose route keeps an idempotency key on the server although the contract copy this package was
 * generated from did not say so yet (the API booking's cancel, the sandbox booking's cancel and modify).
 * The client sends a key for them, so a cancel whose answer was lost can be sent again and never lands
 * twice. Once the generated table (`OPERATIONS`) says the same, this list changes nothing.
 */
export const KEYED_WRITES: ReadonlySet<string> = new Set(["POST /bookings/{bookingId}/cancel", "POST /sandbox/bookings/{bookingId}/cancel", "POST /sandbox/bookings/{bookingId}/modify"]);

/** Routes about the partner's own company: they read no X-ZS-Property, so the client sends none. */
const COMPANY_ROUTES = ["/webhook-endpoints", "/connect-links", "/billing", "/support-tickets"] as const;

/** The three writes that name cells: the `cells` budget counts every night of every row they carry. */
const CELL_WRITES: ReadonlySet<string> = new Set(["PUT /availability", "PUT /rates", "PUT /restrictions"]);

/**
 * Whose budget a name in the `RateLimit` headers is.
 *
 * Under a company key every hotel runs under its own key and property budgets, so those belong to that
 * hotel alone: when one hotel's budget is nearly out, only that hotel's calls wait. What every hotel of the
 * client shares waits for everyone: the company's budget, everyone's ceiling and the address's budgets.
 */
const SHARED_BUDGETS: ReadonlySet<string> = new Set(["company", "global", "ip", "ip-auth", "key-auth", "global-unauthenticated", "api-address"]);
/** Budgets that count every request, and the two that count every write. Any other budget is its own operation's. */
const EVERY_REQUEST: ReadonlySet<string> = new Set(["key", "property", ...SHARED_BUDGETS]);
const EVERY_WRITE: ReadonlySet<string> = new Set(["key-writes", "property-writes"]);
/** What a refusal's `data.scope` is called in the headers: only the key's own two differ. */
const HEADER_OF_SCOPE: Readonly<Record<string, string>> = { requests: "key", writes: "key-writes" };
/**
 * A budget that is one CHANNEL's own, on an operation whose address names the channel: one full sync an hour
 * for each channel. A refusal for one channel says nothing about the hotel's other channels, and the client
 * remembers a refusal by its operation, not by its address. So it is never remembered: the next call is sent.
 */
const PER_CHANNEL_BUDGETS = ["full-sync-hour"] as const;
/**
 * The channel shield's budgets over an hour and a day, and its pause. A write that only CLOSES inventory is
 * still accepted while they are used up (the safety lane), and only the server can tell which write that
 * is. So the client never holds a write back for one of these: it sends, and reports what the API answers.
 * The per-channel budgets above are never held back either, for their own reason.
 */
const NEVER_HELD_BACK: ReadonlySet<string> = new Set(["cells-hour", "cells-day", "vendor-cells-day", "shield-pause", "shield-lane", ...PER_CHANNEL_BUDGETS]);
/** A wait this long or shorter is the pace of a minute's budget: always waited out, whatever `maxWaitSeconds` says. */
const SHORT_WAIT_MS = 65_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function env(name: string): string | undefined {
  return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
}

function underTestRunner(): boolean {
  return env("NODE_ENV") === "test" || Boolean(env("VITEST") || env("JEST_WORKER_ID") || env("NODE_TEST_CONTEXT"));
}

function resolveBase(baseUrl: string | undefined): string {
  if (!baseUrl) return API_ORIGIN;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ZimmerStackUsageError("baseUrl is not a URL");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.origin !== API_ORIGIN && !local) {
    throw new ZimmerStackUsageError(`baseUrl may only be ${API_ORIGIN} or a local stand-in (http://localhost:…): the key is sent to no other host`);
  }
  return url.origin;
}

/** "about 40 seconds", "about 2 minutes", "about 3 hours": how long a wait is, for a person. */
export function aboutHowLong(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) return `about ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/** One budget of an answer's headers: `"key";q=120;w=60` and `"key";r=117;t=42` read together. */
export interface BudgetSeen {
  name: string;
  /** The quota, when the policy header named it. */
  quota: number | undefined;
  /** The window in seconds; a minute when the policy header did not say. */
  windowSeconds: number;
  remaining: number;
  /** Seconds until the budget has room again. */
  resetSeconds: number;
}

/** Read `RateLimit-Policy` and `RateLimit` into one list. Unknown names are kept: a new budget is paced like any other. */
export function readBudgets(policy: string | null, state: string | null): BudgetSeen[] {
  const quotas = new Map<string, { quota: number | undefined; windowSeconds: number }>();
  for (const part of (policy ?? "").split(",")) {
    const name = /"([^"]+)"/.exec(part)?.[1];
    if (!name) continue;
    const q = /;\s*q=(\d+)/.exec(part);
    const w = /;\s*w=(\d+)/.exec(part);
    quotas.set(name, { quota: q ? Number(q[1]) : undefined, windowSeconds: w ? Number(w[1]) : 60 });
  }
  const out: BudgetSeen[] = [];
  for (const part of (state ?? "").split(",")) {
    const name = /"([^"]+)"/.exec(part)?.[1];
    const left = /;\s*r=(\d+)/.exec(part);
    const refill = /;\s*t=(\d+)/.exec(part);
    if (!name || !left || !refill) continue;
    const known = quotas.get(name);
    out.push({ name, quota: known?.quota, windowSeconds: known?.windowSeconds ?? 60, remaining: Number(left[1]), resetSeconds: Number(refill[1]) });
  }
  return out;
}

interface Wire {
  operation: string;
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string | undefined;
  write: boolean;
  /** May it be sent again after a failure whose outcome is unknown (a network error, a 5xx)? */
  resendable: boolean;
  /** The hotel the call acts on (a company key's X-ZS-Property), or "" when it names none: its own queue and its own pace. */
  hotel: string;
  /** How many cells a write to availability, rates or restrictions names; 0 for anything else. */
  cells: number;
  /** The longest this call waits for a budget, in seconds; the client's `maxWaitSeconds` when left out. */
  maxWaitSeconds: number | undefined;
  /** The least one attempt is given, for an operation that does a long thing while you wait. */
  patienceMs?: number;
  signal: AbortSignal | undefined;
}

/**
 * Operations that do a long thing while you wait: adding a hotel creates its account, and removing one takes
 * it off its booking sites one step at a time. One attempt of these is given at least this long, however
 * short `timeoutMs` is, because giving up early leaves you not knowing whether a hotel was added or removed.
 * (The API's own edge answers within 100 s.)
 */
const PATIENCE_MS: Partial<Record<OperationKey, number>> = {
  "POST /properties": 95_000,
  "DELETE /properties/{propertyId}": 95_000,
};

/** How long one attempt of an operation may take: the client's `timeoutMs`, or longer for the slow ones above. */
export function attemptTimeoutMs(operation: string, timeoutMs: number): number {
  return Math.max(timeoutMs, PATIENCE_MS[operation as OperationKey] ?? 0);
}

/** Until when something waits, for which budget, and when the client learned it. */
interface Hold {
  until: number;
  budget: string;
  learnedAt: number;
}

/**
 * A wait too long to hold a call open for (a day's budget that is used up) is trusted this long after it
 * was learned: calls it holds are not sent, and come back saying when the budget frees. After that one call
 * goes out again, so a budget that was raised or freed early is noticed.
 */
const LONG_HOLD_TRUST_MS = 5 * 60_000;

/**
 * The pace of one hotel, or of what every hotel of the client shares. A hold says "nothing of this kind
 * before `until`": on every request, on every write, or on one operation.
 */
class Pace {
  all: Hold | undefined;
  writes: Hold | undefined;
  readonly operations = new Map<string, Hold>();
  /** The cells budget as last seen, less what this client has sent since: a write of more cells than are left waits for the window. */
  cells: { remaining: number; until: number } | undefined;
  /** Writes of this hotel go one after another. */
  writeTail: Promise<unknown> = Promise.resolve();

  hold(kind: "all" | "writes" | string, hold: Hold): void {
    // Fresh news of the same budget replaces what was known; between two budgets the later one decides.
    const pick = (current: Hold | undefined) => (!current || current.budget === hold.budget || hold.until >= current.until ? hold : current);
    if (kind === "all") this.all = pick(this.all);
    else if (kind === "writes") this.writes = pick(this.writes);
    else this.operations.set(kind, pick(this.operations.get(kind)));
  }

  /** The latest hold that applies to this call. */
  holdFor(wire: Wire, now: number): Hold | undefined {
    let latest: Hold | undefined;
    const consider = (h: Hold | undefined) => {
      if (h && h.until > now && (!latest || h.until > latest.until)) latest = h;
    };
    consider(this.all);
    if (wire.write) consider(this.writes);
    consider(this.operations.get(wire.operation));
    if (wire.cells > 0 && this.cells && this.cells.until > now && wire.cells > this.cells.remaining) consider({ until: this.cells.until, budget: "cells", learnedAt: now });
    return latest;
  }
}

class Core {
  readonly #key: string;
  readonly mode: "live" | "test";
  readonly base: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #maxWaitSeconds: number;
  readonly #allowLiveWritesInTests: boolean;
  readonly #onEvent: ((event: ClientEvent) => void) | undefined;

  /** What every hotel of this client shares: the company's budget, everyone's ceiling, the address. */
  readonly #shared = new Pace();
  /** One pace and one queue of writes per hotel, so one hotel's budget never holds up another's calls. */
  readonly #hotels = new Map<string, Pace>();
  #active = 0;
  readonly #queue: Array<() => void> = [];
  #dead: ZimmerStackError | undefined;
  readonly catalogs = new Map<number, { at: number; value: Catalog }>();
  /** A sandbox company key's one hotel, found once when a call asked for a hotel and none was named. */
  soleSandboxProperty: Promise<number | undefined> | undefined;
  /** The same, once known: sent with every later call that names no hotel, so the refusal is met once. */
  soleSandboxId: number | undefined;
  /** What the key's own checksum says is wrong with it, when something is (never the key). */
  readonly keyHint: string | undefined;

  constructor(options: ZimmerStackOptions) {
    const g = globalThis as { window?: { document?: unknown }; navigator?: { product?: string } };
    if ((typeof g.window !== "undefined" && typeof g.window.document !== "undefined") || g.navigator?.product === "ReactNative") {
      throw new ZimmerStackUsageError(
        "@zimmerstack/connect runs on a server only. A key in a browser or a mobile app can be read by anyone and can change a hotel's prices on every channel: call your own server from here, and ZimmerStack from your server (https://docs.zimmerstack.com/guides/node-package#no-server shows the smallest one). If a key was built into this page, anyone can read it now: revoke it and make a new one."
      );
    }
    const key = options.apiKey ?? env("ZIMMERSTACK_CONNECT_KEY");
    if (!key) throw new ZimmerStackUsageError("No API key: set the environment variable ZIMMERSTACK_CONNECT_KEY (zsk_test_… while you build) on your server");
    const shape = KEY_SHAPE.exec(key.trim());
    if (!shape) throw new ZimmerStackUsageError("The API key does not look like a ZimmerStack key (zsk_test_… or zsk_live_…). It was not sent anywhere.");
    this.#key = key.trim();
    // Checked offline, by the key's own checksum (src/key.ts): kept for the day the API refuses the key, so
    // the refusal can say "it was mistyped" instead of leaving the person to guess. Never the key itself.
    const check = checkKey(this.#key);
    this.keyHint = check.ok ? undefined : check.message;
    this.mode = shape[1] as "live" | "test";
    this.base = resolveBase(options.baseUrl);
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") throw new ZimmerStackUsageError("No fetch in this runtime: @zimmerstack/connect needs Node 20 or newer");
    this.#fetch = f;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#maxRetries = Math.min(5, Math.max(0, Math.trunc(options.maxRetries ?? 3)));
    this.#maxWaitSeconds = options.maxWaitSeconds ?? 120;
    this.#allowLiveWritesInTests = options.allowLiveWritesInTests === true;
    this.#onEvent = options.onEvent;
  }

  authorization(): string {
    return "Bearer " + this.#key;
  }

  #emit(event: ClientEvent): void {
    try {
      this.#onEvent?.(event);
    } catch {
      /* a logger must never break a request */
    }
  }

  #hotel(id: string): Pace {
    let pace = this.#hotels.get(id);
    if (!pace) {
      pace = new Pace();
      this.#hotels.set(id, pace);
    }
    return pace;
  }

  send(wire: Wire): Promise<unknown> {
    if (this.#dead) {
      const d = this.#dead;
      return Promise.reject(
        new ZimmerStackError({
          status: d.status,
          code: d.code,
          message: `${d.message} (this key was refused earlier, so ${wire.operation} was not sent; start again with a working key)`,
          operation: wire.operation,
          retryable: false,
        })
      );
    }
    if (wire.write && this.mode === "live" && !this.#allowLiveWritesInTests && underTestRunner()) {
      return Promise.reject(
        new ZimmerStackError({
          status: 0,
          code: "LIVE_KEY_IN_TEST",
          message: `${wire.operation} was not sent: this is a live key (zsk_live_) under a test runner, and a test must not change a real hotel. Use a zsk_test_ sandbox key or a fake fetch.`,
          operation: wire.operation,
          retryable: false,
        })
      );
    }
    if (!wire.write) return this.#attempts(wire);
    // Writes to one hotel go one after another: a burst spends its write budget at once, and two writes to
    // one night must reach the record in the order they were made. Another hotel's writes do not wait for these.
    const hotel = this.#hotel(wire.hotel);
    const run = () => this.#attempts(wire);
    const result = hotel.writeTail.then(run, run);
    hotel.writeTail = result.catch(() => undefined);
    return result;
  }

  #slot(): Promise<() => void> {
    const take = () => {
      this.#active++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.#active--;
        this.#queue.shift()?.();
      };
    };
    if (this.#active < PARALLEL) return Promise.resolve(take());
    return new Promise((resolve) => this.#queue.push(() => resolve(take())));
  }

  #maxWaitMs(wire: Wire): number {
    return Math.max(0, wire.maxWaitSeconds ?? this.#maxWaitSeconds) * 1000;
  }

  /** What a call that will not be held open comes back as: the API's own refusal shape, saying when the budget frees. */
  #notNow(wire: Wire, budget: string, waitMs: number, sent: boolean): ZimmerStackError {
    const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));
    const message = `${wire.operation} ${sent ? "was refused" : "was not sent"}: the ${budget} budget is used up and has room again in ${aboutHowLong(waitMs)}. Send it again then.`;
    this.#emit({ type: "deferred", operation: wire.operation, scope: budget, retryAfterSeconds, freesAt: new Date(Date.now() + waitMs).toISOString(), message });
    return new ZimmerStackError({ status: 429, code: "RATE_LIMITED", message, operation: wire.operation, scope: budget, retryAfterSeconds, retryable: true });
  }

  /**
   * Wait until every budget the last answers reported has room again, instead of earning a 429: the hotel's
   * own budgets and what every hotel shares. The pace of a minute's budget is always waited out. A longer
   * wait (a day's budget that is used up) is waited out only inside `maxWaitSeconds`; past that the call is
   * not sent and comes back as a retryable RATE_LIMITED that says when the budget frees.
   */
  async #pace(wire: Wire): Promise<void> {
    for (;;) {
      const now = Date.now();
      const own = this.#hotel(wire.hotel).holdFor(wire, now);
      const shared = this.#shared.holdFor(wire, now);
      const hold = own && shared ? (own.until >= shared.until ? own : shared) : (own ?? shared);
      if (!hold) return;
      const wait = hold.until - now;
      if (wait > SHORT_WAIT_MS && wait > this.#maxWaitMs(wire)) {
        // Too long to hold the call open. While the news is fresh the call is not sent; once it is older,
        // this one goes out to learn whether the budget is still used up.
        if (now - hold.learnedAt < LONG_HOLD_TRUST_MS) throw this.#notNow(wire, hold.budget, wait, false);
        hold.until = 0;
        continue;
      }
      this.#emit({ type: "pace", operation: wire.operation, waitMs: wait, scope: hold.budget });
      if (wait > SHORT_WAIT_MS) this.#lands(wire, hold.budget, wait);
      await sleep(wait, wire.signal);
    }
  }

  /** A wait worth telling a person about: the call is held and lands when the budget frees. */
  #lands(wire: Wire, budget: string | undefined, waitMs: number): void {
    this.#emit({
      type: "wait",
      operation: wire.operation,
      scope: budget,
      waitMs,
      landsAt: new Date(Date.now() + waitMs).toISOString(),
      message: `${wire.operation} lands in ${aboutHowLong(waitMs)}${budget ? ` (waiting for the ${budget} budget)` : ""}.`,
    });
  }

  /** Whose pace a budget moves: what every hotel shares, or this call's hotel alone. */
  #paceOf(budget: string, wire: Wire): Pace {
    return SHARED_BUDGETS.has(budget) ? this.#shared : this.#hotel(wire.hotel);
  }

  /** Which calls a budget holds: every request, every write, or the one operation it was reported on. */
  #holds(budget: string, wire: Wire): "all" | "writes" | string {
    return EVERY_REQUEST.has(budget) ? "all" : EVERY_WRITE.has(budget) ? "writes" : wire.operation;
  }

  /**
   * Read every budget of the answer's headers.
   *   RateLimit-Policy: "key";q=120;w=60, "key-writes";q=30;w=60, "property";q=300;w=60, "cells";q=20000;w=60
   *   RateLimit:        "key";r=117;t=42, "key-writes";r=29;t=42, "property";r=296;t=42, "cells";r=20000;t=0
   * A minute's budget that is nearly out holds the calls it counts until it refills. A budget with a longer
   * window, should the headers carry one, holds only once nothing is left. The cells budget is counted in cells, so it is
   * remembered with what this write just used and compared with the size of the next one.
   */
  #notePace(res: Response, wire: Wire): void {
    const now = Date.now();
    for (const b of readBudgets(res.headers.get("ratelimit-policy"), res.headers.get("ratelimit"))) {
      if (NEVER_HELD_BACK.has(b.name)) continue;
      const pace = this.#paceOf(b.name, wire);
      if (b.name === "cells") {
        // The header was read before this write's own cells were counted: take them off.
        const used = res.ok ? wire.cells : 0;
        pace.cells = { remaining: Math.max(0, b.remaining - used), until: now + (b.resetSeconds > 0 ? Math.min(b.resetSeconds, 65) : Math.min(b.windowSeconds, 65)) * 1000 };
        continue;
      }
      if (b.windowSeconds <= 60) {
        if (b.remaining > PARALLEL) continue;
        pace.hold(this.#holds(b.name, wire), { until: now + Math.min(Math.max(b.resetSeconds, 1), 65) * 1000, budget: b.name, learnedAt: now });
      } else if (b.remaining <= 0 && b.resetSeconds > 0) {
        pace.hold(this.#holds(b.name, wire), { until: now + b.resetSeconds * 1000, budget: b.name, learnedAt: now });
      }
    }
  }

  /** A refusal names its budget and its wait: later calls of the same kind do not go out to earn the same 429. */
  #noteRefusal(wire: Wire, scope: string | undefined, retryAfterSeconds: number | undefined): void {
    if (!scope || !retryAfterSeconds || NEVER_HELD_BACK.has(scope)) return;
    const budget = HEADER_OF_SCOPE[scope] ?? scope;
    const now = Date.now();
    this.#paceOf(budget, wire).hold(this.#holds(budget, wire), { until: now + retryAfterSeconds * 1000, budget, learnedAt: now });
  }

  async #attempts(wire: Wire): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      await this.#pace(wire);
      const release = await this.#slot();
      const started = Date.now();
      let res: Response;
      let json: { message?: unknown; data?: unknown } | null;
      try {
        const timeout = AbortSignal.timeout(attemptTimeoutMs(wire.operation, this.#timeoutMs));
        res = await this.#fetch(wire.url, {
          method: wire.method,
          headers: wire.headers,
          body: wire.body,
          // The API never redirects, and the key must not follow one to another address.
          redirect: "manual",
          signal: wire.signal ? AbortSignal.any([timeout, wire.signal]) : timeout,
        });
        json = (await res.json().catch(() => null)) as typeof json;
      } catch (cause) {
        release();
        if (wire.signal?.aborted) throw cause;
        const timedOut = (cause as { name?: string } | null)?.name === "TimeoutError";
        if (!wire.resendable || attempt > this.#maxRetries) {
          throw new ZimmerStackError({
            status: 0,
            code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
            message: wire.resendable
              ? `${wire.operation} could not reach ZimmerStack after ${attempt} attempts`
              : `${wire.operation} could not reach ZimmerStack, and it is not safe to send again without knowing whether it was applied: read the current state before you retry`,
            operation: wire.operation,
            retryable: wire.resendable,
            cause,
          });
        }
        const waitMs = (2 ** (attempt - 1) + Math.random()) * 1000;
        this.#emit({ type: "retry", operation: wire.operation, attempt, waitMs, reason: timedOut ? "TIMEOUT" : "NETWORK_ERROR" });
        await sleep(waitMs, wire.signal);
        continue;
      }
      release();
      this.#notePace(res, wire);
      this.#emit({ type: "response", operation: wire.operation, status: res.status, attempt, ms: Date.now() - started });

      if (res.ok) return json && typeof json === "object" ? json.data : undefined;

      const data = (json && typeof json.data === "object" && json.data !== null ? json.data : {}) as Record<string, unknown>;
      const code = typeof data.code === "string" ? data.code : `HTTP_${res.status}`;
      const headerSeconds = Number(res.headers.get("retry-after"));
      const retryAfter = Number.isFinite(headerSeconds) && headerSeconds > 0 ? headerSeconds : typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : undefined;
      const scope = typeof data.scope === "string" ? data.scope : undefined;
      // What passes with time: a used-up budget, a fault on ZimmerStack's side, a duplicate of a request
      // still running. Every other answer is a verdict on the request itself.
      const passesWithTime = res.status === 429 || res.status >= 500 || code === "IDEMPOTENCY_IN_FLIGHT";
      const error = new ZimmerStackError({
        status: res.status,
        code,
        message: typeof json?.message === "string" && json.message ? json.message : `${wire.operation} answered ${res.status}`,
        operation: wire.operation,
        details: data.details,
        scope,
        retryAfterSeconds: retryAfter,
        retryable: passesWithTime,
      });
      if (KEY_IS_DEAD.has(code)) {
        // A key the API does not know, whose own checksum does not hold: say so, it is the likeliest reason.
        const refused =
          code === "API_KEY_INVALID" && this.keyHint
            ? new ZimmerStackError({ status: error.status, code, message: `${error.message} ${this.keyHint}`, operation: wire.operation, details: error.details, retryable: false })
            : error;
        this.#dead = refused;
        throw refused;
      }
      if (res.status === 429) this.#noteRefusal(wire, scope, retryAfter);
      // A 429 was refused before anything ran, so sending it again is always safe. A 5xx may have run.
      const safeToResend = res.status === 429 || code === "IDEMPOTENCY_IN_FLIGHT" || wire.resendable;
      if (!passesWithTime || !safeToResend || attempt > this.#maxRetries) throw error;
      // A long Retry-After (an hour's or a day's budget, a pause) is held open only inside maxWaitSeconds;
      // past that the refusal comes back with the time the budget frees, and an event says so.
      if ((retryAfter ?? 0) * 1000 > this.#maxWaitMs(wire)) {
        this.#emit({
          type: "deferred",
          operation: wire.operation,
          scope,
          retryAfterSeconds: retryAfter!,
          freesAt: new Date(Date.now() + retryAfter! * 1000).toISOString(),
          message: `${wire.operation} was refused${scope ? ` by the ${scope} budget` : ""}: it can pass in ${aboutHowLong(retryAfter! * 1000)}. Send it again then.`,
        });
        throw error;
      }
      const waitMs = ((retryAfter ?? 2 ** (attempt - 1)) + Math.random()) * 1000;
      this.#emit({ type: "retry", operation: wire.operation, attempt, waitMs, reason: code });
      if (waitMs > SHORT_WAIT_MS) this.#lands(wire, scope, waitMs);
      await sleep(waitMs, wire.signal);
    }
  }
}

/** How `forProperty` hands its core to the view it creates, without a public constructor argument. */
let handoff: Core | undefined;

/* ───────────────────────────── the client ───────────────────────────── */

/**
 * The ZimmerStack Connect API, from your server.
 *
 * @example
 * import { ZimmerStack } from "@zimmerstack/connect";
 *
 * const zs = new ZimmerStack();                       // reads ZIMMERSTACK_CONNECT_KEY
 * const grid = await zs.grid.load("2026-12-01", "2026-12-14");
 * await zs.grid.save({ rates: [{ ratePlanId: 901, date: "2026-12-24", rate: 5200 }] });
 *
 * Make one per process and reuse it: the pace it keeps is per instance.
 */
export class ZimmerStack {
  readonly #core: Core;
  /** "test" on a sandbox key: nothing you send reaches a channel. */
  readonly mode: "live" | "test";
  /** The hotel a company key acts on through this instance. */
  readonly propertyId: number | undefined;

  constructor(options: ZimmerStackOptions = {}) {
    const shared = handoff;
    handoff = undefined;
    this.#core = shared ?? new Core(options);
    this.mode = this.#core.mode;
    // A company key's hotel: the option, else (for a client made from the environment) ZIMMERSTACK_PROPERTY_ID.
    const fromEnv = shared ? undefined : env("ZIMMERSTACK_PROPERTY_ID")?.trim();
    if (fromEnv && !/^[1-9]\d*$/.test(fromEnv)) {
      throw new ZimmerStackUsageError("ZIMMERSTACK_PROPERTY_ID must be a property's numeric id (zs.properties.list() names them)");
    }
    const propertyId = options.propertyId ?? (fromEnv ? Number(fromEnv) : undefined);
    if (propertyId !== undefined && (!Number.isInteger(propertyId) || propertyId <= 0)) {
      throw new ZimmerStackUsageError("propertyId must be a property's numeric id (zs.properties.list() names them)");
    }
    this.propertyId = propertyId;
  }

  /**
   * A software vendor's company key: the same client, acting on one hotel. Each hotel has its own queue
   * of writes and its own pace, so one hotel's budget never holds up another's calls; what all your hotels
   * share (your company's budget) is paced for all of them together. Make as many as you have hotels.
   *
   * @example
   * const { properties } = await zs.properties.list();
   * for (const p of properties) await zs.forProperty(p.id).sync.get();
   */
  forProperty(propertyId: number): ZimmerStack {
    handoff = this.#core;
    try {
      return new ZimmerStack({ propertyId });
    } finally {
      handoff = undefined;
    }
  }

  /** Never prints the key. */
  toJSON(): { mode: string; propertyId: number | undefined } {
    return { mode: this.mode, propertyId: this.propertyId };
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `ZimmerStack { mode: '${this.mode}'${this.propertyId ? `, propertyId: ${this.propertyId}` : ""} }`;
  }

  /**
   * Any operation of the contract by its name, typed. The methods below are this with friendlier names;
   * use it for an operation they do not cover.
   *
   * @example
   * const sync = await zs.request("GET /sync");
   */
  async request<K extends OperationKey>(operation: K, ...rest: {} extends RequestArgs<K> ? [args?: RequestArgs<K>] : [args: RequestArgs<K>]): Promise<Op<K>["response"]> {
    const meta = OPERATIONS[operation];
    if (!meta) throw new ZimmerStackUsageError(`"${operation}" is not an operation of the Connect API`);
    return (await this.#call(operation, meta.idempotent || KEYED_WRITES.has(operation), rest[0] ?? {})) as Op<K>["response"];
  }

  /** One call of the API. `keyed`: the route keeps an idempotency key, so the write may be sent again after a lost answer. */
  async #call(operation: string, keyed: boolean, args: { path?: Record<string, string | number>; query?: Record<string, unknown>; body?: unknown } & WriteOptions): Promise<unknown> {
    if (args.beforeGoLive !== undefined && typeof args.beforeGoLive !== "boolean") throw new ZimmerStackUsageError("beforeGoLive is true or false");
    const [method = "", template = ""] = operation.split(" ");
    const path = template.replace(/\{(\w+)\}/g, (_m, name: string) => {
      const value = args.path?.[name];
      if (value === undefined || value === null || String(value) === "") throw new ZimmerStackUsageError(`${operation} needs ${name}`);
      // A colon is a character a path segment holds as it is, so it is sent as written: a delete by your own
      // ref ends with ref:<ref>, the same address the docs and the Postman files show. All else is encoded.
      return encodeURIComponent(String(value)).replace(/%3A/g, ":");
    });
    const url = new URL(this.#core.base + API_PREFIX + path);
    for (const [name, value] of Object.entries(args.query ?? {})) if (value !== undefined && value !== null) url.searchParams.set(name, String(value));

    const headers: Record<string, string> = { authorization: this.#core.authorization(), accept: "application/json", "user-agent": `zimmerstack-connect-node/${SDK_VERSION}` };
    // Adding a hotel and removing one name no hotel in the header: the one to add does not exist yet, and the
    // one to remove is in the path. Listing them sends the header only when this client was made for one hotel.
    // A company webhook endpoint belongs to the partner, not to a hotel: those routes read no hotel either.
    // So are your links, your bills and your support tickets; and a hotel's keys name their hotel in the path.
    const aboutTheList =
      operation === "POST /properties" || template.startsWith("/properties/") || COMPANY_ROUTES.some((prefix) => template === prefix || template.startsWith(prefix + "/"));
    const hotel = aboutTheList ? undefined : (this.propertyId ?? (operation === "GET /properties" ? undefined : this.#core.soleSandboxId));
    if (hotel) headers[PROPERTY_HEADER] = String(hotel);
    if (args.beforeGoLive === true) headers[BEFORE_GO_LIVE_HEADER] = "true";
    const body = args.body === undefined ? undefined : JSON.stringify(args.body);
    if (body !== undefined) headers["content-type"] = "application/json";
    if (keyed) {
      // One key per write, reused on every retry of it, so a write that timed out can never land twice.
      if (args.idempotencyKey !== undefined && !IDEMPOTENCY_SHAPE.test(args.idempotencyKey)) {
        throw new ZimmerStackUsageError("idempotencyKey must be 10 to 64 characters of A-Z a-z 0-9 _ -");
      }
      headers[IDEMPOTENCY_HEADER] = args.idempotencyKey ?? crypto.randomUUID();
    }
    const wire = {
      operation,
      method,
      url,
      headers,
      body,
      write: method !== "GET",
      resendable: method === "GET" || keyed,
      hotel: hotel ? String(hotel) : "",
      cells: CELL_WRITES.has(operation) ? cellsOf((args.body as { updates?: ReadonlyArray<{ dateFrom: string; dateTo: string }> } | undefined)?.updates ?? []) : 0,
      maxWaitSeconds: args.maxWaitSeconds,
      signal: args.signal,
    };
    try {
      return await this.#core.send(wire);
    } catch (err) {
      // A company key that named no hotel. The API refused before anything ran, so sending again is safe.
      if (!(err instanceof ZimmerStackError) || err.code !== "PROPERTY_REQUIRED" || this.propertyId !== undefined) throw err;
      const sole = await this.#soleSandboxProperty(args.signal);
      if (sole === undefined) {
        throw new ZimmerStackError({
          status: err.status,
          code: err.code,
          message:
            "This is a company key: say which hotel each call acts on. Use zs.forProperty(id), new ZimmerStack({ propertyId }) or the environment variable ZIMMERSTACK_PROPERTY_ID; zs.properties.list() names the hotels this key reaches.",
          operation,
          details: err.details,
          retryable: false,
        });
      }
      // The same request (same idempotency key) naming the hotel, on its own copy of the headers.
      return await this.#core.send({ ...wire, hotel: String(sole), headers: { ...headers, [PROPERTY_HEADER]: String(sole) } });
    }
  }

  /**
   * The one hotel a SANDBOX company key reaches (its sandbox), so the first call of a new integration works
   * without naming it. A live key never guesses: a hotel it acts on is always named.
   */
  #soleSandboxProperty(signal: AbortSignal | undefined): Promise<number | undefined> {
    if (this.mode !== "test") return Promise.resolve(undefined);
    this.#core.soleSandboxProperty ??= this.request("GET /properties", { signal })
      .then((list) => {
        const only = list.keyKind === "company" && list.properties.length === 1 && list.properties[0]!.sandbox ? list.properties[0]!.id : undefined;
        this.#core.soleSandboxId = only;
        return only;
      })
      .catch(() => {
        this.#core.soleSandboxProperty = undefined; // a failed lookup is asked again next time
        return undefined;
      });
    return this.#core.soleSandboxProperty;
  }

  /* ── which hotel ── */

  readonly properties = {
    /** The hotels this key may act on. A company key names one of them on every other call (`forProperty`). */
    list: (options?: ReadOptions) => this.request("GET /properties", options),
    /**
     * Add a hotel. Only a software partner's COMPANY key that holds the scope properties:write can; tick
     * "Also add and remove hotels" when you make the key in the partner portal. A hotel's own key is refused.
     *
     * The answer's `id` is the hotel: act on it with `zs.forProperty(id)`. Its owner gets the sign-in details
     * by email; they are never sent to you. `billing.state` says whether it is on your invoice yet, and
     * `channelManager` turns true with your first `roomTypes.save` or `catalog.upsertRoomTypes` for it.
     *
     * With a test key (zsk_test_) the same call makes a sandbox instead: a practice hotel no booking site
     * sees, never billed. Safe to retry: the same `idempotencyKey` answers with the same hotel and
     * `replay: true`, and never makes a second one.
     *
     * @example
     * const hotel = await zs.properties.create({
     *   name: "Sea Breeze Apartments",
     *   owner: { name: "Nimal Perera", email: "nimal@seabreeze.example", phone: "+94 77 123 4567" },
     *   address: { line1: "12 Beach Road", city: "Galle", country: "LK" },
     *   roomTypes: [{ ref: "deluxe", name: "Deluxe Room", roomCount: 6, defaultRate: "90.00" }],
     * });
     * const seaBreeze = zs.forProperty(hotel.id);
     */
    create: async (hotel: PropertyCreate, options?: WriteOptions): Promise<PropertyCreated> => {
      const created = await this.request("POST /properties", { body: hotel, ...options });
      this.#forgetWhichHotels();
      return created;
    },
    /**
     * Change a hotel YOU ADDED: its name, its address, or both. A company key with the scope properties:write.
     *
     * Send only what changes: `name`, and under `address` any of `line1`, `city`, `state` and `postalCode`. A
     * field you leave out stays as it is. It never changes the hotel's country, currency, time zone, owner or
     * tax id (sending one is refused with VALIDATION), and it changes the hotel's record in ZimmerStack, not
     * the name of its listing on a booking site.
     *
     * The answer is the hotel with its `address` and `changed`: the fields whose stored value moved. An empty
     * `changed` means everything you sent was already stored. A hotel whose owner let you in is refused with
     * PROPERTY_NOT_CHANGEABLE: its owner changes it. With a test key it changes one of your sandboxes, whose
     * name keeps its ending, "(sandbox)". Safe to retry: the call carries an idempotency key.
     *
     * After a new name, `zs.properties.delete` wants that new name in `confirm`.
     *
     * @example
     * const hotel = await zs.properties.update(61, { name: "Sea Breeze Suites", address: { line1: "14 Beach Road" } });
     * hotel.changed; // ["name", "address.line1"]
     */
    update: async (propertyId: number, changes: PropertyChange, options?: WriteOptions): Promise<PropertyChanged> => {
      if (!Number.isInteger(propertyId) || propertyId <= 0) {
        throw new ZimmerStackUsageError("zs.properties.update needs the hotel's numeric id (zs.properties.list() names them)");
      }
      const sent = changes?.name !== undefined || Object.values(changes?.address ?? {}).some((value) => value !== undefined);
      if (!sent) {
        throw new ZimmerStackUsageError("zs.properties.update needs something to change: name, or line1, city, state or postalCode under address.");
      }
      return this.request("PATCH /properties/{propertyId}", { path: { propertyId }, body: changes, ...options });
    },
    /**
     * Remove a hotel YOU ADDED, for good. A company key with the scope properties:write.
     *
     * One call does what ZimmerStack does when a hotel's service ends, in this order: its booking sites
     * are disconnected, its rate plans are removed from the channel manager, then its room types, then the
     * hotel is closed (its owner can no longer sign in, and no key reaches it). It comes off your invoice
     * from the next 1st; the month already billed is not refunded. Bookings already made stay with the
     * booking sites and the hotel.
     *
     * THERE IS NO UNDO. Call it when a person chose to remove that hotel; never from a loop, a timer or a
     * sync job. `confirm` is the hotel's exact name, as `zs.properties.list()` prints it, so a wrong id never
     * removes a hotel. Move the hotel's booking sites to its next channel manager first, so it keeps selling.
     *
     * The answer: `channelManager.state` is REMOVED when nothing is left on the channel manager, or
     * RETRYING when the hotel is closed and off your bill but one step there is still finishing (ZimmerStack
     * retries it; you do nothing). Calling it again later answers `replay: true`. A hotel you did not add,
     * or one that uses more than the channel manager, is refused with PROPERTY_NOT_REMOVABLE and who can do
     * it. With a test key it deletes a sandbox.
     *
     * @example
     * const { properties } = await zs.properties.list();
     * const hotel = properties.find((p) => p.id === 61);
     * if (hotel) await zs.properties.delete(hotel.id, { confirm: hotel.name });
     */
    delete: (propertyId: number, options: { confirm: string; signal?: AbortSignal }): Promise<PropertyRemoved> => this.#removeProperty(propertyId, options),
    /** The same as `delete`, under the word the partner portal uses ("Remove hotel"). */
    remove: (propertyId: number, options: { confirm: string; signal?: AbortSignal }): Promise<PropertyRemoved> => this.#removeProperty(propertyId, options),
  };

  async #removeProperty(propertyId: number, options: { confirm: string; signal?: AbortSignal }): Promise<PropertyRemoved> {
    if (!Number.isInteger(propertyId) || propertyId <= 0) {
      throw new ZimmerStackUsageError("zs.properties.delete needs the hotel's numeric id (zs.properties.list() names them)");
    }
    const confirm = typeof options?.confirm === "string" ? options.confirm.trim() : "";
    if (!confirm) {
      throw new ZimmerStackUsageError(
        "zs.properties.delete needs { confirm: <the hotel's exact name> }, as zs.properties.list() prints it. Removing a hotel cannot be undone, so the name is asked for."
      );
    }
    const removed = await this.request("DELETE /properties/{propertyId}", { path: { propertyId }, query: { confirm }, signal: options.signal });
    this.#core.catalogs.delete(propertyId);
    this.#forgetWhichHotels();
    return removed;
  }

  /** The hotels this key reaches just changed: the one sandbox a test key was assumed to act on is looked up afresh. */
  #forgetWhichHotels(): void {
    this.#core.soleSandboxProperty = undefined;
    this.#core.soleSandboxId = undefined;
  }

  readonly property = {
    /** The hotel: its timezone and currency, what this key may do, its own limits, what it has used, where it stands. */
    get: (options?: ReadOptions) => this.request("GET /property", options),
  };

  readonly limits = {
    /**
     * Every budget this key sits under, with what is left and when it refills: the key's, its hotel's and,
     * on a company key, your company's, plus the budgets over an hour and a day with this hotel's own
     * figures. Any key may call it, and reading uses up nothing but one request.
     *
     * You do not need it to stay inside the limits: the client paces itself from every answer. Use it to
     * size a job before you start it, or to show a person why something waits.
     *
     * @example
     * const { budgets, shield } = await zs.limits.get();
     * const cells = shield?.budgets.find((b) => b.scope === "cells-day");
     * if (cells?.remaining != null && cells.remaining < plannedCells) console.log(`Room again in ${cells.resetSeconds} s`);
     */
    get: (options?: ReadOptions): Promise<LimitsNow> => this.request("GET /limits", options),
  };

  /* ── what this key did: its own request log ── */

  readonly requests = {
    /**
     * This key's own requests of the last 7 days, newest first: when, the route's pattern, the status, the
     * error code, the address it came from, how long it took and the request id. Never a body, a query or a
     * guest's data. Any key may call it. A company key reads every call made with it across its hotels, or
     * one hotel's through `zs.forProperty(id)`.
     *
     * `since` defaults to the last 24 hours. `status` is one code ("429"), a family ("4xx") or "errors"
     * (400 and above). Use it to answer "did my push arrive" yourself, and to look for an address that is
     * not yours: that is the first sign of a leaked key.
     *
     * @example
     * const { items } = await zs.requests.list({ status: "errors" });
     * for (const r of items) console.log(r.at, r.method, r.route, r.status, r.errorCode, r.requestId);
     */
    list: (query?: Op<"GET /requests">["query"], options?: ReadOptions): Promise<RequestLog> => this.request("GET /requests", { query, ...options }),
    /**
     * The same, page by page to the last one: every request since `since`, newest first.
     *
     * @example
     * for await (const r of zs.requests.all({ status: "errors", since: yesterday })) count[r.errorCode ?? r.status]++;
     */
    all: (query?: Omit<NonNullable<Op<"GET /requests">["query"]>, "cursor">, options?: ReadOptions): AsyncGenerator<RequestLog["items"][number], void, undefined> =>
      this.#pages((cursor) => this.requests.list({ limit: 200, ...query, cursor }, options)),
  };

  /* ── the hotel's ordered event log: the webhooks are the nudge, this is the truth ── */

  readonly events = {
    /**
     * One page of the hotel's event log: every event a webhook can carry for it (OTA bookings, website
     * bookings, channel alerts, drift), once, oldest first, starting after the sequence you pass. Each item
     * is the webhook's own envelope with its `sequence`, so one parser serves both.
     *
     * Keep `nextAfter` as your place. `more: true` means ask again at once. When `earliestSequence` is more
     * than one above the `after` you sent, the events in between are older than the log keeps (90 days):
     * reconcile with `zs.channelBookings.all` and `zs.directBookings.all`, then carry on. Scope
     * channel-bookings:read (the channel events) or direct-bookings:read (the website's). `all` does the paging.
     *
     * @example
     * const page = await zs.events.list({ after: lastSequence });
     */
    list: (query?: Op<"GET /events">["query"], options?: ReadOptions): Promise<EventsList> => this.request("GET /events", { query, ...options }),
    /**
     * Every event after a sequence you saved, in order, to the end of the log. Apply each one, then save its
     * `sequence`: that is your place, and the next run starts from it. A webhook only tells you there is
     * something to read; nothing depends on it having arrived, or on the order deliveries arrived in.
     *
     * `onGap` is called once, before the first event, when the log no longer holds what follows `after`
     * (events are kept 90 days): read the bookings again with `zs.channelBookings.all({ since })` and
     * `zs.directBookings.all({ since })` before you go on. A first run with `after: 0` is told too.
     *
     * @example
     * for await (const event of zs.events.all({ after: await loadPlace() })) {
     *   await apply(event);            // dedupe on event.id if your apply is not idempotent
     *   await savePlace(event.sequence);
     * }
     */
    all: (query?: { after?: number; limit?: number }, options?: ReadOptions & { onGap?: (gap: { after: number; earliestSequence: number }) => void }): AsyncGenerator<LoggedEvent, void, undefined> =>
      this.#eventsAfter(query?.after ?? 0, query?.limit, options),
  };

  async *#eventsAfter(after: number, limit: number | undefined, options: (ReadOptions & { onGap?: (gap: { after: number; earliestSequence: number }) => void }) | undefined): AsyncGenerator<LoggedEvent, void, undefined> {
    if (!Number.isInteger(after) || after < 0) throw new ZimmerStackUsageError("zs.events.all needs the last sequence you applied as its after: a whole number, 0 to read from the beginning of what is kept");
    let place = after;
    let first = true;
    for (;;) {
      const page = await this.events.list({ after: place, limit: limit ?? 100 }, { signal: options?.signal, maxWaitSeconds: options?.maxWaitSeconds });
      if (first && page.earliestSequence !== null && page.earliestSequence > after + 1) options?.onGap?.({ after, earliestSequence: page.earliestSequence });
      first = false;
      yield* page.items;
      // nextAfter moves past events this key's scopes do not show, so an empty page can still move the place.
      if (!page.more || page.nextAfter <= place) return;
      place = page.nextAfter;
    }
  }

  /* ── your company webhook endpoints (a software partner's company key, scope webhooks:manage) ── */

  readonly webhookEndpoints = {
    /** Your company webhook endpoints of this key's mode (a live key: live ones; a test key: test ones), each with its health. */
    list: (options?: ReadOptions): Promise<WebhookEndpointList> => this.request("GET /webhook-endpoints", options),
    /**
     * Create a company webhook endpoint. `dataAck: true` confirms that guest booking details will be sent
     * to that address. Guest contact (phone, email) is off unless `includeGuestContact` is true.
     *
     * THE ANSWER'S `secret` IS SHOWN ONCE: store it in your server's settings at once (never in code or a
     * log). No call reads it back; `rotateSecret` makes a new one. The call carries an idempotency key, so
     * a retry after a lost answer gets the same endpoint and the same secret, never a second endpoint.
     *
     * @example
     * const { endpoint, secret } = await zs.webhookEndpoints.create({ url: "https://pms.example/zimmerstack", dataAck: true });
     */
    create: (body: WebhookEndpointCreate, options?: WriteOptions): Promise<WebhookEndpointCreated> => this.request("POST /webhook-endpoints", { body, ...options }),
    get: (endpointId: number, options?: ReadOptions): Promise<WebhookEndpoint> => this.request("GET /webhook-endpoints/{endpointId}", { path: { endpointId }, ...options }),
    /** Change an endpoint: its address, its event types, the notify email or the guest-contact switch. Send only what changes. */
    update: (endpointId: number, body: WebhookEndpointUpdate, options?: WriteOptions): Promise<WebhookEndpoint> =>
      this.request("PATCH /webhook-endpoints/{endpointId}", { path: { endpointId }, body, ...options }),
    /**
     * Delete an endpoint for good; its deliveries and their log go with it. THERE IS NO UNDO: call it when
     * a person chose to, never from a loop or a cleanup script. To stop events for a while, `pause`.
     */
    delete: (endpointId: number, options?: ReadOptions): Promise<WebhookEndpointDeleted> => this.request("DELETE /webhook-endpoints/{endpointId}", { path: { endpointId }, ...options }),
    /** Hold an endpoint's events (before planned downtime). Nothing is dropped: `resume` sends them, oldest first. */
    pause: (endpointId: number, options?: WriteOptions): Promise<WebhookEndpoint> => this.request("POST /webhook-endpoints/{endpointId}/pause", { path: { endpointId }, ...options }),
    /** Resume a paused endpoint. `heldEvents` says how many held events are going out now. */
    resume: (endpointId: number, options?: WriteOptions): Promise<WebhookEndpointResumed> => this.request("POST /webhook-endpoints/{endpointId}/resume", { path: { endpointId }, ...options }),
    /**
     * A new signing secret, in this answer only. Both secrets sign every delivery until `previousExpiresAt`
     * (24 hours), so switch your receiver to the new one inside that day and nothing is lost.
     */
    rotateSecret: (endpointId: number, options?: WriteOptions): Promise<WebhookSecretRotated> =>
      this.request("POST /webhook-endpoints/{endpointId}/rotate-secret", { path: { endpointId }, ...options }),
    /**
     * Send the endpoint a signed sample of any event type (`zimmerstack.ping` when none is named). The
     * sample says `mode: "test"` and has no `sequence`: it is in no log. On a sandbox, make a real event
     * instead with `zs.sandbox.bookings.create` and `zs.sandbox.syncEvents.create`.
     *
     * @example
     * const { deliveryId } = await zs.webhookEndpoints.test(endpoint.id, { eventType: "channel.booking.created" });
     * const delivery = await zs.webhookEndpoints.deliveries.get(endpoint.id, deliveryId); // what your receiver answered
     */
    test: (endpointId: number, body: WebhookTest = {}, options?: WriteOptions): Promise<WebhookTestQueued> =>
      this.request("POST /webhook-endpoints/{endpointId}/test", { path: { endpointId }, body, ...options }),
    /**
     * Queue again every subscribed event since an instant that failed or never had a delivery: at most 90
     * days back and 10,000 events a run (`truncated: true` means run it again for the rest). Reading the
     * log with `zs.events.all` is the other way to catch up, and needs no endpoint.
     */
    recover: (endpointId: number, since: string | Date, options?: WriteOptions): Promise<WebhookRecoverResult> =>
      this.request("POST /webhook-endpoints/{endpointId}/recover", { path: { endpointId }, body: { since: since instanceof Date ? since.toISOString() : since }, ...options }),
    deliveries: {
      /** An endpoint's delivery log, newest first. Filter with status, eventType, mode (TEST: what a test made), from and to. */
      list: (endpointId: number, query?: Op<"GET /webhook-endpoints/{endpointId}/deliveries">["query"], options?: ReadOptions): Promise<WebhookDeliveryList> =>
        this.request("GET /webhook-endpoints/{endpointId}/deliveries", { path: { endpointId }, query, ...options }),
      /** One delivery: the body as it was sent, and every attempt with what your receiver answered. */
      get: (endpointId: number, deliveryId: string, options?: ReadOptions): Promise<WebhookDeliveryDetail> =>
        this.request("GET /webhook-endpoints/{endpointId}/deliveries/{deliveryId}", { path: { endpointId, deliveryId }, ...options }),
      /** Send one delivery again: the same event, the same id and sequence. */
      redeliver: (endpointId: number, deliveryId: string, options?: WriteOptions): Promise<WebhookDelivery> =>
        this.request("POST /webhook-endpoints/{endpointId}/deliveries/{deliveryId}/redeliver", { path: { endpointId, deliveryId }, ...options }),
    },
  };

  /* ── one-time connect links: the hotel's own person connects a booking site (company key, scope channels:connect) ── */

  readonly connectLinks = {
    /** Your connect links, newest first; `propertyId` narrows them to one hotel. */
    list: (query?: Op<"GET /connect-links">["query"], options?: ReadOptions): Promise<ConnectLinkList> => this.request("GET /connect-links", { query, ...options }),
    /**
     * Make a one-time link for ONE hotel and ONE booking site. Only Airbnb is connected from the link alone
     * (the host signs in on Airbnb's own page). Every other booking site must FIRST accept our connectivity
     * partner for the hotel, in its extranet or through its support: send `hotelStep` to the hotel first, and
     * the answer's `url` once that step is done. On ZimmerStack's hosted page the hotel's own person types
     * the hotel's id at the booking site (MakeMyTrip also its access token), confirms every room and rate
     * match and presses Start selling. The call takes no booking-site detail and no match. You hear
     * `channel.connect.completed`, or `channel.connect.expired` if the link ran out.
     *
     * THE `url` IS SHOWN ONCE: it is in this answer only, and null on a replay of the same request
     * (`shownOnce(answer)` returns it or says what to do). `hotelStep` is what the hotel does at the booking
     * site first (null for Airbnb), for your own screen or message; it can take days. A LIVE key only: a
     * sandbox has no booking site, so a test key is refused (LIVE_KEY_REQUIRED). The hotel is `propertyId`
     * in the body; `forProperty` is not read.
     *
     * @example
     * const made = await zs.connectLinks.create({ propertyId: 61, channel: "bookingcom", returnUrl: "https://pms.example/hotels/61" });
     * await tellTheHotel(made.hotelStep); // first
     * await sendOnceTheStepIsDone(shownOnce(made)); // then the link
     */
    create: (body: ConnectLinkCreate, options?: WriteOptions): Promise<ConnectLinkCreated> => this.request("POST /connect-links", { body, ...options }),
    /** Where one link stands: pending, opened, completed, expired or revoked. Never its address again. */
    get: (linkId: string, options?: ReadOptions): Promise<ConnectLink> => this.request("GET /connect-links/{linkId}", { path: { linkId }, ...options }),
    /** Withdraw a link. A page that is open stops at its next step. */
    revoke: (linkId: string, options?: WriteOptions): Promise<ConnectLink> => this.request("POST /connect-links/{linkId}/revoke", { path: { linkId }, ...options }),
  };

  /* ── going live: is this hotel ready for your software to be its source of truth ── */

  readonly readiness = {
    /**
     * Is this hotel ready for your software to be its source of truth? Four checks, each passed or not,
     * with a sentence and what to do: it is on the channel manager, every room type and rate plan is
     * linked, ZimmerStack's own pricing will not overwrite your prices, and nothing stale would go out
     * (the record matches the channels, or you sent a price for every rate plan and night of the year
     * first). Room counts are no part of it: the report only says how many room-type nights your software
     * has not written yet. Any key may read it, as often as you like. A hotel you added yourself is live
     * from the start (`live: true`).
     *
     * @example
     * const report = await zs.forProperty(61).readiness.get();
     * for (const check of report.checks) if (!check.passed) console.log(check.id, check.summary, check.action);
     */
    get: (options?: ReadOptions): Promise<Readiness> => this.request("GET /readiness", options),
    /**
     * Make your software this hotel's source of truth: from then on every price, stay rule and room count
     * you send is pushed to its booking sites, and what you sent ahead (`beforeGoLive: true`) goes out.
     * Scope ari:write. Not ready is 409 NOT_READY with the checks that did not pass in `error.details`;
     * that refusal is never kept under an idempotency key, so call again once they pass. Already live
     * answers `replay: true`. Call it when a person decided to; only ZimmerStack support switches a hotel back.
     *
     * @example
     * const hotel = zs.forProperty(61);
     * await hotel.rates.set(aYearOfPrices, { beforeGoLive: true });        // stored, and waits
     * // Room counts are not sent ahead: until go-live a count may only lower what is on sale (it goes out at once), and a higher one is refused.
     * if ((await hotel.readiness.get()).ready) await hotel.readiness.goLive();
     * await hotel.availability.set(aYearOfCounts);                          // right after going live: your room counts
     */
    goLive: (options?: WriteOptions): Promise<GoLiveResult> => this.request("POST /go-live", options),
  };

  /* ── the keys you made on a hotel (company key, scope keys:manage) ── */

  readonly hotelKeys = {
    /** The keys YOU made on a hotel you added. The hotel's own keys are its owner's and are never listed here. */
    list: (propertyId: number, options?: ReadOptions): Promise<HotelKeyList> => this.request("GET /properties/{propertyId}/keys", { path: { propertyId }, ...options }),
    /**
     * Mint a key on a hotel you added (or, with a test key, on one of your sandboxes): any scope a
     * hotel's own key may hold, never a company key's own.
     *
     * THE ANSWER'S `key` IS SHOWN ONCE: store it in the server's settings at once, never in code or a log.
     * It is null on a replay of the same request: `shownOnce(answer)` returns it or says to rotate.
     *
     * @example
     * const minted = await zs.hotelKeys.create(61, { name: "Night audit job", scopes: ["ari:read", "channel-bookings:read"] });
     * await vault.put(`zimmerstack/hotel-61`, shownOnce(minted));
     */
    create: (propertyId: number, body: HotelKeyCreate, options?: WriteOptions): Promise<HotelKeyCreated> => this.request("POST /properties/{propertyId}/keys", { path: { propertyId }, body, ...options }),
    /**
     * A new key with the same name, scopes, addresses and expiry, its secret shown once; the old key keeps
     * answering for 24 hours (`retired.retireAt`), so switch inside that day and nothing stops.
     */
    rotate: (propertyId: number, keyId: number, options?: WriteOptions): Promise<HotelKeyRotated> =>
      this.request("POST /properties/{propertyId}/keys/{keyId}/rotate", { path: { propertyId, keyId }, ...options }),
    /** Revoke a key you made: it stops at once. `reason` (3 to 500 characters) is written on the key and on the hotel's activity log. */
    revoke: (propertyId: number, keyId: number, body: HotelKeyRevoke, options?: WriteOptions): Promise<HotelKey> =>
      this.request("POST /properties/{propertyId}/keys/{keyId}/revoke", { path: { propertyId, keyId }, body, ...options }),
  };

  /* ── your bills, read only (company key, scope billing:read) ── */

  readonly billing = {
    /**
     * Your bills at a glance: what is owed, the one-time onboarding fee, your hotel quota and what opens
     * the next level, what is left of money paid ahead, the days of an unpaid invoice, and `atCost`: what
     * the channel manager charged above its included room types and rate plans for a hotel whose limit
     * ZimmerStack raised. An at-cost line is a record: `status` says RECORDED until ZimmerStack's team has
     * put it on one of your invoices (INVOICED) or waived it. Nothing here pays or changes anything.
     */
    get: (options?: ReadOptions): Promise<Billing> => this.request("GET /billing", options),
    /** Your 24 most recent issued invoices, newest first, each before and after tax with its lines, then the recent payments. */
    invoices: (options?: ReadOptions): Promise<BillingInvoices> => this.request("GET /billing/invoices", options),
    /**
     * What your next monthly invoice is made of, hotel by hotel, read today: the rooms counted, the room
     * band, the price list, the unit price. The invoice reads rooms, prices and the exchange rate again on
     * the day it is made, and that is the bill.
     */
    nextInvoice: (options?: ReadOptions): Promise<BillingNextInvoice> => this.request("GET /billing/next-invoice", options),
  };

  /* ── support tickets (company key, scope support:write) ── */

  readonly supportTickets = {
    /** Your tickets of this key's mode, newest first. `status`: OPEN (waiting for ZimmerStack), ANSWERED (waiting for you), CLOSED. */
    list: (query?: Op<"GET /support-tickets">["query"], options?: ReadOptions): Promise<SupportTicketList> => this.request("GET /support-tickets", { query, ...options }),
    /** The same, page by page to the last one. */
    all: (query?: Omit<NonNullable<Op<"GET /support-tickets">["query"]>, "cursor">, options?: ReadOptions): AsyncGenerator<SupportTicketList["items"][number], void, undefined> =>
      this.#pages((cursor) => this.supportTickets.list({ limit: 100, ...query, cursor }, options)),
    /**
     * Open a support ticket. `severity` follows from the hotels you name: `many_hotels` needs two or more
     * `propertyIds` or `allProperties: true`, `one_hotel` exactly one, `question` any or none. ZimmerStack
     * attaches what its own records show at that moment (`diagnostic`: ids, counts, states and times), so
     * never paste a key, a secret or a guest's details into `message`. It opens whatever your
     * integration's standing. The call carries an idempotency key: a retry never opens a second ticket.
     *
     * @example
     * const ticket = await zs.supportTickets.create({ severity: "many_hotels", subject: "Prices are not going out", message: "Since 08:10 UTC every PUT /rates is accepted and its batch stays pending.", propertyIds: [61, 62, 70] });
     * console.log(ticket.id, ticket.firstReply.target, ticket.firstReply.dueAt);
     */
    create: (body: SupportTicketCreate, options?: WriteOptions): Promise<SupportTicket> => this.request("POST /support-tickets", { body, ...options }),
    /** One ticket: its thread, oldest first, and the diagnostic taken when it opened. */
    get: (ticketId: number, options?: ReadOptions): Promise<SupportTicket> => this.request("GET /support-tickets/{ticketId}", { path: { ticketId }, ...options }),
    /** Write again on a ticket; it waits for ZimmerStack from then. A closed ticket takes no more messages (SUPPORT_TICKET_CLOSED): open a new one and name the old one. */
    reply: (ticketId: number, message: string, options?: WriteOptions): Promise<SupportTicket> =>
      this.request("POST /support-tickets/{ticketId}/messages", { path: { ticketId }, body: { message }, ...options }),
    /** Close your own ticket. */
    close: (ticketId: number, options?: WriteOptions): Promise<SupportTicket> => this.request("POST /support-tickets/{ticketId}/close", { path: { ticketId }, ...options }),
  };

  /* ── is something wrong on ZimmerStack's side ── */

  readonly status = {
    /**
     * The components (the API, bookings coming in, prices and availability going out, each booking site),
     * each operational or named in an open incident, and the incidents that touch YOUR hotels: the open
     * ones and those resolved in the last 7 days. Any key. A company key reads all its hotels', or one
     * hotel's through `zs.forProperty(id)`. An incident is opened and closed by ZimmerStack's staff:
     * `operational` means nobody has reported a problem, not that a monitor measured none.
     *
     * @example
     * const { overall, incidents } = await zs.status.get();
     * for (const incident of incidents.open) console.log(incident.title, incident.status, incident.updates[0]?.message);
     */
    get: (options?: ReadOptions): Promise<Status> => this.request("GET /status", options),
  };

  /* ── room types and rate plans ── */

  readonly catalog = {
    /** Room types and rate plans, with the numeric ids every write uses. */
    get: async (options?: ReadOptions): Promise<Catalog> => {
      const value = await this.request("GET /catalog", options);
      this.#core.catalogs.set(this.propertyId ?? 0, { at: Date.now(), value });
      return value;
    },
    /** Create or change room types by your own `ref`. Needs the scope catalog:write. */
    upsertRoomTypes: (body: RoomTypesUpsert, options?: WriteOptions) => this.#structure("PUT /catalog/room-types", { body, ...options }),
    /**
     * Delete a room type; its rate plans go with it. Name it by ZimmerStack's id (a number), or by your
     * own ref as `{ ref }`: the address then ends with `ref:` and the ref, and the API finds the room
     * type that ref names among this hotel's own. A ref the hotel does not hold is ROOM_TYPE_NOT_FOUND.
     *
     * @example
     * await zs.catalog.deleteRoomType(412); // by ZimmerStack's id
     * await zs.catalog.deleteRoomType({ ref: "deluxe" }); // by your ref
     */
    deleteRoomType: async (roomTypeId: number | { ref: string }, options?: ReadOptions) =>
      this.#structure("DELETE /catalog/room-types/{roomTypeId}", { path: { roomTypeId: deleteTarget("room type", roomTypeId) }, ...options }),
    /** Create or change rate plans by your own `ref`. */
    upsertRatePlans: (body: RatePlansUpsert, options?: WriteOptions) => this.#structure("PUT /catalog/rate-plans", { body, ...options }),
    /**
     * Delete a rate plan, by ZimmerStack's id (a number) or by your own ref as `{ ref }`. Refused while
     * a booking site still has a match to it. A ref the hotel does not hold is RATE_PLAN_NOT_FOUND.
     */
    deleteRatePlan: async (ratePlanId: number | { ref: string }, options?: ReadOptions) =>
      this.#structure("DELETE /catalog/rate-plans/{ratePlanId}", { path: { ratePlanId: deleteTarget("rate plan", ratePlanId) }, ...options }),
  };

  /* ── the same room types and rate plans, one at a time, under the names you would look for ── */

  readonly roomTypes = {
    /** Every room type of the hotel, each with the numeric `id` that room counts and bookings name. */
    list: async (options?: ReadOptions): Promise<Catalog["roomTypes"]> => (await this.catalog.get(options)).roomTypes,
    /**
     * Create a room type, or change it if you sent this `ref` before. `ref` is your own id for it; the
     * answer's `id` is ZimmerStack's, the one every later call names. Needs the scope catalog:write.
     * To send several in one request use `catalog.upsertRoomTypes`.
     *
     * @example
     * const room = await zs.roomTypes.save({ ref: "deluxe", name: "Deluxe Room", roomCount: 8, adults: 2 });
     * room.id; // use it in availability.set and in a rate plan's roomTypeId
     */
    save: async (roomType: RoomTypeInput, options?: WriteOptions): Promise<StructureSaved> => savedOne(await this.catalog.upsertRoomTypes({ roomTypes: [roomType] }, options)),
    /**
     * Delete a room type for good, by its `id` (a number) or by your own `ref` (a string). Its rate
     * plans are deleted with it; the answer's `deletedRatePlanIds` names them. Needs the scope
     * catalog:write.
     *
     * THERE IS NO UNDO. Call it when a person chose to delete; never from a loop, a timer or a sync job.
     * It is refused while a booking site still sells one of its rate plans (unmap the plan on the
     * channel first), while an upcoming stay holds one of its rooms, or while rooms are still assigned
     * to it on a hotel that runs the ZimmerStack PMS: CATALOG_CONFLICT, or CHANNEL_MANAGER_ERROR when
     * the refusal is the channel manager's. Show the message; nothing was deleted. Deletes have a daily
     * budget per hotel (RATE_LIMITED, scope structure-deletes-day).
     *
     * @example
     * await zs.roomTypes.delete("deluxe"); // by your ref
     * await zs.roomTypes.delete(412); // by ZimmerStack's id
     */
    delete: async (idOrRef: number | string, options?: ReadOptions): Promise<CatalogDeleteResult> => this.#deleteOne("roomTypes", idOrRef, options),
  };

  readonly ratePlans = {
    /** Every rate plan of the hotel, each with the numeric `id` that prices and stay rules name. */
    list: async (options?: ReadOptions): Promise<Catalog["ratePlans"]> => (await this.catalog.get(options)).ratePlans,
    /**
     * Create a rate plan, or change it if you sent this `ref` before. Name its room type by
     * `roomTypeRef` (the ref you gave the room type) or by `roomTypeId`. `defaultRate` is its standing
     * price in major units (4500 = 4,500.00). Needs the scope catalog:write. To send several in one
     * request use `catalog.upsertRatePlans`.
     *
     * @example
     * const plan = await zs.ratePlans.save({ ref: "deluxe-bb", roomTypeRef: "deluxe", name: "Bed and breakfast", mealPlan: "CP", defaultRate: 4500 });
     * plan.id; // use it in rates.set and restrictions.set
     */
    save: async (ratePlan: RatePlanInput, options?: WriteOptions): Promise<StructureSaved> => savedOne(await this.catalog.upsertRatePlans({ ratePlans: [ratePlan] }, options)),
    /**
     * Delete a rate plan for good, by its `id` (a number) or by your own `ref` (a string). Needs the
     * scope catalog:write.
     *
     * THERE IS NO UNDO. Call it when a person chose to delete; never from a loop, a timer or a sync job.
     * It is refused with CATALOG_CONFLICT while a booking site still sells the plan: unmap it on the
     * channel first. Deletes have a daily budget per hotel (RATE_LIMITED, scope structure-deletes-day).
     *
     * @example
     * await zs.ratePlans.delete("deluxe-bb"); // by your ref
     * await zs.ratePlans.delete(901); // by ZimmerStack's id
     */
    delete: async (idOrRef: number | string, options?: ReadOptions): Promise<CatalogDeleteResult> => this.#deleteOne("ratePlans", idOrRef, options),
  };

  /**
   * One delete. A number is ZimmerStack's id. A string is your own `ref`: it goes to the API as it is
   * (the address ends with `ref:` and the ref), and the API finds what it names among the hotel's room
   * types or rate plans as they are at that moment, in the same request that deletes. So a delete acts
   * on what exists now, never on a kept copy of the catalog, and it is one request.
   *
   * A ref the hotel does not hold comes back from the API as a 404. It is thrown as the usage error
   * this method always threw for it, with the same words: the call named something that is not there,
   * and nothing was deleted.
   */
  async #deleteOne(kind: "roomTypes" | "ratePlans", idOrRef: number | string, options: ReadOptions | undefined): Promise<CatalogDeleteResult> {
    const what = kind === "roomTypes" ? "room type" : "rate plan";
    const send = (target: number | { ref: string }) => (kind === "roomTypes" ? this.catalog.deleteRoomType(target, options) : this.catalog.deleteRatePlan(target, options));
    if (typeof idOrRef === "number") {
      if (!Number.isInteger(idOrRef) || idOrRef <= 0) throw new ZimmerStackUsageError(`A ${what}'s id is a whole number above 0; zs.${kind}.list() names them`);
      return send(idOrRef);
    }
    if (typeof idOrRef !== "string" || idOrRef.trim() === "") {
      throw new ZimmerStackUsageError(`zs.${kind}.delete takes the ${what}'s id (a number) or your own ref for it (a string)`);
    }
    try {
      return await send({ ref: idOrRef });
    } catch (err) {
      // Only the API's own "no such room type / rate plan". A hotel the key may not act on (PROPERTY_NOT_FOUND)
      // and every other refusal are thrown as they came.
      const notFound = kind === "roomTypes" ? "ROOM_TYPE_NOT_FOUND" : "RATE_PLAN_NOT_FOUND";
      if (!(err instanceof ZimmerStackError) || err.status !== 404 || err.code !== notFound) throw err;
      throw new ZimmerStackUsageError(`This hotel has no ${what} with the ref "${idOrRef}". zs.${kind}.list() names every one with its id and ref; a ${what} made on ZimmerStack's own screens has no ref, so delete it by its id.`);
    }
  }

  async #structure<K extends OperationKey>(operation: K, args: RequestArgs<K>): Promise<Op<K>["response"]> {
    try {
      return await this.request(operation, ...([args] as never));
    } finally {
      this.#core.catalogs.delete(this.propertyId ?? 0); // whatever happened, the catalog may have changed
    }
  }

  /** The catalog, kept ten minutes: it changes when someone adds a room type or a plan, not while a grid is open. */
  async #cachedCatalog(signal?: AbortSignal): Promise<Catalog> {
    const hit = this.#core.catalogs.get(this.propertyId ?? 0);
    if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.value;
    return this.catalog.get({ signal });
  }

  /* ── availability, rates, stay rules ── */

  /** One request per 1,000 updates / 5,000 cells, one after another. */
  async #writeAll<U extends { dateFrom: string; dateTo: string }>(
    operation: "PUT /availability" | "PUT /rates" | "PUT /restrictions",
    updates: readonly U[],
    options: WriteOptions | undefined
  ): Promise<WriteAccepted[]> {
    if (updates.length === 0) return [];
    const parts = chunk(updates);
    if (options?.idempotencyKey !== undefined && parts.length > 1 && options.idempotencyKey.length > 60) {
      throw new ZimmerStackUsageError("This write is split into several requests; give an idempotencyKey of at most 60 characters so each part can carry its own");
    }
    const accepted: WriteAccepted[] = [];
    for (const [i, part] of parts.entries()) {
      const idempotencyKey = options?.idempotencyKey === undefined ? undefined : parts.length > 1 ? `${options.idempotencyKey}-${i + 1}` : options.idempotencyKey;
      // The body carries no dryRun, so the answer is the accepted write, never a preview.
      const answer = await this.request(operation, { body: { updates: part } as never, idempotencyKey, signal: options?.signal, maxWaitSeconds: options?.maxWaitSeconds, beforeGoLive: options?.beforeGoLive });
      accepted.push(answer as WriteAccepted);
    }
    return accepted;
  }

  /**
   * The same request with `dryRun: true`: checked and judged exactly as the write, and nothing is written.
   * One preview per request the write would be split into. No idempotency key of yours is taken: the
   * server keeps none for a dry run, so the real write may carry any key afterwards.
   */
  async #previewAll<U extends { dateFrom: string; dateTo: string }>(
    operation: "PUT /availability" | "PUT /rates" | "PUT /restrictions",
    updates: readonly U[],
    options: ReadOptions | undefined
  ): Promise<WritePreview[]> {
    const previews: WritePreview[] = [];
    for (const part of chunk(updates)) {
      const answer = await this.request(operation, { body: { dryRun: true, updates: part } as never, signal: options?.signal, maxWaitSeconds: options?.maxWaitSeconds, beforeGoLive: options?.beforeGoLive });
      previews.push(previewOnly(operation, answer as WritePreview));
    }
    return previews;
  }

  readonly availability = {
    /** Rooms left to sell per room type per night, as ZimmerStack's record holds them. Up to 500 days. */
    get: (range?: { from?: string; to?: string }, options?: ReadOptions) => this.request("GET /availability", { query: range, ...options }),
    /**
     * Set rooms left to sell: absolute numbers over date ranges. Answers when the values are in
     * ZimmerStack's record (one answer per request sent; a large write is split for you).
     *
     * Each update names its room type by ZimmerStack's id (`roomTypeId`) or by your own ref
     * (`roomTypeRef`, the ref you gave it in `roomTypes.save`), one of the two. The answer is the same
     * either way. A room type made on ZimmerStack's own screens has no ref: name it by its id.
     *
     * @example
     * await zs.availability.set([{ roomTypeRef: "rt-deluxe", dateFrom: "2026-12-24", dateTo: "2026-12-26", available: 3 }]);
     */
    set: (updates: AvailabilityWrite["updates"], options?: WriteOptions) => this.#writeAll("PUT /availability", updates, options),
    /**
     * What `set` WOULD do with these updates, and nothing is written, queued or sent. The answer is a
     * `WritePreview` (`dryRun: true`), never a `WriteAccepted`: `verdict` (would-write, nothing-to-write,
     * would-refuse with the refusal a real write would get now), the ranges that would change, the ones
     * already held, the ones held after a refusal, and the same `notices` the real write carries.
     *
     * It is not a free read: it spends the minute budgets like the write it previews (one request, one
     * write, the same cells), and under a test runner a live key may not send it, like any write. It
     * counts nothing against the hour and day budgets. To read the calendar use `get`.
     *
     * @example
     * const [preview] = await zs.availability.dryRun([{ roomTypeId: 412, dateFrom: "2026-12-31", dateTo: "2026-12-31", available: 0 }]);
     * if (preview?.verdict === "would-write") await zs.availability.set(updates);
     */
    dryRun: (updates: AvailabilityWrite["updates"], options?: ReadOptions): Promise<WritePreview[]> => this.#previewAll("PUT /availability", updates, options),
    /**
     * Close one room type on a range of nights EVERYWHERE, in one call: its room count goes to 0 and
     * stop-sell is switched on for every one of its rate plans. You do not need to know the hotel's
     * plans. The count closes every rate of the room on every booking site; the stop-sell keeps it closed
     * when a cancellation puts a room back.
     *
     * READ `notReached`: every plan that is not linked or that no booking site sells, and the one thing no
     * stop-sell reaches, a rate a booking site links on its own side (only the count closes that).
     * `batches` names the writes to watch land (`zs.batches.wait`). A close is accepted while your
     * integration is paused or out of budget (`lane: true`): a hotel must never oversell.
     *
     * @example
     * const closed = await zs.availability.close({ roomTypeId: 412, dateFrom: "2026-12-30", dateTo: "2027-01-02" });
     * for (const gap of closed.notReached) console.log(gap.what, gap.reason, gap.message);
     */
    close: async (body: CloseRequest, options?: WriteOptions): Promise<CloseDone> => (await this.request("POST /availability/close", { body: realOnly("close", body), ...options })) as CloseDone,
    /** What `close` would do, and nothing is done: the same answer with `dryRun: true` and no batches. Spends the minute budgets like the close. */
    closeDryRun: async (body: CloseRequest, options?: ReadOptions): Promise<ClosePreview> =>
      previewOnly("POST /availability/close", (await this.request("POST /availability/close", { body: { ...body, dryRun: true }, ...options })) as ClosePreview),
    /**
     * Undo exactly what `close` did on these nights, and nothing else: the stop-sell is lifted on the plans
     * the close switched on (a plan that was stop-sold before stays stopped), and each night gets back the
     * count it held before. Pass `available` to put your own count on sale instead: only your software
     * knows how many rooms are free now. A night whose count changed after the close is left as it is, and
     * a night the close had not closed is skipped (`skippedNights`). A reopen opens inventory, so it waits
     * like any other write while your integration is paused.
     *
     * @example
     * const reopened = await zs.availability.reopen({ roomTypeId: 412, dateFrom: "2026-12-30", dateTo: "2027-01-02", available: 3 });
     */
    reopen: async (body: ReopenRequest, options?: WriteOptions): Promise<CloseDone> => (await this.request("POST /availability/reopen", { body: realOnly("reopen", body), ...options })) as CloseDone,
    /** What `reopen` would do, and nothing is done. */
    reopenDryRun: async (body: ReopenRequest, options?: ReadOptions): Promise<ClosePreview> =>
      previewOnly("POST /availability/reopen", (await this.request("POST /availability/reopen", { body: { ...body, dryRun: true }, ...options })) as ClosePreview),
  };

  readonly rates = {
    /** Nightly prices per rate plan, before any channel's modifier: `rate` (a decimal string in major units, with `currency` and `decimals`) beside `rateMinor` (hundredths of the major unit, in every currency). */
    get: (range?: { from?: string; to?: string }, options?: ReadOptions) => this.request("GET /rates", { query: range, ...options }),
    /**
     * Set nightly prices in MAJOR units over date ranges: a number or a decimal string with the
     * currency's own decimals (4500.5 or "4500.50"). `currency` may be left out: the hotel's own is
     * filled in. What could not be kept as sent is named in the answer's `rounded` list. Never a zero
     * price to stop selling: `restrictions.set` with stopSell closes one rate plan on a night, and
     * `availability.set` with 0 rooms closes the room type on every booking site. Each update names its
     * rate plan by ZimmerStack's id (`ratePlanId`) or by your own ref (`ratePlanRef`), one of the two.
     */
    set: async (updates: Array<Omit<RatesWrite["updates"][number], "currency"> & { currency?: string }>, options?: WriteOptions): Promise<WriteAccepted[]> => {
      if (updates.length === 0) return [];
      const currency = updates.every((u) => u.currency) ? "" : (await this.#cachedCatalog(options?.signal)).currency;
      return this.#writeAll("PUT /rates", updates.map((u) => ({ ...u, currency: u.currency ?? currency })), options);
    },
    /**
     * What `set` WOULD do with these prices, and nothing is written: a `WritePreview` per request, with what
     * would change, what is already held, what would be rounded and the notices (a plan no booking site
     * sells, an engine that will reprice). See `zs.availability.dryRun` for what it costs.
     */
    dryRun: async (updates: Array<Omit<RatesWrite["updates"][number], "currency"> & { currency?: string }>, options?: ReadOptions): Promise<WritePreview[]> => {
      if (updates.length === 0) return [];
      const currency = updates.every((u) => u.currency) ? "" : (await this.#cachedCatalog(options?.signal)).currency;
      return this.#previewAll("PUT /rates", updates.map((u) => ({ ...u, currency: u.currency ?? currency })), options);
    },
    /**
     * Send the hotel's prices to its channels again, unchanged, so nights already there pick the
     * current modifiers up. A hotel may ask a few times a day: make it a deliberate button, never
     * automatic. Watch `rates.dirtyCells` on `sync.get()` fall to 0.
     */
    resend: (options?: WriteOptions): Promise<RatesResendAccepted> => this.request("POST /rates/resend", options),
  };

  readonly restrictions = {
    /** The stay rules per rate plan per night; null = no rule set for that field. */
    get: (range?: { from?: string; to?: string }, options?: ReadOptions) => this.request("GET /restrictions", { query: range, ...options }),
    /** Set stay rules over date ranges: stopSell, closedToArrival, closedToDeparture, minStayArrival, minStayThrough, maxStay. Each update names its rate plan by `ratePlanId` or by your own ref, `ratePlanRef`. */
    set: (updates: RestrictionsWrite["updates"], options?: WriteOptions) => this.#writeAll("PUT /restrictions", updates, options),
    /**
     * What `set` WOULD do with these stay rules, and nothing is written. The notices are the point: a
     * stop-sell on one rate plan answers ROOM_STILL_ON_SALE when the room keeps selling through its other
     * plans. See `zs.availability.dryRun` for what it costs.
     *
     * @example
     * const [preview] = await zs.restrictions.dryRun([{ ratePlanId: 901, dateFrom: "2026-12-31", dateTo: "2026-12-31", stopSell: true }]);
     * for (const notice of noticesOf(preview)) console.log(notice.code, notice.message, notice.action);
     */
    dryRun: (updates: RestrictionsWrite["updates"], options?: ReadOptions): Promise<WritePreview[]> => this.#previewAll("PUT /restrictions", updates, options),
  };

  /* ── one night's whole story ── */

  readonly explain = {
    /**
     * Explain one night of one room type (optionally one of its rate plans), from ZimmerStack's record:
     * what your software last sent, what the record holds and who set it, what the channel manager was
     * last seen holding, every send still on file and how it ended, a held value in the channel manager's
     * own words, which connections sell each plan, the rules in force, the bookings that moved the count
     * (ids and times, never a guest), and `summary`: the same in plain sentences, for a person.
     *
     * What it cannot know: it reads the channel manager's copy as last seen, never a booking site's own
     * screen. `seenAt: null` means that night was never read back; `lastSent: null` means the write is older
     * than the ones whose values are kept (`searched` says how far it looked); `channels.known: false` means
     * the hotel's connections have not been read yet. Scope ari:read; it calls no channel, so ask freely.
     *
     * Name the room type by ZimmerStack's id (`roomTypeId`) or by your own ref (`roomTypeRef`), one of the
     * two; the rate plan, when you name one, by `ratePlanId` or by `ratePlanRef`.
     *
     * @example
     * const night = await zs.explain.night({ roomTypeId: 412, date: "2026-12-31" });
     * for (const sentence of night.summary) console.log(sentence);
     */
    night: (
      query: { date: string } & ({ roomTypeId: number; roomTypeRef?: never } | { roomTypeRef: string; roomTypeId?: never }) & ({ ratePlanId?: number; ratePlanRef?: never } | { ratePlanRef?: string; ratePlanId?: never }),
      options?: ReadOptions
    ): Promise<Explain> => this.request("GET /explain", { query, ...options }),
  };

  /* ── has it reached the channels? ── */

  readonly sync = {
    /** How far what you sent has travelled: cells still on their way, the last error, where the integration stands. */
    get: (options?: ReadOptions) => this.request("GET /sync", options),
  };

  readonly batches = {
    /** One write, by the `batchId` its answer carried. */
    get: (batchId: string, options?: ReadOptions) => this.request("GET /batches/{batchId}", { path: { batchId }, ...options }),
    /**
     * Wait for a write to reach the channels, asking no more often than every 15 seconds, for at most
     * five minutes. Returns the last status: if it is still "pending", say "still syncing" and let the
     * person look again later. Availability lands in seconds; a full calendar of prices takes minutes.
     */
    wait: async (batchId: string, options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {}): Promise<BatchStatus> => {
      const interval = Math.max(15_000, options.intervalMs ?? 15_000);
      const deadline = Date.now() + (options.timeoutMs ?? 5 * 60_000);
      for (;;) {
        const batch = await this.batches.get(batchId, { signal: options.signal });
        if (batch.status !== "pending" || Date.now() + interval > deadline) return batch;
        await sleep(interval, options.signal);
      }
    },
  };

  /* ── channels and what each is sent ── */

  readonly channels = {
    /**
     * The connected channels (Booking.com, MakeMyTrip, …), each with the price modifier it holds:
     * `[]` = prices go as they are; `null` = a rule set by hand that this API cannot express.
     */
    list: (options?: ReadOptions) => this.request("GET /channels", options),
    /**
     * Replace a channel's modifier with these steps (`[]` removes it). Needs the scope
     * channel-modifiers:write.
     *
     * ONE CALL MOVES EVERY PRICE ON THAT CHANNEL. Call it when a person saved the setting; never from
     * a loop, a timer or a test against a live key. The channel manager then sends that channel every
     * date again, so prices already on sale move within minutes; no `rates.resend` is needed.
     */
    setModifier: (channelId: string, steps: ModifierStep[], options?: WriteOptions): Promise<ModifierResult> =>
      this.request("PUT /channels/{channelId}/modifier", { path: { channelId }, body: { steps }, ...options }),
    /**
     * A full sync of ONE channel: the channel manager sends that channel everything it holds again, room
     * counts, prices and stay rules, for every date. Nothing of your own numbers is sent and none of them
     * changes. Use it when one channel shows something the channel manager does not hold. It is not
     * `rates.resend`, which sends YOUR prices to the channel manager again. Needs the scope ari:write.
     *
     * A channel takes one full sync an hour, whoever started the last one: one the hotel's owner started in
     * ZimmerStack counts too. Inside the hour this throws a ZimmerStackError with code RATE_LIMITED and scope
     * "full-sync-hour"; `retryAfterSeconds` says how long to wait. A paused channel is CHANNEL_PAUSED. On a
     * sandbox nothing is sent: `started` is false and `notice` says why. Make it a deliberate button, never
     * automatic and never on a timer.
     *
     * @example
     * const sync = await zs.channels.fullSync(channelId);
     * if (sync.started) console.log("Sent. The next full sync of this channel is taken at", sync.nextAt);
     */
    fullSync: (channelId: string, options?: WriteOptions): Promise<FullSyncResult> => this.request("POST /channels/{channelId}/full-sync", { path: { channelId }, ...options }),
    /**
     * The same full sync on EVERY channel of the hotel, one after another. The answer has one line for each
     * channel: `started: true`, or a `code` that says why not (RATE_LIMITED with `retryAt` when that channel
     * had one within the last hour, CHANNEL_PAUSED, CHANNEL_NOT_FOUND, CHANNEL_MANAGER_ERROR). One channel
     * that cannot go never stops the others, and none of this throws: read `channels`. `started` counts the
     * ones that began. On a sandbox nothing is sent: `channels` is empty and `notice` says why.
     *
     * @example
     * const sync = await zs.channels.fullSyncAll();
     * for (const line of sync.channels) if (!line.started) console.log(line.channelId, line.code, line.retryAt ?? "");
     */
    fullSyncAll: (options?: WriteOptions): Promise<PropertyFullSyncResult> => this.request("POST /full-sync", options),
  };

  /* ── bookings from your own booking engine ── */

  readonly bookings = {
    /** Bookings this integration created, newest first. */
    list: (query?: Op<"GET /bookings">["query"], options?: ReadOptions) => this.request("GET /bookings", { query, ...options }),
    /**
     * Create a booking in the hotel's PMS. Always send `externalReference` (your own reservation id):
     * the same value returns the same booking, which makes every retry safe.
     */
    create: (body: BookingCreate, options?: WriteOptions): Promise<Booking> => this.request("POST /bookings", { body, ...options }),
    get: (bookingId: number, options?: ReadOptions) => this.request("GET /bookings/{bookingId}", { path: { bookingId }, ...options }),
    /** Cancel a booking this integration created; its nights open again on the channels. */
    cancel: (bookingId: number, body: BookingCancel = {}, options?: WriteOptions) => this.request("POST /bookings/{bookingId}/cancel", { path: { bookingId }, body, ...options }),
  };

  /* ── bookings the OTAs sent ── */

  readonly channelBookings = {
    /** OTA bookings the channel manager delivered, in the webhook's shape. Follow `nextCursor`, or use `all`. */
    list: (query?: Op<"GET /channel-bookings">["query"], options?: ReadOptions) => this.request("GET /channel-bookings", { query, ...options }),
    get: (bookingId: number, options?: ReadOptions) => this.request("GET /channel-bookings/{bookingId}", { path: { bookingId }, ...options }),
    /**
     * Every OTA booking changed since `since`, page by page, for reconciling what your webhook missed.
     *
     * @example
     * for await (const booking of zs.channelBookings.all({ since: lastSeen })) save(booking);
     */
    all: (query?: Omit<NonNullable<Op<"GET /channel-bookings">["query"]>, "cursor">, options?: ReadOptions): AsyncGenerator<ChannelBooking, void, undefined> =>
      this.#allPages((cursor) => this.channelBookings.list({ limit: 100, ...query, cursor }, options)),
  };

  /* ── bookings guests made on the hotel's own website (our booking engine) ── */

  readonly directBookings = {
    /**
     * Website bookings, in the webhook's shape (`direct.booking.*`), cancellations and no-shows included. Scope
     * `direct-bookings:read`. Follow `nextCursor`, or use `all`.
     */
    list: (query?: Op<"GET /direct-bookings">["query"], options?: ReadOptions) => this.request("GET /direct-bookings", { query, ...options }),
    get: (bookingId: number, options?: ReadOptions) => this.request("GET /direct-bookings/{bookingId}", { path: { bookingId }, ...options }),
    /**
     * Every website booking changed since `since`, page by page. A PMS that pushes room counts reads this
     * before a full push, so the sold rooms are in its own calendar first.
     *
     * @example
     * for await (const booking of zs.directBookings.all({ since: lastSeen })) applyToMyCalendar(booking);
     */
    all: (query?: Omit<NonNullable<Op<"GET /direct-bookings">["query"]>, "cursor">, options?: ReadOptions): AsyncGenerator<ChannelBooking, void, undefined> =>
      this.#allPages((cursor) => this.directBookings.list({ limit: 100, ...query, cursor }, options)),
    /**
     * Cancel a whole website booking that is still UPCOMING, and say what the guest gets back. Scope
     * `direct-bookings:cancel`, granted on its own and never by default.
     *
     * `refund`: `"policy"` (the default) is what the booking's own cancellation policy gives back now, as
     * if the guest cancelled on the booking page; `"full"` is everything the guest paid online (the hotel
     * is at fault: an overbooking); `"none"` moves no money (the hotel settles it another way). The refund
     * goes back to the guest's online payment and never exceeds it. The answer's `refund` says how much
     * and where it stands (NONE, PENDING, PROCESSED, MANUAL).
     *
     * IT MOVES A GUEST'S MONEY. Call it from a person's own cancel button, with the refund they chose;
     * never from a loop, a sync job or a test against a live key. A booking already cancelled answers
     * `replay: true` and moves no money; checked in, checked out or a no-show is BOOKING_NOT_CANCELLABLE.
     * Your own cancel comes back as `direct.booking.cancelled` ("Cancelled by the hotel"): treat it as
     * already applied. The call carries an idempotency key (yours, or one the client makes) and a retry
     * after a network failure reuses it, so a cancel never lands twice; pass your own `idempotencyKey`
     * when a retry may come from another process.
     *
     * @example
     * const { refund } = await zs.directBookings.cancel(bookingId, { refund: "full", reason: "Overbooked" });
     */
    cancel: (bookingId: number, body: DirectBookingCancel = {}, options?: WriteOptions): Promise<DirectBookingCancelResult> =>
      this.request("POST /direct-bookings/{bookingId}/cancel", { path: { bookingId }, body, ...options }),
  };

  /** Follow a booking list's `nextCursor` to its last page. */
  #allPages(read: (cursor: string | undefined) => Promise<{ items: ChannelBooking[]; nextCursor?: string | null }>): AsyncGenerator<ChannelBooking, void, undefined> {
    return this.#pages(read);
  }

  /** Follow any list's `nextCursor` to its last page. A list that says `more: false` is at its end, whatever cursor it hands back. */
  async *#pages<T>(read: (cursor: string | undefined) => Promise<{ items: T[]; more?: boolean; nextCursor?: string | null }>): AsyncGenerator<T, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await read(cursor);
      yield* page.items;
      cursor = page.more === false ? undefined : (page.nextCursor ?? undefined);
    } while (cursor);
  }

  /* ── the sandbox (zsk_test_ keys only) ── */

  readonly sandbox = {
    bookings: {
      list: (options?: ReadOptions) => this.request("GET /sandbox/bookings", options),
      /**
       * Pretend an OTA booked: the booking, the availability moved down, and the real webhook to your endpoint.
       * With `otaName: "Website"` it pretends a guest booked on the hotel's own website instead, and the webhook
       * is `direct.booking.created`.
       */
      create: (body: SandboxBookingCreate, options?: WriteOptions) => this.request("POST /sandbox/bookings", { body, ...options }),
      cancel: (bookingId: number, options?: WriteOptions) => this.request("POST /sandbox/bookings/{bookingId}/cancel", { path: { bookingId }, ...options }),
      modify: (bookingId: number, body: SandboxBookingModify, options?: WriteOptions) => this.request("POST /sandbox/bookings/{bookingId}/modify", { path: { bookingId }, body, ...options }),
      /**
       * Pretend the hotel recorded that a WEBSITE booking's guest did not arrive (one made with
       * `otaName: "Website"`): the stay and its rooms go NOSHOW, the nights come back on the sandbox's
       * availability, and your endpoint receives the real `direct.booking.modified`. `{ undo: true }` takes
       * it back. The booking is not cancelled.
       */
      noShow: (bookingId: number, body: SandboxNoShow = {}, options?: WriteOptions): Promise<SandboxBooking> =>
        this.request("POST /sandbox/bookings/{bookingId}/no-show", { path: { bookingId }, body, ...options }),
    },
    syncEvents: {
      /**
       * Pretend a channel problem, or its end: the real `channel.sync.alert` or `channel.sync.recovered`
       * to your endpoint, and a line in the event log. `event` says which problem (rate_error when left
       * out); the problem sits on one of the sandbox's pretend channels and `zs.channels.list()` shows it
       * until a recovered clears it.
       *
       * @example
       * await zs.sandbox.syncEvents.create({ type: "channel.sync.alert", event: "disconnect_channel" });
       * await zs.sandbox.syncEvents.create({ type: "channel.sync.recovered" });
       */
      create: (body: SandboxSyncEvent, options?: WriteOptions): Promise<SandboxSyncEventView> => this.request("POST /sandbox/sync-events", { body, ...options }),
    },
    faults: {
      /** The fault in force on this sandbox's pretend channel; `active: false` when there is none. */
      get: (options?: ReadOptions): Promise<SandboxFaultView> => this.request("GET /sandbox/faults", options),
      /**
       * Make the sandbox's pretend channel misbehave, to watch your software meet a bad day: `refuse` (the
       * next `values` nights of prices or stay rules are refused, with your `message` as the channel
       * manager's words), `throttle` ("too many requests" for `minutes`) or `outage` (no answer for
       * `minutes`). One fault at a time: a new one replaces it. Prices and stay rules only: room counts land
       * as before. The answer's `watch` says what to do next and what you should then see, step by step.
       *
       * @example
       * const fault = await zs.sandbox.faults.set({ kind: "refuse", values: 2, message: "Rate is below the channel's minimum" });
       * for (const step of fault.watch) console.log(step);
       */
      set: (body: SandboxFault, options?: WriteOptions): Promise<SandboxFaultView> => this.request("POST /sandbox/faults", { body, ...options }),
      /** End the fault: the pretend channel answers normally from the next push. Values already held stay held until a different value is sent. */
      clear: (options?: ReadOptions): Promise<SandboxFaultView> => this.request("DELETE /sandbox/faults", options),
    },
  };

  /* ── the rate grid ── */

  readonly grid = {
    /**
     * The whole grid for a window, ready for a screen: rows are room types with their rate plans,
     * columns are nights. Three reads (four the first time). A window may span 500 days; a screen
     * needs 14 to 60.
     */
    load: async (from: string, to: string, options?: ReadOptions): Promise<Grid> => {
      const query = { from, to };
      const [catalog, availability, rates, restrictions] = await Promise.all([
        this.#cachedCatalog(options?.signal),
        this.availability.get(query, options),
        this.rates.get(query, options),
        this.restrictions.get(query, options),
      ]);
      return buildGrid({ from, to, catalog, availability, rates, restrictions });
    },
    /**
     * Save what a person changed: single nights in, the fewest ranges out, one request per resource,
     * one after another. Each answer carries a `batchId`: the values are in ZimmerStack's record and
     * on their way to the channels.
     */
    save: async (edits: GridEdits, options?: { signal?: AbortSignal; beforeGoLive?: boolean }): Promise<WriteAccepted[]> => {
      const accepted: WriteAccepted[] = [];
      if (edits.availability?.length) {
        const ranges = toRanges(edits.availability.map((e) => ({ id: e.roomTypeId, date: e.date, value: e.available })));
        accepted.push(...(await this.availability.set(ranges.map((r) => ({ roomTypeId: r.id, dateFrom: r.dateFrom, dateTo: r.dateTo, available: r.value })), options)));
      }
      if (edits.rates?.length) {
        const ranges = toRanges(edits.rates.map((e) => ({ id: e.ratePlanId, date: e.date, value: e.rate })));
        accepted.push(...(await this.rates.set(ranges.map((r) => ({ ratePlanId: r.id, dateFrom: r.dateFrom, dateTo: r.dateTo, rate: r.value })), options)));
      }
      if (edits.restrictions?.length) {
        const ranges = toRanges(edits.restrictions.map(({ ratePlanId, date, ...rules }) => ({ id: ratePlanId, date, value: rules })));
        accepted.push(...(await this.restrictions.set(ranges.map((r) => ({ ratePlanId: r.id, dateFrom: r.dateFrom, dateTo: r.dateTo, ...r.value })), options)));
      }
      return accepted;
    },
  };
}
