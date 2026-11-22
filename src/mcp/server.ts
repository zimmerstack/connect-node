import { ZimmerStack, aboutHowLong } from "../client.ts";
import { diagnose, formatDoctorReport } from "../doctor.ts";
import { ZimmerStackError, ZimmerStackUsageError } from "../errors.ts";
import { addDays } from "../grid.ts";
import { OPERATIONS, SDK_VERSION, type CloseResult, type OperationKey, type WritePreview } from "../generated.ts";
import { noticesOf, noticesOmittedFrom } from "../notices.ts";
import { RULES } from "./reference.generated.ts";
import { TOPICS, describeOperation, describeTopic, describeType, findOperation, referenceIndex, searchReference } from "./reference.ts";

/**
 * The package's MCP server: the tools a developer's coding agent can call while it builds on the
 * Connect API. It runs on the developer's own machine, over stdin and stdout (src/mcp/cli.ts).
 *
 *   zimmerstack_rules             the rules for building on the API (this package's AGENTS.md)
 *   zimmerstack_reference         look up an operation, a type, a topic, or search, from the contract
 *   zimmerstack_sandbox_read      one read on the project's SANDBOX
 *   zimmerstack_sandbox_write     one write on the project's SANDBOX
 *   zimmerstack_doctor            the doctor's checks on the sandbox key: what is wrong, and what to do
 *   zimmerstack_sandbox_limits    every budget the sandbox key sits under, and how full each is
 *   zimmerstack_sandbox_events    the sandbox's ordered event log, from a sequence
 *   zimmerstack_sandbox_simulate  make one real event of any type on the sandbox
 *   zimmerstack_sandbox_explain   one night of one room type on the sandbox, explained
 *   zimmerstack_sandbox_dry_run   what a write to the sandbox would do, with nothing written
 *   zimmerstack_sandbox_fault     make the sandbox's pretend channel refuse, throttle or go down; end it; read it
 *   zimmerstack_sandbox_close     close a room type on the sandbox everywhere, or reopen it
 *
 * Every tool that calls the API uses a zsk_test_ key and nothing else: a sandbox is a copy of a hotel's rooms
 * and plans that no booking site ever sees. A live key is refused before anything is sent, so an agent
 * can never change a real hotel through this server, whatever it is asked. Every call goes through the
 * package's own client, so the pacing, retry and idempotency rules hold here too.
 *
 * Transport-free on purpose: `handle` takes one decoded JSON-RPC message and returns the answer, if the
 * message expects one. The tests call it directly.
 */

export interface McpServerOptions {
  /** The key the project holds, if any. Only a zsk_test_ key is ever used; a live one is never sent. */
  apiKey?: string | undefined;
  /** Where that key was found ("the environment", ".env.local"), for the messages. */
  keySource?: string | undefined;
  /** For tests: a stand-in for the API. */
  fetch?: typeof fetch | undefined;
  baseUrl?: string | undefined;
}

/** The protocol revisions this server speaks, newest first. A client asking for another gets the newest. */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_TEXT = 24_000;

const READS = (Object.keys(OPERATIONS) as OperationKey[]).filter((key) => key.startsWith("GET "));
const WRITES = (Object.keys(OPERATIONS) as OperationKey[]).filter((key) => !key.startsWith("GET "));

const INSTRUCTIONS =
  "Tools for building on the ZimmerStack Connect API, a hotel's channel manager: what is written through it reaches booking sites such as Booking.com within a minute. " +
  "Before writing code that calls ZimmerStack, call zimmerstack_rules once and follow it. " +
  "Look up routes, fields, limits and error codes with zimmerstack_reference instead of guessing: if it is not there, it does not exist. " +
  "zimmerstack_sandbox_read and zimmerstack_sandbox_write call the API with the project's sandbox key (zsk_test_…) only. Nothing they send reaches a booking site, and they refuse a live key. " +
  "When a call is refused or a webhook does not arrive, call zimmerstack_doctor before guessing. zimmerstack_sandbox_simulate makes a real booking or channel event on the sandbox, and zimmerstack_sandbox_events reads the ordered log your code should keep its place in. " +
  "Before writing code that sends prices, room counts or stay rules, try the body with zimmerstack_sandbox_dry_run and read its notices: they say what the write would NOT do. zimmerstack_sandbox_explain tells one night's whole story, zimmerstack_sandbox_close closes or reopens a room type everywhere, and zimmerstack_sandbox_fault makes the sandbox's pretend channel fail so the code that handles a refused value or an outage can be tried.";

const objectOf = (description: string) => ({ type: "object", description, additionalProperties: true });

/** The events a sandbox can make, as zimmerstack_sandbox_simulate names them. */
const SIMULATIONS = [
  "channel.booking.created",
  "channel.booking.modified",
  "channel.booking.cancelled",
  "channel.booking.cancelled (no booking before it)",
  "direct.booking.created",
  "direct.booking.modified (no-show)",
  "direct.booking.modified (no-show undone)",
  "direct.booking.cancelled",
  "channel.sync.alert",
  "channel.sync.recovered",
] as const;
type Simulation = (typeof SIMULATIONS)[number];
const PROBLEMS = ["rate_error", "sync_error", "disconnect_channel", "settings_changed", "inventory_out_of_sync"] as const;
/** What zimmerstack_sandbox_dry_run can preview. */
const DRY_RUNS = ["availability", "rates", "restrictions", "close", "reopen"] as const;
type DryRun = (typeof DRY_RUNS)[number];
const FAULT_ACTIONS = ["set", "clear", "read"] as const;
const FAULT_KINDS = ["refuse", "throttle", "outage"] as const;
const DAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const TOOLS = [
  {
    name: "zimmerstack_rules",
    title: "ZimmerStack: the rules",
    description:
      "The rules for building on the ZimmerStack Connect API with @zimmerstack/connect: where the key lives, what the package already handles (pacing, retries, idempotency), money and dates, a channel's price modifier, errors, and a checklist to finish with. Read it once before writing code that calls ZimmerStack.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "ZimmerStack: the rules", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "zimmerstack_reference",
    title: "ZimmerStack: look it up",
    description:
      "Look something up in the Connect API's reference, generated from the API's own contract. With no arguments: the index of every operation, topic and type. operation: one route with its scope, the client's call, its types, a sample and its refusals. type: one shape. topic: limits, keys, errors and so on. search: every place a word or an error code is mentioned.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", description: 'An operation as the contract names it ("PUT /rates"), or the client\'s call ("zs.rates.set").' },
        type: { type: "string", description: 'A shape of the contract, e.g. "RatesWrite" or "Booking".' },
        topic: { type: "string", enum: TOPICS, description: "One of the reference's topics." },
        search: { type: "string", description: 'Words or a code to find anywhere in the reference, e.g. "minimum stay" or "RATE_OUT_OF_BAND".' },
      },
      additionalProperties: false,
    },
    annotations: { title: "ZimmerStack: look it up", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "zimmerstack_sandbox_read",
    title: "ZimmerStack sandbox: read",
    description:
      "Make one read (GET) on the project's ZimmerStack SANDBOX and return the answer's data. Uses the sandbox key (zsk_test_…) from the project's environment; refuses a live key. Use it to see real ids and shapes: start with GET /property and GET /catalog.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: READS, description: "The read to make." },
        path: objectOf('Values for the {names} in the operation, e.g. { "batchId": "…" }.'),
        query: objectOf('Query values, e.g. { "from": "2026-12-01", "to": "2026-12-14" }. Dates are YYYY-MM-DD.'),
        propertyId: { type: "integer", minimum: 1, description: "A software vendor's company key only: the hotel to act on (GET /properties lists them)." },
      },
      required: ["operation"],
      additionalProperties: false,
    },
    annotations: { title: "ZimmerStack sandbox: read", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "zimmerstack_sandbox_write",
    title: "ZimmerStack sandbox: write",
    description:
      "Make one write (PUT, POST or DELETE) on the project's ZimmerStack SANDBOX and return the answer. A sandbox is a copy of a hotel's rooms and plans that no booking site sees, so this cannot change a real hotel; it refuses a live key. Use it to try a body before writing the code that sends it. Look the body up first with zimmerstack_reference.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: WRITES, description: "The write to make." },
        path: objectOf('Values for the {names} in the operation, e.g. { "channelId": "…" }.'),
        body: { description: "The JSON body, as zimmerstack_reference shows it for this operation." },
        propertyId: { type: "integer", minimum: 1, description: "A software vendor's company key only: the hotel to act on." },
      },
      required: ["operation"],
      additionalProperties: false,
    },
    annotations: { title: "ZimmerStack sandbox: write", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "zimmerstack_doctor",
    title: "ZimmerStack: the doctor",
    description:
      "Diagnose the project's ZimmerStack integration on its SANDBOX key, reading only: is the key the right shape and does it answer, which hotels and scopes it reaches, every budget and how full it is, the last day's refused requests grouped by reason, the webhook endpoints and their last failures, and sync and drift. Each finding is a plain sentence with what to do. Call it first when a call is refused or a webhook does not arrive. Refuses a live key; the developer runs `npx @zimmerstack/connect doctor` themselves for one.",
    inputSchema: {
      type: "object",
      properties: { propertyId: { type: "integer", minimum: 1, description: "A software vendor's company key only: look at this sandbox (default: the first five)." } },
      additionalProperties: false,
    },
    annotations: { title: "ZimmerStack: the doctor", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "zimmerstack_sandbox_limits",
    title: "ZimmerStack sandbox: budgets",
    description:
      "Every budget the sandbox key sits under (GET /limits), one line each: how much is used, how much is left and when it has room again, plus where the integration stands and the most one request may carry. A sandbox has the same budgets as a live hotel, so this is the size a real job must fit in. Reading spends nothing but one request.",
    inputSchema: {
      type: "object",
      properties: { propertyId: { type: "integer", minimum: 1, description: "A software vendor's company key only: the sandbox whose budgets to read." } },
      additionalProperties: false,
    },
    annotations: { title: "ZimmerStack sandbox: budgets", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "zimmerstack_sandbox_events",
    title: "ZimmerStack sandbox: the event log",
    description:
      "Read the sandbox's ordered event log (GET /events): every event a webhook carries for it, once, oldest first, each with its sequence. Pass after = the last sequence already seen (0 reads from the beginning of what is kept). Use it to see the exact body your webhook receiver will get, and to check that the code which keeps its place in the log is right. The answer says the next after to ask with.",
    inputSchema: {
      type: "object",
      properties: {
        after: { type: "integer", minimum: 0, description: "The last sequence already applied; default 0." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "How many events at most; default 20." },
        propertyId: { type: "integer", minimum: 1, description: "A software vendor's company key only: the sandbox whose log to read." },
      },
      additionalProperties: false,
    },
    annotations: { title: "ZimmerStack sandbox: the event log", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "zimmerstack_sandbox_simulate",
    title: "ZimmerStack sandbox: make an event",
    description:
      "Make one REAL event of any type on the sandbox, so the project's webhook receiver and its event-log reader can be tried end to end: an OTA booking arriving, changing or being cancelled, a cancellation with no booking before it, a booking on the hotel's own website, its no-show and the undo, its cancellation, a channel problem and its end. The sandbox's availability moves as it would on a live hotel, the signed webhook goes to every endpoint registered on the sandbox, and the event is in the log with a sequence. Nothing reaches a booking site. A booking event that needs an earlier booking uses the newest suitable one unless bookingId names one; a new booking uses the sandbox's first room type, 30 days from today, unless told otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        event: { type: "string", enum: SIMULATIONS, description: "Which event to make." },
        bookingId: { type: "integer", minimum: 1, description: "The simulated booking to change, cancel or mark a no-show (from an earlier call). Default: the newest suitable one." },
        roomTypeId: { type: "integer", minimum: 1, description: "For a new booking: the room type. Default: the sandbox's first." },
        checkIn: { type: "string", description: "For a new booking: arrival, YYYY-MM-DD. Default: 30 days from today." },
        nights: { type: "integer", minimum: 1, maximum: 30, description: "For a new booking: its length (default 2). For channel.booking.modified: the new length (default: one night longer)." },
        otaName: { type: "string", enum: ["Booking.com", "Expedia", "Agoda", "Airbnb", "MakeMyTrip", "Goibibo"], description: "For a new OTA booking: the channel it pretends to arrive from. Default Booking.com." },
        problem: { type: "string", enum: PROBLEMS, description: "For channel.sync.alert: which problem (default rate_error). For channel.sync.recovered: which problem to end (default: the newest open one)." },
        propertyId: { type: "integer", minimum: 1, description: "A software vendor's company key only: the sandbox to act on." },
      },
      required: ["event"],
      additionalProperties: false,
    },
    annotations: { title: "ZimmerStack sandbox: make an event", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "zimmerstack_sandbox_explain",
    title: "ZimmerStack sandbox: explain a night",
    description:
      "Explain one night of one room type on the sandbox (GET /explain): what the software last sent, what ZimmerStack's record holds and who set it, what the channel manager was last seen holding, every send still on file and how it ended, a held value in the channel manager's words, the rules in force, and the same in plain sentences. Reads only. Use it after a write to see what the write did, and to learn the answer's shape before writing code that reads it. A sandbox has no booking site, so the parts about which connections sell a plan read unknown there.",
    inputSchema: {
      type: "object",
      properties: {
        roomTypeId: { type: "integer", minimum: 1, description: "The room type (GET /catalog). Default: the sandbox's first." },
        date: { type: "string", description: "The night, YYYY-MM-DD, from 30 days back to the last writable night. Default: 30 days from today." },
        ratePlanId: { type: "integer", minimum: 1, description: "One rate plan of that room type; leave out for every plan of the room." },
        propertyId: { type: "integer", minimum: 1, description: "A software vendor's company key only: the sandbox to read." },
      },
      additionalProperties: false,
    },
    annotations: { title: "ZimmerStack sandbox: explain a night", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "zimmerstack_sandbox_dry_run",
    title: "ZimmerStack sandbox: dry-run a write",
    description:
      'See what a write to the sandbox WOULD do, with nothing written, queued or sent: the verdict (would-write, nothing-to-write, or would-refuse with the refusal a real write would get now), the ranges that would change, the ones already held, and the notices, which say what the write would not do (a stop-sell on one rate plan leaves the room on sale through its other plans; a room count of 0 is not a stop-sell). write: availability, rates or restrictions with updates (the same updates the real write takes; for rates the currency is filled in), or close or reopen with body ({ roomTypeId, dateFrom, dateTo }). A dry run spends the minute budgets like the write it previews, so it is not a way to read the calendar.',
    inputSchema: {
      type: "object",
      properties: {
        write: { type: "string", enum: DRY_RUNS, description: "Which write to preview." },
        updates: { type: "array", items: { type: "object", additionalProperties: true }, description: "For availability, rates and restrictions: the updates, exactly as PUT /availability, PUT /rates or PUT /restrictions take them (zimmerstack_reference shows each)." },
        body: objectOf('For close and reopen: { "roomTypeId": 412, "dateFrom": "2026-12-30", "dateTo": "2027-01-02" }, optionally "days", and for reopen "available".'),
        propertyId: { type: "integer", minimum: 1, description: "A software vendor's company key only: the sandbox to preview on." },
      },
      required: ["write"],
      additionalProperties: false,
    },
    // It writes nothing, but it is sent as the write it previews and spends that write's minute budgets.
    annotations: { title: "ZimmerStack sandbox: dry-run a write", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "zimmerstack_sandbox_fault",
    title: "ZimmerStack sandbox: make the pretend channel fail",
    description:
      'Make the sandbox\'s pretend channel misbehave, so the project\'s code can be tried against a bad day. action "set" with kind: refuse (the next values nights of prices or stay rules are refused, with message as the channel manager\'s words: the nights are held, the batch reads failed, channel.sync.alert value_refused is sent), throttle ("too many requests" for minutes: batches wait and land by themselves) or outage (no answer for minutes: after five failed attempts, one a minute, channel.sync.alert rates_out_of_sync, then channel.sync.recovered when it ends). action "clear" ends it; action "read" shows the one in force. One fault at a time. Prices and stay rules only: room counts land as before. The answer lists what to do next and what the software should then see.',
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: FAULT_ACTIONS, description: "set a fault, clear it, or read the one in force." },
        kind: { type: "string", enum: FAULT_KINDS, description: "For set: which fault." },
        values: { type: "integer", minimum: 1, maximum: 500, description: "refuse only: how many nights (rate plan × night) to refuse. Default 1." },
        minutes: { type: "integer", minimum: 1, maximum: 60, description: "throttle and outage only: how long. Default 5 for a throttle, 10 for an outage." },
        message: { type: "string", description: "refuse only: the pretend channel's words for the refusal." },
        propertyId: { type: "integer", minimum: 1, description: "A software vendor's company key only: the sandbox to act on." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    annotations: { title: "ZimmerStack sandbox: make the pretend channel fail", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "zimmerstack_sandbox_close",
    title: "ZimmerStack sandbox: close or reopen a room type",
    description:
      'Close one room type of the sandbox on a range of nights everywhere (action "close": its room count goes to 0 and stop-sell is switched on for every one of its rate plans), or undo exactly that (action "reopen": the stop-sell is lifted on the plans the close switched on and each night gets back the count it held, or available if given). The answer says what was changed, what was already so, and notReached: what the action could not reach. To see what it would do without doing it, use zimmerstack_sandbox_dry_run with write close or reopen.',
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["close", "reopen"], description: "close the room type, or reopen what a close closed." },
        roomTypeId: { type: "integer", minimum: 1, description: "The room type (GET /catalog). Default: the sandbox's first." },
        dateFrom: { type: "string", description: "The first night, YYYY-MM-DD." },
        dateTo: { type: "string", description: "The last night, YYYY-MM-DD." },
        days: { type: "array", items: { type: "string", enum: DAYS }, description: "Only these weekdays of the range; leave out for every night." },
        available: { type: "integer", minimum: 0, description: "reopen only: the count to put on sale on each reopened night. Leave out to put back the count each night held before the close." },
        propertyId: { type: "integer", minimum: 1, description: "A software vendor's company key only: the sandbox to act on." },
      },
      required: ["action", "dateFrom", "dateTo"],
      additionalProperties: false,
    },
    annotations: { title: "ZimmerStack sandbox: close or reopen a room type", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const say = (text: string): ToolResult => ({ content: [{ type: "text", text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n\n(cut at ${MAX_TEXT.toLocaleString("en-US")} characters: ask for a shorter window, a single id or a narrower lookup)` : text }] });
const refuse = (text: string): ToolResult => ({ ...say(text), isError: true });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

class BadArguments extends Error {}

export function createMcpServer(options: McpServerOptions = {}): { handle(message: unknown): Promise<unknown> } {
  const key = options.apiKey?.trim();
  const where = options.keySource ?? "the environment";
  let client: ZimmerStack | undefined;

  /** The one client of this server, made on first use. Throws the sentence to show when there is no sandbox key. */
  function sandbox(): ZimmerStack {
    if (client) return client;
    if (!key) {
      throw new BadArguments(
        "No sandbox key was found, so nothing was sent. Put ZIMMERSTACK_CONNECT_KEY=zsk_test_… in the project's .env (the hotel's owner makes a sandbox and a key for it under Admin → Developers → API keys), then restart this server. The rules and the reference work without a key."
      );
    }
    if (key.startsWith("zsk_live_")) {
      throw new BadArguments(
        `The key in ${where} is a live key (zsk_live_…): it acts on a real hotel. This server calls a sandbox only, so nothing was sent. Ask the hotel's owner for a sandbox key (zsk_test_…), put it in the project's .env while you build, and keep the live key for production.`
      );
    }
    if (!key.startsWith("zsk_test_")) throw new BadArguments(`The value of ZIMMERSTACK_CONNECT_KEY in ${where} is not a ZimmerStack sandbox key (zsk_test_…). Nothing was sent.`);
    // Short waits: an agent is better served by the refusal itself than by a tool call held open.
    client = new ZimmerStack({ apiKey: key, fetch: options.fetch, baseUrl: options.baseUrl, timeoutMs: 20_000, maxRetries: 1, maxWaitSeconds: 15 });
    return client;
  }

  /** The sandbox client for one tool call: the hotel a company key names, after the same checks every call makes. */
  function sandboxFor(args: Record<string, unknown>): ZimmerStack {
    if (args.propertyId !== undefined && (!Number.isInteger(args.propertyId) || (args.propertyId as number) <= 0)) throw new BadArguments("propertyId must be a property's numeric id.");
    const base = sandbox();
    return typeof args.propertyId === "number" ? base.forProperty(args.propertyId) : base;
  }

  /** What the API refused, as words for the agent. Never the key. */
  function refused(what: string, err: ZimmerStackError): ToolResult {
    const lines = [`${what} was refused: ${err.code}${err.status ? ` (${err.status})` : ""}`, err.message];
    if (err.scope) lines.push(`Budget: ${err.scope}`);
    if (err.details !== undefined) lines.push(`Details: ${JSON.stringify(err.details)}`);
    lines.push(
      err.retryable
        ? `It may pass later${err.retryAfterSeconds ? `: in ${err.retryAfterSeconds} seconds` : ""}. The client has already retried what was worth waiting for.`
        : "This is a verdict on the request: fix it; sending it again will be refused again. zimmerstack_reference explains the code (search for it)."
    );
    return refuse(lines.join("\n"));
  }

  /** Run one tool's calls on the sandbox; a refusal of the API becomes the tool's answer. */
  async function onSandbox(what: string, run: () => Promise<ToolResult>): Promise<ToolResult> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof ZimmerStackUsageError) throw new BadArguments(`${err.message}. Nothing was sent.`);
      if (!(err instanceof ZimmerStackError)) throw err;
      return refused(what, err);
    }
  }

  async function doctor(args: Record<string, unknown>): Promise<ToolResult> {
    if (args.propertyId !== undefined && (!Number.isInteger(args.propertyId) || (args.propertyId as number) <= 0)) throw new BadArguments("propertyId must be a property's numeric id.");
    sandbox(); // the same refusals as every sandbox call: no key, a live key, something that is no key
    const report = await diagnose({ apiKey: key, fetch: options.fetch, baseUrl: options.baseUrl, propertyId: args.propertyId as number | undefined });
    // A finding that needs attention is the tool doing its job, not a failed tool call.
    return say(formatDoctorReport(report));
  }

  async function limits(args: Record<string, unknown>): Promise<ToolResult> {
    const zs = sandboxFor(args);
    return onSandbox("GET /limits", async () => {
      const now = await zs.limits.get();
      const line = (b: (typeof now.budgets)[number]) => {
        const fill = b.used === null ? "not counted on this route (its quota still holds)" : `${b.used.toLocaleString("en-US")} used, ${(b.remaining ?? 0).toLocaleString("en-US")} left of ${b.quota.toLocaleString("en-US")} ${b.unit}`;
        const frees = b.remaining === 0 && b.resetSeconds ? `; room again in ${aboutHowLong(b.resetSeconds * 1000)}` : "";
        return `- ${b.scope}: ${fill}${frees}. ${b.window}, per ${b.per}.`;
      };
      const lines = [
        `Budgets of the sandbox key (${now.key.kind} key${now.key.propertyId ? `, hotel #${now.key.propertyId}` : ""}), read ${now.asOf}:`,
        "",
        "Per minute and per rolling day:",
        ...now.budgets.map(line),
      ];
      if (now.shield) {
        lines.push("", `Per hour and per day (changed cells and structure), standing ${now.shield.standing.level}${now.shield.standing.reason ? `: ${now.shield.standing.reason}` : ""}:`, ...now.shield.budgets.map(line));
      } else lines.push("", "A company key that names no hotel has no hourly and daily budgets to show: pass propertyId.");
      lines.push("", "The most one request may carry, and the most of a thing that may exist:", ...now.caps.map((c) => `- ${c.scope}: ${c.quota.toLocaleString("en-US")} ${c.unit} per ${c.per}.`), "", now.note);
      return say(lines.join("\n"));
    });
  }

  async function events(args: Record<string, unknown>): Promise<ToolResult> {
    for (const name of ["after", "limit"] as const) if (args[name] !== undefined && (!Number.isInteger(args[name]) || (args[name] as number) < 0)) throw new BadArguments(`${name} must be a whole number.`);
    const zs = sandboxFor(args);
    const after = (args.after as number | undefined) ?? 0;
    return onSandbox("GET /events", async () => {
      const page = await zs.events.list({ after, limit: Math.min(100, Math.max(1, (args.limit as number | undefined) ?? 20)) });
      const head = [
        page.items.length === 0 ? `No event after sequence ${after}.` : `${page.items.length} event${page.items.length === 1 ? "" : "s"} after sequence ${after}: ${page.items.map((e) => `#${e.sequence} ${e.type}`).join(", ")}.`,
        `Your place is now ${page.nextAfter}: ask again with after = ${page.nextAfter}${page.more ? " (more events follow now)" : " when a webhook arrives or on a schedule"}.`,
      ];
      if (page.earliestSequence !== null && page.earliestSequence > after + 1) {
        head.push(`The log now begins at sequence ${page.earliestSequence} (events are kept ${page.retentionDays} days): what came before is no longer here. Code that meets this reads the bookings again (zs.channelBookings.all, zs.directBookings.all), then carries on.`);
      }
      return say(`${head.join("\n")}\n\n${JSON.stringify(page.items, null, 2)}`);
    });
  }

  async function simulate(args: Record<string, unknown>): Promise<ToolResult> {
    const event = args.event as Simulation;
    if (typeof event !== "string" || !SIMULATIONS.includes(event)) throw new BadArguments(`event must be one of: ${SIMULATIONS.join("; ")}.`);
    for (const name of ["bookingId", "roomTypeId", "nights"] as const) if (args[name] !== undefined && (!Number.isInteger(args[name]) || (args[name] as number) <= 0)) throw new BadArguments(`${name} must be a whole number above 0.`);
    if (args.checkIn !== undefined && (typeof args.checkIn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.checkIn))) throw new BadArguments("checkIn must be a calendar date, YYYY-MM-DD.");
    if (args.problem !== undefined && !PROBLEMS.includes(args.problem as (typeof PROBLEMS)[number])) throw new BadArguments(`problem must be one of: ${PROBLEMS.join(", ")}.`);
    const zs = sandboxFor(args);
    const website = event.startsWith("direct.");

    /** The booking an event acts on: the one named, or the newest one of the right family that is still standing. */
    const target = async (): Promise<number> => {
      if (typeof args.bookingId === "number") return args.bookingId;
      const { bookings } = await zs.sandbox.bookings.list();
      const hit = bookings.find((b) => (b.otaName === "Website") === website && b.status !== "CANCELLED");
      if (!hit) throw new BadArguments(`The sandbox has no ${website ? "website" : "OTA"} booking to act on. Make one first: event "${website ? "direct" : "channel"}.booking.created".`);
      return hit.bookingId;
    };
    const after = (made: unknown, sent: string) =>
      say(`Made on the sandbox: ${sent}. The signed webhook is on its way to every endpoint registered on the sandbox, and the event is in the log (zimmerstack_sandbox_events). Nothing reached a booking site.\n\n${JSON.stringify(made, null, 2)}`);

    return onSandbox(`The simulation of ${event}`, async () => {
      if (event === "channel.sync.alert" || event === "channel.sync.recovered") {
        const made = await zs.sandbox.syncEvents.create({ type: event, ...(args.problem ? { event: args.problem as (typeof PROBLEMS)[number] } : {}) });
        return after(made, `${event} (${made.event})`);
      }
      if (event === "channel.booking.created" || event === "direct.booking.created" || event === "channel.booking.cancelled (no booking before it)") {
        const roomTypeId = (args.roomTypeId as number | undefined) ?? (await zs.catalog.get()).roomTypes[0]?.id;
        if (!roomTypeId) throw new BadArguments("The sandbox has no room type yet. Create one first (zimmerstack_sandbox_write, PUT /catalog/room-types).");
        const made = await zs.sandbox.bookings.create({
          roomTypeId,
          checkIn: (args.checkIn as string | undefined) ?? addDays(new Date().toISOString().slice(0, 10), 30),
          nights: (args.nights as number | undefined) ?? 2,
          ...(website ? { otaName: "Website" as const, paidByOta: true } : args.otaName ? { otaName: args.otaName as "Booking.com" } : {}),
          ...(event.endsWith("(no booking before it)") ? { arrivesCancelled: true } : {}),
        });
        return after(made, made.webhook?.eventType ?? event);
      }
      const bookingId = await target();
      if (event === "channel.booking.modified") {
        const nights = (args.nights as number | undefined) ?? Math.min(30, ((await zs.sandbox.bookings.list()).bookings.find((b) => b.bookingId === bookingId)?.nights ?? 2) + 1);
        return after(await zs.sandbox.bookings.modify(bookingId, { nights }), `channel.booking.modified (booking ${bookingId}, now ${nights} nights)`);
      }
      if (event === "channel.booking.cancelled" || event === "direct.booking.cancelled") return after(await zs.sandbox.bookings.cancel(bookingId), `${event} (booking ${bookingId})`);
      const undo = event.endsWith("(no-show undone)");
      return after(await zs.sandbox.bookings.noShow(bookingId, undo ? { undo: true } : {}), `direct.booking.modified (booking ${bookingId}: ${undo ? "the no-show undone, the nights taken again" : "a no-show, the nights back on sale"})`);
    });
  }

  /** The sandbox's first room type, for a tool that was not told which. */
  async function firstRoomType(zs: ZimmerStack): Promise<number> {
    const id = (await zs.catalog.get()).roomTypes[0]?.id;
    if (!id) throw new BadArguments("The sandbox has no room type yet. Create one first (zimmerstack_sandbox_write, PUT /catalog/room-types).");
    return id;
  }

  const wholeId = (args: Record<string, unknown>, name: string): number | undefined => {
    if (args[name] === undefined) return undefined;
    if (!Number.isInteger(args[name]) || (args[name] as number) <= 0) throw new BadArguments(`${name} must be a whole number above 0.`);
    return args[name] as number;
  };
  const aDate = (args: Record<string, unknown>, name: string): string | undefined => {
    if (args[name] === undefined) return undefined;
    if (typeof args[name] !== "string" || !DATE.test(args[name] as string)) throw new BadArguments(`${name} must be a calendar date, YYYY-MM-DD.`);
    return args[name] as string;
  };

  /** The notices of an answer, as lines an agent can act on. */
  const noticeLines = (answers: Parameters<typeof noticesOf>[0]): string[] => {
    const notices = noticesOf(answers);
    if (notices.length === 0) return ["No notice: nothing our record knows says this write does less than it reads."];
    const omitted = noticesOmittedFrom(answers);
    return [`Notices (what it does NOT do), warnings first:`, ...notices.map((n) => `- ${n.level} ${n.code}: ${n.message} → ${n.action}`), ...(omitted ? [`(${omitted} more were left out of the answer)`] : [])];
  };

  async function explain(args: Record<string, unknown>): Promise<ToolResult> {
    const roomTypeId = wholeId(args, "roomTypeId");
    const ratePlanId = wholeId(args, "ratePlanId");
    const date = aDate(args, "date") ?? addDays(new Date().toISOString().slice(0, 10), 30);
    const zs = sandboxFor(args);
    return onSandbox("GET /explain", async () => {
      const night = await zs.explain.night({ roomTypeId: roomTypeId ?? (await firstRoomType(zs)), date, ...(ratePlanId === undefined ? {} : { ratePlanId }) });
      const head = [
        `${night.roomType.name} (#${night.roomType.id}) on ${night.date}, from ZimmerStack's record (read ${night.asOf}):`,
        ...night.summary.map((sentence) => `- ${sentence}`),
        "",
        "This is our record and the channel manager's copy as last seen, never a booking site's own screen. Where a seenAt is null that part was never read back; where lastSent is null the write is older than the ones whose values are kept (searched says how far it looked).",
      ];
      return say(`${head.join("\n")}\n\n${JSON.stringify(night, null, 2)}`);
    });
  }

  async function dryRun(args: Record<string, unknown>): Promise<ToolResult> {
    const write = args.write as DryRun;
    if (typeof write !== "string" || !DRY_RUNS.includes(write)) throw new BadArguments(`write must be one of: ${DRY_RUNS.join(", ")}.`);
    const zs = sandboxFor(args);
    if (write === "close" || write === "reopen") {
      if (!isRecord(args.body)) throw new BadArguments(`A dry run of ${write} takes body: { roomTypeId, dateFrom, dateTo }.`);
      const body = args.body;
      return onSandbox(`The dry run of POST /availability/${write}`, async () => {
        // The client's own dry-run methods: they send dryRun: true themselves and refuse an answer that is not a preview.
        const preview: CloseResult = write === "close" ? await zs.availability.closeDryRun(body as never) : await zs.availability.reopenDryRun(body as never);
        const lines = [
          `Nothing was done. A ${write} of room type ${preview.roomTypeId} from ${preview.dateFrom} to ${preview.dateTo} (${preview.nights} night${preview.nights === 1 ? "" : "s"}) would change the count on ${preview.count.changedNights} and leave ${preview.count.unchangedNights} as they are.`,
          ...preview.ratePlans.map((p) => `- ${p.name} (#${p.ratePlanId}): stop-sell ${write === "close" ? "switched on" : "lifted"} on ${p.changedNights} night${p.changedNights === 1 ? "" : "s"}, ${p.unchangedNights} left as they are.`),
          ...(preview.notReached.length ? ["Not reached:", ...preview.notReached.map((n) => `- ${n.what} (${n.reason}): ${n.message}`)] : []),
        ];
        return say(`${lines.join("\n")}\n\n${JSON.stringify(preview, null, 2)}`);
      });
    }
    if (!Array.isArray(args.updates) || args.updates.length === 0 || !args.updates.every(isRecord)) throw new BadArguments(`A dry run of ${write} takes updates: the same list PUT /${write} takes.`);
    const updates = args.updates as never;
    return onSandbox(`The dry run of PUT /${write}`, async () => {
      const previews: WritePreview[] = write === "availability" ? await zs.availability.dryRun(updates) : write === "rates" ? await zs.rates.dryRun(updates) : await zs.restrictions.dryRun(updates);
      const lines: string[] = ["Nothing was written, queued or sent."];
      for (const p of previews) {
        lines.push(
          p.verdict === "would-refuse"
            ? `Verdict: would-refuse. A real request would get ${p.refusal?.status} ${p.refusal?.code}: ${p.refusal?.message}`
            : `Verdict: ${p.verdict}. Of ${p.requestedCells} cell${p.requestedCells === 1 ? "" : "s"}: ${p.wouldChangeCells} would change, ${p.unchangedCells} already held, ${p.heldCells} held after a refusal, ${p.wouldRejectCells} would be refused by our record.`
        );
        for (const r of p.wouldReject) lines.push(`- would refuse ${r.cells} cell${r.cells === 1 ? "" : "s"}: ${r.error}`);
        for (const r of p.rounded ?? []) lines.push(`- ${r.field}: ${r.sent} would be kept as ${r.kept} (${r.reason})`);
      }
      lines.push(...noticeLines(previews));
      return say(`${lines.join("\n")}\n\n${JSON.stringify(previews.length === 1 ? previews[0] : previews, null, 2)}`);
    });
  }

  async function fault(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action;
    if (typeof action !== "string" || !(FAULT_ACTIONS as readonly string[]).includes(action)) throw new BadArguments(`action must be one of: ${FAULT_ACTIONS.join(", ")}.`);
    const zs = sandboxFor(args);
    const show = (did: string, view: { active: boolean; watch: string[] }) => say(`${did}${view.watch.length ? `\n\nWhat to do next, and what the software should then see:\n${view.watch.map((step, i) => `${i + 1}. ${step}`).join("\n")}` : ""}\n\n${JSON.stringify(view, null, 2)}`);
    if (action === "read") return onSandbox("GET /sandbox/faults", async () => {
      const view = await zs.sandbox.faults.get();
      return show(view.active ? `A ${view.kind} fault is in force on the sandbox's pretend channel.` : "No fault is in force: the sandbox's pretend channel takes everything.", view);
    });
    if (action === "clear") return onSandbox("DELETE /sandbox/faults", async () => show("The fault is ended: the pretend channel answers normally from the next push. Values already held stay held until a different value is sent.", await zs.sandbox.faults.clear()));
    const kind = args.kind;
    if (typeof kind !== "string" || !(FAULT_KINDS as readonly string[]).includes(kind)) throw new BadArguments(`To set a fault, kind must be one of: ${FAULT_KINDS.join(", ")}.`);
    const values = wholeId(args, "values");
    const minutes = wholeId(args, "minutes");
    if (args.message !== undefined && typeof args.message !== "string") throw new BadArguments("message must be text.");
    if (kind === "refuse" ? minutes !== undefined : values !== undefined || args.message !== undefined) {
      throw new BadArguments(kind === "refuse" ? "A refuse fault takes values and message, not minutes." : `A ${kind} fault takes minutes, not values or message.`);
    }
    const body = { kind: kind as (typeof FAULT_KINDS)[number], ...(values === undefined ? {} : { values }), ...(minutes === undefined ? {} : { minutes }), ...(typeof args.message === "string" ? { message: args.message } : {}) };
    return onSandbox("POST /sandbox/faults", async () => show(`Set on the sandbox's pretend channel: ${kind}. Nothing here reaches a live hotel.`, await zs.sandbox.faults.set(body)));
  }

  async function closeOrReopen(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action;
    if (action !== "close" && action !== "reopen") throw new BadArguments("action must be close or reopen.");
    const roomTypeId = wholeId(args, "roomTypeId");
    const dateFrom = aDate(args, "dateFrom");
    const dateTo = aDate(args, "dateTo");
    if (!dateFrom || !dateTo) throw new BadArguments("dateFrom and dateTo are needed: the first and the last night, YYYY-MM-DD.");
    if (args.days !== undefined && (!Array.isArray(args.days) || !args.days.every((d) => (DAYS as readonly unknown[]).includes(d)))) throw new BadArguments(`days must be a list of: ${DAYS.join(", ")}.`);
    if (args.available !== undefined && (action !== "reopen" || !Number.isInteger(args.available) || (args.available as number) < 0)) throw new BadArguments("available is for a reopen only: the count to put on sale, a whole number from 0.");
    const zs = sandboxFor(args);
    return onSandbox(`POST /availability/${action}`, async () => {
      const range = { roomTypeId: roomTypeId ?? (await firstRoomType(zs)), dateFrom, dateTo, ...(args.days ? { days: args.days as Array<(typeof DAYS)[number]> } : {}) };
      const done = action === "close" ? await zs.availability.close(range) : await zs.availability.reopen({ ...range, ...(typeof args.available === "number" ? { available: args.available } : {}) });
      const lines = [
        `Done on the sandbox: room type ${done.roomTypeId} ${action === "close" ? "closed" : "reopened"} from ${done.dateFrom} to ${done.dateTo}. The count changed on ${done.count.changedNights} night${done.count.changedNights === 1 ? "" : "s"} and was left on ${done.count.unchangedNights}${done.skippedNights ? `; ${done.skippedNights} were skipped because no close had closed them` : ""}.`,
        ...done.ratePlans.map((p) => `- ${p.name} (#${p.ratePlanId}): stop-sell ${action === "close" ? "switched on" : "lifted"} on ${p.changedNights}, left on ${p.unchangedNights}.`),
        ...(done.notReached.length ? ["Not reached (read these: a close that reads done can still leave something selling):", ...done.notReached.map((n) => `- ${n.what} (${n.reason}): ${n.message}`)] : []),
        ...(done.batches.length ? [`Watch it land: ${done.batches.map((b) => `${b.resource} batch ${b.batchId}`).join(", ")} (zimmerstack_sandbox_read, GET /batches/{batchId}).`] : ["Nothing had to change, so there is no batch to watch."]),
      ];
      return say(`${lines.join("\n")}\n\n${JSON.stringify(done, null, 2)}`);
    });
  }

  function reference(args: Record<string, unknown>): ToolResult {
    const given = (["operation", "type", "topic", "search"] as const).filter((name) => typeof args[name] === "string" && (args[name] as string).trim() !== "");
    if (given.length === 0) return say(referenceIndex());
    const parts: string[] = [];
    for (const name of given) {
      const value = (args[name] as string).trim();
      if (name === "operation") {
        const op = findOperation(value);
        parts.push(op ? describeOperation(op) : `There is no operation "${value}". ${searchReference(value)}`);
      } else if (name === "type") {
        parts.push(describeType(value) ?? `There is no type "${value}". ${searchReference(value)}`);
      } else if (name === "topic") {
        parts.push(describeTopic(value) ?? `There is no topic "${value}". The topics: ${TOPICS.join(", ")}.`);
      } else {
        parts.push(searchReference(value));
      }
    }
    return say(parts.join("\n\n---\n\n"));
  }

  async function call(kind: "read" | "write", args: Record<string, unknown>): Promise<ToolResult> {
    const operation = args.operation;
    const allowed: readonly string[] = kind === "read" ? READS : WRITES;
    if (typeof operation !== "string" || !allowed.includes(operation)) {
      const other = typeof operation === "string" && operation in OPERATIONS;
      throw new BadArguments(
        other
          ? `${operation} is a ${kind === "read" ? "write" : "read"}: use zimmerstack_sandbox_${kind === "read" ? "write" : "read"}.`
          : `"${String(operation)}" is not an operation of the Connect API. The ${kind}s: ${allowed.join(", ")}.`
      );
    }
    for (const name of ["path", "query"] as const) if (args[name] !== undefined && !isRecord(args[name])) throw new BadArguments(`${name} must be an object of names and values.`);

    const zs = sandboxFor(args);
    return onSandbox(operation, async () => {
      const data = await zs.request(operation as OperationKey, { path: args.path, query: args.query, body: args.body } as never);
      return say(`${operation} on the sandbox answered:\n\n${JSON.stringify(data, null, 2)}`);
    });
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // The rules are never cut: half a rules file is worse than none.
      if (name === "zimmerstack_rules") return { content: [{ type: "text", text: RULES }] };
      if (name === "zimmerstack_reference") return reference(args);
      if (name === "zimmerstack_sandbox_read") return await call("read", args);
      if (name === "zimmerstack_sandbox_write") return await call("write", args);
      if (name === "zimmerstack_doctor") return await doctor(args);
      if (name === "zimmerstack_sandbox_limits") return await limits(args);
      if (name === "zimmerstack_sandbox_events") return await events(args);
      if (name === "zimmerstack_sandbox_explain") return await explain(args);
      if (name === "zimmerstack_sandbox_dry_run") return await dryRun(args);
      if (name === "zimmerstack_sandbox_fault") return await fault(args);
      if (name === "zimmerstack_sandbox_close") return await closeOrReopen(args);
      return await simulate(args);
    } catch (err) {
      if (err instanceof BadArguments) return refuse(err.message);
      // Whatever went wrong, the answer is words for the agent, and never the key.
      return refuse(`The tool failed before it had an answer: ${err instanceof Error ? err.name : "an unexpected error"}. Nothing can be assumed about whether a write was applied; read the current state before trying again.`);
    }
  }

  async function one(message: unknown): Promise<unknown> {
    if (!isRecord(message)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
    const id = message.id;
    const expectsAnswer = typeof id === "string" || typeof id === "number";
    const fail = (code: number, text: string) => (expectsAnswer ? { jsonrpc: "2.0", id, error: { code, message: text } } : undefined);
    const ok = (result: unknown) => (expectsAnswer ? { jsonrpc: "2.0", id, result } : undefined);
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      // A client's answer to something we never asked, or a malformed line: nothing to say unless it wants a reply.
      return "result" in message || "error" in message ? undefined : fail(-32600, "Invalid Request");
    }
    const params = isRecord(message.params) ? message.params : {};
    switch (message.method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        return ok({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "zimmerstack-connect", title: "ZimmerStack Connect", version: SDK_VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: TOOLS });
      case "tools/call": {
        const name = params.name;
        if (typeof name !== "string" || !TOOLS.some((tool) => tool.name === name)) return fail(-32602, `Unknown tool: ${String(name)}`);
        if (params.arguments !== undefined && !isRecord(params.arguments)) return fail(-32602, "arguments must be an object");
        return ok(await callTool(name, isRecord(params.arguments) ? params.arguments : {}));
      }
      default:
        return fail(-32601, `Method not found: ${message.method}`);
    }
  }

  return {
    /** One decoded JSON-RPC message in; its answer out, or undefined when it expects none (a notification). */
    async handle(message: unknown): Promise<unknown> {
      if (!Array.isArray(message)) return one(message);
      const answers = (await Promise.all(message.map(one))).filter((answer) => answer !== undefined);
      return answers.length ? answers : undefined;
    },
  };
}
