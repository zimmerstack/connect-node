import { ZimmerStack } from "../client.ts";
import { ZimmerStackError, ZimmerStackUsageError } from "../errors.ts";
import { OPERATIONS, SDK_VERSION, type OperationKey } from "../generated.ts";
import { RULES } from "./reference.generated.ts";
import { TOPICS, describeOperation, describeTopic, describeType, findOperation, referenceIndex, searchReference } from "./reference.ts";

/**
 * The package's MCP server: four tools a developer's coding agent can call while it builds on the
 * Connect API. It runs on the developer's own machine, over stdin and stdout (src/mcp/cli.ts).
 *
 *   zimmerstack_rules          the rules for building on the API (this package's AGENTS.md)
 *   zimmerstack_reference      look up an operation, a type, a topic, or search, from the contract
 *   zimmerstack_sandbox_read   one read on the project's SANDBOX
 *   zimmerstack_sandbox_write  one write on the project's SANDBOX
 *
 * The two sandbox tools use a zsk_test_ key and nothing else: a sandbox is a copy of a hotel's rooms
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
  "zimmerstack_sandbox_read and zimmerstack_sandbox_write call the API with the project's sandbox key (zsk_test_…) only. Nothing they send reaches a booking site, and they refuse a live key.";

const objectOf = (description: string) => ({ type: "object", description, additionalProperties: true });

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
    if (args.propertyId !== undefined && (!Number.isInteger(args.propertyId) || (args.propertyId as number) <= 0)) throw new BadArguments("propertyId must be a property's numeric id.");

    const base = sandbox();
    const zs = typeof args.propertyId === "number" ? base.forProperty(args.propertyId) : base;
    try {
      const data = await zs.request(operation as OperationKey, { path: args.path, query: args.query, body: args.body } as never);
      return say(`${operation} on the sandbox answered:\n\n${JSON.stringify(data, null, 2)}`);
    } catch (err) {
      if (err instanceof ZimmerStackUsageError) throw new BadArguments(`${err.message}. Nothing was sent.`);
      if (!(err instanceof ZimmerStackError)) throw err;
      const lines = [`${operation} was refused: ${err.code}${err.status ? ` (${err.status})` : ""}`, err.message];
      if (err.scope) lines.push(`Budget: ${err.scope}`);
      if (err.details !== undefined) lines.push(`Details: ${JSON.stringify(err.details)}`);
      lines.push(
        err.retryable
          ? `It may pass later${err.retryAfterSeconds ? `: in ${err.retryAfterSeconds} seconds` : ""}. The client has already retried what was worth waiting for.`
          : "This is a verdict on the request: fix it; sending it again will be refused again. zimmerstack_reference explains the code (search for it)."
      );
      return refuse(lines.join("\n"));
    }
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      if (name === "zimmerstack_rules") return say(RULES);
      if (name === "zimmerstack_reference") return reference(args);
      if (name === "zimmerstack_sandbox_read") return await call("read", args);
      return await call("write", args);
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
