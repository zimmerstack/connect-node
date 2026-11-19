import { readFileSync } from "node:fs";
import { join } from "node:path";

const KEY_ENV = "ZIMMERSTACK_CONNECT_KEY";

/**
 * The project's key, for the MCP server: the environment first, then the `.env.local` and the `.env` of
 * the folder the agent started the server in (where a developer keeps it while building). Only where it
 * was found is ever reported; the value is handed to the server, which uses a sandbox key and nothing else.
 */
export function findKey(env: Record<string, string | undefined>, cwd: string): { apiKey?: string; keySource?: string } {
  const fromEnv = env[KEY_ENV]?.trim();
  if (fromEnv) return { apiKey: fromEnv, keySource: "the environment" };
  for (const file of [".env.local", ".env"]) {
    let text: string;
    try {
      text = readFileSync(join(cwd, file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?ZIMMERSTACK_CONNECT_KEY\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const value = (match[1] ?? "").trim().replace(/\s+#.*$/, "").replace(/^(['"])(.*)\1$/, "$2").trim();
      if (value) return { apiKey: value, keySource: file };
    }
  }
  return {};
}
