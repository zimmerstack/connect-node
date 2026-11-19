#!/usr/bin/env node
import { SDK_VERSION } from "../generated.ts";
import { findKey } from "./key.ts";
import { createMcpServer } from "./server.ts";

/**
 * The package's command line. One command: `mcp`, the MCP server on stdin and stdout, for a
 * developer's coding agent (Claude Code, Cursor, …):
 *
 *   npx -y @zimmerstack/connect mcp
 *
 * stdout carries protocol messages and nothing else; anything for a person goes to stderr.
 */

const KEY_ENV = "ZIMMERSTACK_CONNECT_KEY";

const HELP = `@zimmerstack/connect ${SDK_VERSION}

  zimmerstack-connect mcp        Start the MCP server for a coding agent (stdin/stdout).
  zimmerstack-connect --version
  zimmerstack-connect --help

The MCP server gives an agent the rules for building on the ZimmerStack Connect API, a
reference generated from the API's contract, and calls on a SANDBOX. It reads the sandbox key
(zsk_test_…) from ${KEY_ENV}, in the environment or in the project's .env.local or
.env, and refuses a live key. Add it to an agent's MCP settings as:

  { "command": "npx", "args": ["-y", "@zimmerstack/connect", "mcp"] }
`;

function serve(): void {
  const found = findKey(process.env, process.cwd());
  const server = createMcpServer(found);
  const state = !found.apiKey ? "no key found: the rules and the reference work, sandbox calls will say how to add one" : found.apiKey.startsWith("zsk_test_") ? `sandbox key from ${found.keySource}` : `the key in ${found.keySource} is not a sandbox key: sandbox calls are refused`;
  process.stderr.write(`zimmerstack-connect mcp ${SDK_VERSION} ready (${state})\n`);

  let pending = 0;
  let ended = false;
  const done = () => {
    if (ended && pending === 0) process.exit(0);
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

const [command] = process.argv.slice(2);
if (command === "mcp") serve();
else if (command === "--version" || command === "-v") process.stdout.write(SDK_VERSION + "\n");
else {
  process.stdout.write(HELP);
  process.exitCode = command === undefined || command === "--help" || command === "-h" ? 0 : 1;
}
