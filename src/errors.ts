import type { ErrorCode } from "./generated.ts";

/**
 * What the API answered when it refused a request, or what stopped a request before it was sent.
 *
 * Branch on `code`: it is stable. `message` is written for a person (show it to them) and may change.
 */
export class ZimmerStackError extends Error {
  /** The HTTP status; 0 when the request never reached the API (see `code`). */
  readonly status: number;
  /**
   * The API's stable code (RATE_LIMITED, RATE_OUT_OF_BAND, SCOPE_MISSING, …), or one of this client's own:
   * LIVE_KEY_IN_TEST, NETWORK_ERROR, TIMEOUT.
   */
  readonly code: ErrorCode | LocalErrorCode | (string & {});
  /** What the API said about it: the offending fields of a VALIDATION, the budget of a RATE_LIMITED, … */
  readonly details: unknown;
  /** Seconds until the same request can pass, when the API said so (429 and 503). */
  readonly retryAfterSeconds: number | undefined;
  /** Which budget refused, on a RATE_LIMITED (writes, cells-hour, modifier-changes-day, …). */
  readonly scope: string | undefined;
  /**
   * true when the same request may pass later (a used-up budget, a fault on ZimmerStack's side, a
   * network failure). The client has already retried what was worth holding a request open for;
   * anything false is a verdict on the request itself: fix it, never resend it.
   */
  readonly retryable: boolean;
  /** The operation that failed, as the contract names it: "PUT /rates". Never contains the key. */
  readonly operation: string;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    operation: string;
    details?: unknown;
    retryAfterSeconds?: number;
    scope?: string;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ZimmerStackError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.scope = init.scope;
    this.retryable = init.retryable;
    this.operation = init.operation;
  }
}

/** Codes this client raises itself, before or instead of an answer from the API. */
export type LocalErrorCode = "LIVE_KEY_IN_TEST" | "NETWORK_ERROR" | "TIMEOUT";

/** A mistake in how the client was set up or called. Nothing was sent. */
export class ZimmerStackUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZimmerStackUsageError";
  }
}
