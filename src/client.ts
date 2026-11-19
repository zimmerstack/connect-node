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
  type Booking,
  type BookingCancel,
  type BookingCreate,
  type Catalog,
  type CatalogDeleteResult,
  type CatalogUpsertResult,
  type ChannelBooking,
  type DirectBookingCancel,
  type DirectBookingCancelResult,
  type ModifierResult,
  type OperationKey,
  type Operations,
  type PropertyCreate,
  type PropertyCreated,
  type PropertyRemoved,
  type RatePlansUpsert,
  type RatesResendAccepted,
  type RatesWrite,
  type RestrictionsWrite,
  type RoomTypesUpsert,
  type SandboxBookingCreate,
  type SandboxBookingModify,
  type WriteAccepted,
} from "./generated.ts";
import { buildGrid, chunk, toRanges, type Grid, type GridEdits, type ModifierStep } from "./grid.ts";

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
  /** The longest the client waits for a budget before giving the refusal back to you. Default 120 s. */
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
  | { type: "pace"; operation: string; waitMs: number };

/** Per-call options of a write. */
export interface WriteOptions {
  /**
   * Your own key for this write (10 to 64 of A–Z a–z 0–9 _ -), when a retry may come from another
   * process: the same key with the same body within 7 days replays the first answer instead of
   * writing twice. Without one the client makes a fresh key and reuses it on its own retries.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ReadOptions {
  signal?: AbortSignal;
}

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

type Op<K extends OperationKey> = Operations[K];
/** What `request` takes for an operation: its path values, its query, its body. */
export type RequestArgs<K extends OperationKey> = (Op<K>["path"] extends undefined ? { path?: undefined } : { path: Op<K>["path"] }) &
  (Op<K>["query"] extends undefined ? { query?: undefined } : { query?: Op<K>["query"] }) &
  (Op<K>["body"] extends undefined ? { body?: undefined } : { body: Op<K>["body"] }) &
  WriteOptions;

/* ───────────────────────────── the shared core ───────────────────────────── */

/** Requests in flight at once. Writes go one at a time on top of that. */
const PARALLEL = 4;
const KEY_SHAPE = /^zsk_(live|test)_[A-Za-z0-9_-]{16,}$/;
const IDEMPOTENCY_SHAPE = /^[A-Za-z0-9_-]{10,64}$/;
/** After one of these the key will never work again: every later call is refused here, not sent. */
const KEY_IS_DEAD = new Set(["API_KEY_INVALID", "API_KEY_REVOKED", "API_KEY_EXPIRED"]);
const CATALOG_TTL_MS = 10 * 60_000;

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

interface Wire {
  operation: string;
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string | undefined;
  write: boolean;
  /** May it be sent again after a failure whose outcome is unknown (a network error, a 5xx)? */
  resendable: boolean;
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

  #resumeAll = 0;
  #resumeWrites = 0;
  #active = 0;
  readonly #queue: Array<() => void> = [];
  #writeTail: Promise<unknown> = Promise.resolve();
  #dead: ZimmerStackError | undefined;
  readonly catalogs = new Map<number, { at: number; value: Catalog }>();
  /** A sandbox company key's one hotel, found once when a call asked for a hotel and none was named. */
  soleSandboxProperty: Promise<number | undefined> | undefined;
  /** The same, once known: sent with every later call that names no hotel, so the refusal is met once. */
  soleSandboxId: number | undefined;

  constructor(options: ZimmerStackOptions) {
    const g = globalThis as { window?: { document?: unknown }; navigator?: { product?: string } };
    if ((typeof g.window !== "undefined" && typeof g.window.document !== "undefined") || g.navigator?.product === "ReactNative") {
      throw new ZimmerStackUsageError(
        "@zimmerstack/connect runs on a server only. A key in a browser or a mobile app can be read by anyone and can change a hotel's prices on every channel: call your own server from here, and ZimmerStack from your server (https://docs.zimmerstack.com/sdk#no-server shows the smallest one). If a key was built into this page, anyone can read it now: revoke it and make a new one."
      );
    }
    const key = options.apiKey ?? env("ZIMMERSTACK_CONNECT_KEY");
    if (!key) throw new ZimmerStackUsageError("No API key: set the environment variable ZIMMERSTACK_CONNECT_KEY (zsk_test_… while you build) on your server");
    const shape = KEY_SHAPE.exec(key.trim());
    if (!shape) throw new ZimmerStackUsageError("The API key does not look like a ZimmerStack key (zsk_test_… or zsk_live_…). It was not sent anywhere.");
    this.#key = key.trim();
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
    // Writes go one after another: a burst spends the write budget at once, and two writes to one
    // night must reach the record in the order they were made.
    const run = () => this.#attempts(wire);
    const result = this.#writeTail.then(run, run);
    this.#writeTail = result.catch(() => undefined);
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

  /** Wait until the budgets the last answers reported have room again, instead of earning a 429. */
  async #pace(wire: Wire): Promise<void> {
    for (;;) {
      const wait = Math.max(this.#resumeAll, wire.write ? this.#resumeWrites : 0) - Date.now();
      if (wait <= 0) return;
      this.#emit({ type: "pace", operation: wire.operation, waitMs: wait });
      await sleep(wait, wire.signal);
    }
  }

  /** RateLimit: "key";r=117;t=42, "key-writes";r=29;t=42  (r = requests left, t = seconds until the window has room). */
  #notePace(res: Response): void {
    for (const part of (res.headers.get("ratelimit") ?? "").split(",")) {
      const left = /;\s*r=(\d+)/.exec(part);
      const refill = /;\s*t=(\d+)/.exec(part);
      if (!left || !refill || Number(left[1]) > PARALLEL) continue;
      const at = Date.now() + Math.min(Number(refill[1]), 65) * 1000;
      if (/"[^"]*(writes|bookings|cells)[^"]*"/.test(part)) this.#resumeWrites = Math.max(this.#resumeWrites, at);
      else this.#resumeAll = Math.max(this.#resumeAll, at);
    }
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
      this.#notePace(res);
      this.#emit({ type: "response", operation: wire.operation, status: res.status, attempt, ms: Date.now() - started });

      if (res.ok) return json && typeof json === "object" ? json.data : undefined;

      const data = (json && typeof json.data === "object" && json.data !== null ? json.data : {}) as Record<string, unknown>;
      const code = typeof data.code === "string" ? data.code : `HTTP_${res.status}`;
      const headerSeconds = Number(res.headers.get("retry-after"));
      const retryAfter = Number.isFinite(headerSeconds) && headerSeconds > 0 ? headerSeconds : typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : undefined;
      // What passes with time: a used-up budget, a fault on ZimmerStack's side, a duplicate of a request
      // still running. Every other answer is a verdict on the request itself.
      const passesWithTime = res.status === 429 || res.status >= 500 || code === "IDEMPOTENCY_IN_FLIGHT";
      const error = new ZimmerStackError({
        status: res.status,
        code,
        message: typeof json?.message === "string" && json.message ? json.message : `${wire.operation} answered ${res.status}`,
        operation: wire.operation,
        details: data.details,
        scope: typeof data.scope === "string" ? data.scope : undefined,
        retryAfterSeconds: retryAfter,
        retryable: passesWithTime,
      });
      if (KEY_IS_DEAD.has(code)) {
        this.#dead = error;
        throw error;
      }
      // A 429 was refused before anything ran, so sending it again is always safe. A 5xx may have run.
      const safeToResend = res.status === 429 || code === "IDEMPOTENCY_IN_FLIGHT" || wire.resendable;
      // A long Retry-After (an hourly or daily budget, a pause) is not worth holding a request open for.
      if (!passesWithTime || !safeToResend || attempt > this.#maxRetries || (retryAfter ?? 0) > this.#maxWaitSeconds) throw error;
      const waitMs = ((retryAfter ?? 2 ** (attempt - 1)) + Math.random()) * 1000;
      this.#emit({ type: "retry", operation: wire.operation, attempt, waitMs, reason: code });
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
   * A software vendor's company key: the same client, acting on one hotel. Shares this client's pace,
   * so make as many as you have hotels.
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
    const args = (rest[0] ?? {}) as { path?: Record<string, string | number>; query?: Record<string, unknown>; body?: unknown } & WriteOptions;
    const meta = OPERATIONS[operation];
    if (!meta) throw new ZimmerStackUsageError(`"${operation}" is not an operation of the Connect API`);
    const [method = "", template = ""] = operation.split(" ");
    const path = template.replace(/\{(\w+)\}/g, (_m, name: string) => {
      const value = args.path?.[name];
      if (value === undefined || value === null || String(value) === "") throw new ZimmerStackUsageError(`${operation} needs ${name}`);
      return encodeURIComponent(String(value));
    });
    const url = new URL(this.#core.base + API_PREFIX + path);
    for (const [name, value] of Object.entries(args.query ?? {})) if (value !== undefined && value !== null) url.searchParams.set(name, String(value));

    const headers: Record<string, string> = { authorization: this.#core.authorization(), accept: "application/json", "user-agent": `zimmerstack-connect-node/${SDK_VERSION}` };
    // Adding a hotel and removing one name no hotel in the header: the one to add does not exist yet, and the
    // one to remove is in the path. Listing them sends the header only when this client was made for one hotel.
    const aboutTheList = operation === "POST /properties" || operation === "DELETE /properties/{propertyId}";
    const hotel = aboutTheList ? undefined : (this.propertyId ?? (operation === "GET /properties" ? undefined : this.#core.soleSandboxId));
    if (hotel) headers[PROPERTY_HEADER] = String(hotel);
    const body = args.body === undefined ? undefined : JSON.stringify(args.body);
    if (body !== undefined) headers["content-type"] = "application/json";
    if (meta.idempotent) {
      // One key per write, reused on every retry of it, so a write that timed out can never land twice.
      if (args.idempotencyKey !== undefined && !IDEMPOTENCY_SHAPE.test(args.idempotencyKey)) {
        throw new ZimmerStackUsageError("idempotencyKey must be 10 to 64 characters of A-Z a-z 0-9 _ -");
      }
      headers[IDEMPOTENCY_HEADER] = args.idempotencyKey ?? crypto.randomUUID();
    }
    const wire = { operation, method, url, headers, body, write: method !== "GET", resendable: method === "GET" || meta.idempotent, signal: args.signal };
    try {
      return (await this.#core.send(wire)) as Op<K>["response"];
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
      return (await this.#core.send({ ...wire, headers: { ...headers, [PROPERTY_HEADER]: String(sole) } })) as Op<K>["response"];
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
    /** Delete a room type; its rate plans go with it. */
    deleteRoomType: (roomTypeId: number, options?: ReadOptions) => this.#structure("DELETE /catalog/room-types/{roomTypeId}", { path: { roomTypeId }, ...options }),
    /** Create or change rate plans by your own `ref`. */
    upsertRatePlans: (body: RatePlansUpsert, options?: WriteOptions) => this.#structure("PUT /catalog/rate-plans", { body, ...options }),
    /** Delete a rate plan. Refused while a channel still sells it. */
    deleteRatePlan: (ratePlanId: number, options?: ReadOptions) => this.#structure("DELETE /catalog/rate-plans/{ratePlanId}", { path: { ratePlanId }, ...options }),
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
    delete: async (idOrRef: number | string, options?: ReadOptions): Promise<CatalogDeleteResult> =>
      this.catalog.deleteRoomType(await this.#structureId("roomTypes", idOrRef, options?.signal), options),
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
    delete: async (idOrRef: number | string, options?: ReadOptions): Promise<CatalogDeleteResult> =>
      this.catalog.deleteRatePlan(await this.#structureId("ratePlans", idOrRef, options?.signal), options),
  };

  /**
   * The id a delete acts on. A number is ZimmerStack's id already. A string is your own `ref`: it is
   * looked up in a fresh read of the catalog, never a kept copy, because a delete must act on what
   * exists now.
   */
  async #structureId(kind: "roomTypes" | "ratePlans", idOrRef: number | string, signal: AbortSignal | undefined): Promise<number> {
    const what = kind === "roomTypes" ? "room type" : "rate plan";
    if (typeof idOrRef === "number") {
      if (!Number.isInteger(idOrRef) || idOrRef <= 0) throw new ZimmerStackUsageError(`A ${what}'s id is a whole number above 0; zs.${kind}.list() names them`);
      return idOrRef;
    }
    if (typeof idOrRef !== "string" || idOrRef.trim() === "") {
      throw new ZimmerStackUsageError(`zs.${kind}.delete takes the ${what}'s id (a number) or your own ref for it (a string)`);
    }
    const hit = (await this.catalog.get({ signal }))[kind].find((entity) => entity.ref === idOrRef);
    if (!hit) {
      throw new ZimmerStackUsageError(`This hotel has no ${what} with the ref "${idOrRef}". zs.${kind}.list() names every one with its id and ref; a ${what} made on ZimmerStack's own screens has no ref, so delete it by its id.`);
    }
    return hit.id;
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
      accepted.push(await this.request(operation, { body: { updates: part } as never, idempotencyKey, signal: options?.signal }));
    }
    return accepted;
  }

  readonly availability = {
    /** Rooms left to sell per room type per night, as ZimmerStack's record holds them. Up to 500 days. */
    get: (range?: { from?: string; to?: string }, options?: ReadOptions) => this.request("GET /availability", { query: range, ...options }),
    /**
     * Set rooms left to sell: absolute numbers over date ranges. Answers when the values are in
     * ZimmerStack's record (one answer per request sent; a large write is split for you).
     */
    set: (updates: AvailabilityWrite["updates"], options?: WriteOptions) => this.#writeAll("PUT /availability", updates, options),
  };

  readonly rates = {
    /** Nightly prices per rate plan, in MINOR units (`rateMinor`), before any channel's modifier. */
    get: (range?: { from?: string; to?: string }, options?: ReadOptions) => this.request("GET /rates", { query: range, ...options }),
    /**
     * Set nightly prices in MAJOR units over date ranges (4500 = ₹4,500.00). `currency` may be left
     * out: the hotel's own is filled in. To close a night use `restrictions.set` with stopSell,
     * never a zero price.
     */
    set: async (updates: Array<Omit<RatesWrite["updates"][number], "currency"> & { currency?: string }>, options?: WriteOptions): Promise<WriteAccepted[]> => {
      if (updates.length === 0) return [];
      const currency = updates.every((u) => u.currency) ? "" : (await this.#cachedCatalog(options?.signal)).currency;
      return this.#writeAll("PUT /rates", updates.map((u) => ({ ...u, currency: u.currency ?? currency })), options);
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
    /** Set stay rules over date ranges: stopSell, closedToArrival, closedToDeparture, minStayArrival, minStayThrough, maxStay. */
    set: (updates: RestrictionsWrite["updates"], options?: WriteOptions) => this.#writeAll("PUT /restrictions", updates, options),
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
     * ONE CALL MOVES EVERY PRICE SENT TO THAT CHANNEL FROM THEN ON. Call it when a person saved the
     * setting; never from a loop, a timer or a test against a live key. Prices already on the channel
     * stay as they are until those nights are sent again (`rates.resend`).
     */
    setModifier: (channelId: string, steps: ModifierStep[], options?: WriteOptions): Promise<ModifierResult> =>
      this.request("PUT /channels/{channelId}/modifier", { path: { channelId }, body: { steps }, ...options }),
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
    cancel: (bookingId: number, body: BookingCancel = {}, options?: ReadOptions) => this.request("POST /bookings/{bookingId}/cancel", { path: { bookingId }, body, ...options }),
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
     * Website bookings, in the webhook's shape (`direct.booking.*`), cancellations included. Scope
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
  async *#allPages(read: (cursor: string | undefined) => Promise<{ items: ChannelBooking[]; nextCursor?: string | null }>): AsyncGenerator<ChannelBooking, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await read(cursor);
      yield* page.items;
      cursor = page.nextCursor ?? undefined;
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
      cancel: (bookingId: number, options?: ReadOptions) => this.request("POST /sandbox/bookings/{bookingId}/cancel", { path: { bookingId }, ...options }),
      modify: (bookingId: number, body: SandboxBookingModify, options?: ReadOptions) => this.request("POST /sandbox/bookings/{bookingId}/modify", { path: { bookingId }, body, ...options }),
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
    save: async (edits: GridEdits, options?: { signal?: AbortSignal }): Promise<WriteAccepted[]> => {
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
