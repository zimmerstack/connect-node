#!/usr/bin/env node
import { diagnose, formatDoctorReport } from "../doctor.ts";
import { SDK_VERSION } from "../generated.ts";
import { findKey } from "./key.ts";
import { createMcpServer } from "./server.ts";

/**
 * The package's command line. Two commands:
 *
 *   npx @zimmerstack/connect doctor      one look at an integration when something is wrong
 *   npx -y @zimmerstack/connect mcp      the MCP server on stdin and stdout, for a coding agent
 *
 * The MCP server's stdout carries protocol messages and nothing else; anything for a person goes to
 * stderr. The doctor prints its report to stdout and never prints the key.
 */

const KEY_ENV = "ZIMMERSTACK_CONNECT_KEY";

const HELP = `@zimmerstack/connect ${SDK_VERSION}

  zimmerstack-connect doctor     Check an integration: the key, whether something is wrong on
                                 ZimmerStack's side, the hotels and scopes the key reaches (and what a
                                 hotel that is not live yet still needs), every budget, the last day's
                                 refused requests, the webhook endpoints, sync and drift. Reads only;
                                 works with a test key and a live key.
      --property <id>            A company key: look at this hotel (default: the first five).
      --room-type <id> --night <YYYY-MM-DD>
                                 Also explain that night of that room type: what your software last
                                 sent, what ZimmerStack's record holds, what the channel manager was
                                 last seen holding. Add --rate-plan <id> for one rate plan only.
      --json                     The report as JSON, for a script.
  zimmerstack-connect mcp        Start the MCP server for a coding agent (stdin/stdout).
  zimmerstack-connect --version
  zimmerstack-connect --help

Both read the key from ${KEY_ENV}, in the environment or in the project's .env.local or
.env. The doctor exits 0 when nothing needs attention and 1 when something does; it never prints the
key. The MCP server gives an agent the rules for building on the ZimmerStack Connect API, a reference
generated from the API's contract, and calls on a SANDBOX: it uses a sandbox key (zsk_test_…) and
refuses a live one. Add it to an agent's MCP settings as:

  { "command": "npx", "args": ["-y", "@zimmerstack/connect", "mcp"] }
`;

function serve(): void {
  const found = findKey(process.env, process.cwd());
  const server = createMcpServer(found);
  const state = !found.apiKey ? "no key found: the rules and the reference work, sandbox calls will say how to add one" : found.apiKey.startsWith("zsk_test_") ? `sandbox key from ${found.keySource}` : `the key in ${found.keySource} is not a sandbox key: sandbox calls are refused`;
  process.stderr.write(`zimmerstack-connect mcp ${SDK_VERSION} ready (${state})\n`);

  let pending = 0;
  let ended = false;
  let exiting = false;
  // Exit only once stdout has handed every answer to the OS: on a pipe Node may still be writing a long answer
  // (on macOS pipe writes are asynchronous), and exiting at once cut it short (seen in the smoke run, 24 Nov 2026).
  const done = () => {
    if (!ended || pending !== 0 || exiting) return;
    exiting = true;
    process.stdout.write("", () => process.exit(0));
  };
  const write = (answer: unknown) => {
    if (answer !== undefined) process.stdout.write(JSON.stringify(answer) + "\n");
  };
  const answer = async (line: string) => {
    pending++;
    try {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
      write(await server.handle(message));
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } });
    } finally {
      pending--;
      done();
    }
  };

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line) void answer(line);
    }
  });
  process.stdin.on("end", () => {
    ended = true;
    done();
  });
}

/**
 * `doctor [--property <id>] [--room-type <id> --night <YYYY-MM-DD> [--rate-plan <id>]] [--json]`: the checks
 * of src/doctor.ts, printed. Exit 0: nothing needs attention; 1: something does; 2: the command was not understood.
 */
async function doctor(args: string[]): Promise<number> {
  let propertyId: number | undefined;
  let roomTypeId: number | undefined;
  let ratePlanId: number | undefined;
  let date: string | undefined;
  let asJson = false;
  const ID_OPTIONS = { "--property": "a hotel's numeric id", "--room-type": "a room type's numeric id", "--rate-plan": "a rate plan's numeric id" } as const;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (arg === "--json") asJson = true;
    else if (name in ID_OPTIONS) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++i];
      if (!value || !/^[1-9]\d*$/.test(value)) {
        process.stderr.write(`${name} takes ${ID_OPTIONS[name as keyof typeof ID_OPTIONS]}\n`);
        return 2;
      }
      if (name === "--property") propertyId = Number(value);
      else if (name === "--room-type") roomTypeId = Number(value);
      else ratePlanId = Number(value);
    } else if (name === "--night") {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++i];
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        process.stderr.write("--night takes a date as YYYY-MM-DD, in the hotel's own calendar\n");
        return 2;
      }
      date = value;
    } else {
      process.stderr.write(`Unknown option for doctor: ${arg}\n\n${HELP}`);
      return 2;
    }
  }
  const found = findKey(process.env, process.cwd());
  // An empty key is a finding like any other: the report says where to put one. Never the environment's by accident.
  if ((roomTypeId === undefined) !== (date === undefined) || (ratePlanId !== undefined && roomTypeId === undefined)) {
    process.stderr.write("To explain a night, give both --room-type <id> and --night <YYYY-MM-DD>; --rate-plan <id> narrows it to one plan.\n");
    return 2;
  }
  const night = roomTypeId !== undefined && date !== undefined ? { roomTypeId, date, ...(ratePlanId === undefined ? {} : { ratePlanId }) } : undefined;
  const report = await diagnose({ apiKey: found.apiKey ?? "", propertyId, ...(night ? { night } : {}) });
  if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(`${formatDoctorReport(report)}\n${found.keySource ? `\nThe key was read from ${found.keySource}.\n` : ""}`);
  return report.ok ? 0 : 1;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "mcp") serve();
else if (command === "doctor") {
  doctor(rest).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      // Whatever went wrong, the words are for a person and never the key.
      process.stderr.write("The doctor stopped before it had a report. Run it again; if it repeats, write to support@zimmerstack.com.\n");
      process.exitCode = 1;
    }
  );
} else if (command === "--version" || command === "-v") process.stdout.write(SDK_VERSION + "\n");
else {
  process.stdout.write(HELP);
  process.exitCode = command === undefined || command === "--help" || command === "-h" ? 0 : 1;
}
