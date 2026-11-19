import type { ChannelBooking } from "./generated.ts";

/**
 * Verifying a webhook ZimmerStack sent you (Standard Webhooks: the `webhook-id`, `webhook-timestamp` and
 * `webhook-signature` headers). Uses Web Crypto, so it runs on Node and on edge runtimes alike.
 */

/** An OTA booking arrived, changed or was cancelled (through the channel manager). */
export const OTA_BOOKING_EVENT_TYPES = ["channel.booking.created", "channel.booking.modified", "channel.booking.cancelled"] as const;
/**
 * A guest booked, or cancelled, on the hotel's own website through ZimmerStack's booking engine. The same
 * booking object as the OTA events, in a family of its own: an endpoint receives these only when it lists
 * the two types. There is no modified event.
 */
export const WEBSITE_BOOKING_EVENT_TYPES = ["direct.booking.created", "direct.booking.cancelled"] as const;
/** Every event whose `data.booking` is a booking, of either family. */
export const BOOKING_EVENT_TYPES = [...OTA_BOOKING_EVENT_TYPES, ...WEBSITE_BOOKING_EVENT_TYPES] as const;

export type OtaBookingEventType = (typeof OTA_BOOKING_EVENT_TYPES)[number];
export type WebsiteBookingEventType = (typeof WEBSITE_BOOKING_EVENT_TYPES)[number];
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];
/** Every type an endpoint can receive. A newer API may add more: `WebhookEvent.type` stays a string. */
export type WebhookEventType = BookingEventType | "channel.sync.alert" | "channel.sync.recovered" | "zimmerstack.ping";

/** What every delivery carries. Deliveries are at-least-once: dedupe on `id`, order on `occurredAt`. */
export interface WebhookEvent {
  /** "evt_<uuid>", the same on every retry and on every endpoint. */
  id: string;
  /**
   * channel.booking.created · channel.booking.modified · channel.booking.cancelled (an OTA booking) ·
   * direct.booking.created · direct.booking.cancelled (a booking on the hotel's own website) ·
   * channel.sync.* · zimmerstack.ping. Narrow it with `isOtaBookingEvent` and `isWebsiteBookingEvent`.
   */
  type: string;
  apiVersion: string;
  occurredAt: string;
  /** "test" for events from a sandbox or the "send test" button. */
  mode: "live" | "test";
  property: { id: number; name: string; currency: string; timezone: string; [key: string]: unknown };
  data: { booking?: ChannelBooking; [key: string]: unknown };
  /** Dotted paths that changed, on a modification ("stay.checkOut"). */
  changes?: string[] | null;
  /** What those fields held before, on a modification. */
  previous?: Record<string, unknown> | null;
  truncated?: boolean;
}

/** An event whose `data.booking` is there: of either booking family. */
export type BookingEvent = WebhookEvent & { type: BookingEventType; data: { booking: ChannelBooking; [key: string]: unknown } };
/** A booking a guest made on the hotel's own website. `finance` is null and `changes` and `previous` always are. */
export type WebsiteBookingEvent = BookingEvent & { type: WebsiteBookingEventType };
/** A booking an OTA sent. */
export type OtaBookingEvent = BookingEvent & { type: OtaBookingEventType };

const isType = (list: readonly string[], event: { type?: unknown } | null | undefined): boolean => typeof event?.type === "string" && list.includes(event.type);

/**
 * True for `direct.booking.created` and `direct.booking.cancelled`: a booking made on the hotel's own
 * website. A PMS that pushes room counts must put it in its own calendar before its next push.
 */
export function isWebsiteBookingEvent(event: WebhookEvent): event is WebsiteBookingEvent {
  return isType(WEBSITE_BOOKING_EVENT_TYPES, event) && Boolean(event.data?.booking);
}

/** True for `channel.booking.created`, `.modified` and `.cancelled`: a booking an OTA sent. */
export function isOtaBookingEvent(event: WebhookEvent): event is OtaBookingEvent {
  return isType(OTA_BOOKING_EVENT_TYPES, event) && Boolean(event.data?.booking);
}

export class ZimmerStackWebhookError extends Error {
  /** Why the delivery was refused. Answer 400 and do not act on the body. */
  readonly reason: "missing_headers" | "stale_timestamp" | "bad_signature" | "bad_body";
  constructor(reason: ZimmerStackWebhookError["reason"], message: string) {
    super(message);
    this.name = "ZimmerStackWebhookError";
    this.reason = reason;
  }
}

type HeaderBag = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === "function") return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  const bag = headers as Record<string, string | string[] | undefined>;
  const value = bag[name] ?? bag[Object.keys(bag).find((key) => key.toLowerCase() === name) ?? ""];
  return Array.isArray(value) ? value[0] : value;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Compares every byte whatever the first difference, so the time taken says nothing about the signature. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Check a delivery and return its event. Throws `ZimmerStackWebhookError` when the delivery is not
 * ZimmerStack's, is older than five minutes, or does not parse.
 *
 * `rawBody` must be the request body exactly as it arrived (the bytes, or the text before any JSON
 * parsing): a body that was parsed and written out again will not match its signature.
 *
 * @example
 * // Next.js route handler
 * export async function POST(req: Request) {
 *   const event = await verifyWebhook(await req.text(), req.headers, process.env.ZIMMERSTACK_WEBHOOK_SECRET!);
 *   // … dedupe on event.id, then act on event.type
 *   return new Response(null, { status: 204 });
 * }
 */
export async function verifyWebhook(
  rawBody: string | Uint8Array,
  headers: HeaderBag,
  secret: string,
  options: { toleranceSeconds?: number; now?: number } = {}
): Promise<WebhookEvent> {
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signature = header(headers, "webhook-signature");
  if (!id || !timestamp || !signature) throw new ZimmerStackWebhookError("missing_headers", "The webhook-id, webhook-timestamp and webhook-signature headers are required");
  if (!secret) throw new ZimmerStackWebhookError("bad_signature", "No webhook secret was given to verify against");

  const sent = Number(timestamp);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(sent) || Math.abs(now - sent) > (options.toleranceSeconds ?? 300)) {
    throw new ZimmerStackWebhookError("stale_timestamp", "The delivery's timestamp is outside the allowed window");
  }

  const encoder = new TextEncoder();
  const body = typeof rawBody === "string" ? encoder.encode(rawBody) : rawBody;
  const prefix = encoder.encode(`${id}.${timestamp}.`);
  const content = new Uint8Array(prefix.length + body.length);
  content.set(prefix, 0);
  content.set(body, prefix.length);

  let expected: Uint8Array;
  try {
    const key = await crypto.subtle.importKey("raw", fromBase64(secret.trim().replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, content));
  } catch {
    throw new ZimmerStackWebhookError("bad_signature", "The webhook secret is not a valid whsec_ secret");
  }

  // During a secret rotation the header carries one signature per secret, space-separated.
  const matches = signature.split(/\s+/).some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    try {
      return equalBytes(fromBase64(value), expected);
    } catch {
      return false;
    }
  });
  if (!matches) throw new ZimmerStackWebhookError("bad_signature", "The delivery's signature does not match");

  try {
    const event = JSON.parse(typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody)) as WebhookEvent;
    if (!event || typeof event !== "object" || typeof event.id !== "string" || typeof event.type !== "string") throw new Error("not an event");
    return event;
  } catch {
    throw new ZimmerStackWebhookError("bad_body", "The delivery is signed correctly but its body is not an event");
  }
}
