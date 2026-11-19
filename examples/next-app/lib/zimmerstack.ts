import { ZimmerStack, ZimmerStackError } from "@zimmerstack/connect";

let client: ZimmerStack | undefined;

/**
 * The one ZimmerStack client of this app. It reads the key from the environment variable
 * ZIMMERSTACK_CONNECT_KEY (zsk_test_… while you build). Server only: use it from route handlers and
 * server actions, never from a component marked "use client".
 */
export function zs(): ZimmerStack {
  return (client ??= new ZimmerStack());
}

/**
 * Turn a refusal into an answer for your own frontend: the API's sentence for the person, its stable
 * code for your UI to branch on, and when to try again if it said so. The client has already retried
 * what was worth retrying, so nothing here loops.
 */
export function refusal(err: unknown): Response {
  if (!(err instanceof ZimmerStackError)) throw err;
  const status = err.status === 429 ? 429 : err.status >= 400 && err.status < 500 ? 400 : 502;
  return Response.json({ error: err.message, code: err.code, retryAfterSeconds: err.retryAfterSeconds ?? null }, { status });
}
