import type { ChannelBooking, ChannelConnectEvent, ChannelDriftEvent, ChannelSyncEvent, Status, SupportTicket } from "./generated.ts";

/**
 * Verifying a webhook ZimmerStack sent you (Standard Webhooks: the `webhook-id`, `webhook-timestamp` and
 * `webhook-signature` headers). Uses Web Crypto, so it runs on Node and on edge runtimes alike.
 */

/** An OTA booking arrived, changed or was cancelled (through the channel manager). */
export const OTA_BOOKING_EVENT_TYPES = ["channel.booking.created", "channel.booking.modified", "channel.booking.cancelled"] as const;
/**
 * A booking on the hotel's own website through ZimmerStack's booking engine: the guest booked, the hotel
 * recorded that the guest did not arrive (or undid that), or the booking was cancelled. The same booking
 * object as the OTA events, in a family of its own: an endpoint receives each of these only when it lists
 * that type.
 *
 * `direct.booking.modified` (from 0.6.0; the API sends it since 21 Nov 2026) is a no-show and its undo.
 * The booking is not cancelled: `status` stays CONFIRMED and the payment is untouched. Read
 * `data.booking.stayStatus`: NOSHOW means the nights are on sale again (free the room), UPCOMING again
 * means the no-show was undone (hold the room). Nothing else sends it yet.
 */
export const WEBSITE_BOOKING_EVENT_TYPES = ["direct.booking.created", "direct.booking.modified", "direct.booking.cancelled"] as const;
/** Every event whose `data.booking` is a booking, of either family. */
export const BOOKING_EVENT_TYPES = [...OTA_BOOKING_EVENT_TYPES, ...WEBSITE_BOOKING_EVENT_TYPES] as const;

export type OtaBookingEventType = (typeof OTA_BOOKING_EVENT_TYPES)[number];
export type WebsiteBookingEventType = (typeof WEBSITE_BOOKING_EVENT_TYPES)[number];
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];
/**
 * A channel problem and its end: a refused value, a disconnect, room counts or prices that stopped going
 * out, a setting changed (`data.sync.event` says which), then `recovered` when it is over.
 */
export const SYNC_EVENT_TYPES = ["channel.sync.alert", "channel.sync.recovered"] as const;
/**
 * The nightly read of the channel manager found it holding something other than what you sent
 * (`detected`: the nights, and which were sent again), then found them agreeing again (`healed`).
 * A family of its own: an endpoint receives it only when it lists the type.
 */
export const DRIFT_EVENT_TYPES = ["channel.drift.detected", "channel.drift.healed"] as const;
/**
 * How a one-time connect link ended (`zs.connectLinks.create`): the hotel's person pressed Start selling
 * on the hosted page (`completed`), or the link ran out first (`expired`). A family of its own: an
 * endpoint receives it only when it lists the type. It names its hotel, so it is in the hotel's event
 * log with a sequence.
 */
export const CONNECT_EVENT_TYPES = ["channel.connect.completed", "channel.connect.expired"] as const;
/**
 * ZimmerStack's staff recorded an incident that touches one of your hotels, said where it stands, or
 * ended it. Sent ONCE PER ENDPOINT, not once per hotel: `data.incident.properties` names your hotels it
 * touches. It carries no top-level `property` and no `sequence`, is not in the event log, and Recover
 * since does not replay it: `zs.status.get()` is the read. Only for an endpoint that lists the types.
 */
export const INCIDENT_EVENT_TYPES = ["platform.incident.opened", "platform.incident.updated", "platform.incident.resolved"] as const;
/**
 * ZimmerStack answered one of your support tickets (`replied`, with the message) or closed it. Sent to
 * your COMPANY endpoints of the ticket's mode that list the type. No top-level `property`, no `sequence`,
 * not in the event log: `zs.supportTickets.get(id)` is the read.
 */
export const SUPPORT_TICKET_EVENT_TYPES = ["support.ticket.replied", "support.ticket.closed"] as const;
export type SyncEventType = (typeof SYNC_EVENT_TYPES)[number];
export type DriftEventType = (typeof DRIFT_EVENT_TYPES)[number];
export type ConnectEventType = (typeof CONNECT_EVENT_TYPES)[number];
export type IncidentEventType = (typeof INCIDENT_EVENT_TYPES)[number];
export type SupportTicketEventType = (typeof SUPPORT_TICKET_EVENT_TYPES)[number];
/** Every type an endpoint can receive. A newer API may add more: `WebhookEvent.type` stays a string. */
export type WebhookEventType = BookingEventType | SyncEventType | DriftEventType | ConnectEventType | IncidentEventType | SupportTicketEventType | "zimmerstack.ping";

/** What every delivery carries. Deliveries are at-least-once: dedupe on `id`, order on `occurredAt`. */
export interface WebhookEvent {
  /** "evt_<uuid>", the same on every retry and on every endpoint. */
  id: string;
  /**
   * channel.booking.created · channel.booking.modified · channel.booking.cancelled (an OTA booking) ·
   * direct.booking.created · direct.booking.modified · direct.booking.cancelled (a booking on the hotel's own website) ·
   * channel.sync.* · channel.drift.* · channel.connect.* · platform.incident.* · support.ticket.* · zimmerstack.ping.
   * Narrow it with `isOtaBookingEvent`, `isWebsiteBookingEvent`, `isSyncEvent`, `isDriftEvent`, `isConnectEvent`,
   * `isIncidentEvent` and `isSupportTicketEvent`.
   */
  type: string;
  apiVersion: string;
  occurredAt: string;
  /** "test" for events from a sandbox or the "send test" button. */
  mode: "live" | "test";
  /**
   * The event's place in its hotel's ordered log: one higher than the hotel's last event, across every
   * type. When it is not the one after the last you applied, read what you missed with
   * `zs.events.all({ after })`. Absent on a Test button's sample and on events from before 22 Nov 2026.
   */
  sequence?: number;
  /**
   * The hotel the event is about. NOT THERE on `platform.incident.*` and `support.ticket.*`: those are about
   * your account, not one hotel. If your endpoint lists them, check `isIncidentEvent` and
   * `isSupportTicketEvent` before you read it.
   */
  property: { id: number; name: string; currency: string; timezone: string; [key: string]: unknown };
  data: { booking?: ChannelBooking; [key: string]: unknown };
  /** Dotted paths that changed, on a modification ("stay.checkOut"; on a website booking's no-show, "stayStatus" and "rooms[0].status"). */
  changes?: string[] | null;
  /** What those fields held before, on a modification. A website booking's carries `stayStatus` too. */
  previous?: Record<string, unknown> | null;
  truncated?: boolean;
}

/** An event whose `data.booking` is there: of either booking family. */
export type BookingEvent = WebhookEvent & { type: BookingEventType; data: { booking: ChannelBooking; [key: string]: unknown } };
/**
 * A booking a guest made on the hotel's own website. `finance` is always null; `changes` and `previous`
 * are set on `direct.booking.modified` (a no-show, or its undo) and null on the other two.
 */
export type WebsiteBookingEvent = BookingEvent & { type: WebsiteBookingEventType };
/** A booking an OTA sent. */
export type OtaBookingEvent = BookingEvent & { type: OtaBookingEventType };

const isType = (list: readonly string[], event: { type?: unknown } | null | undefined): boolean => typeof event?.type === "string" && list.includes(event.type);

/**
 * True for `direct.booking.created`, `direct.booking.modified` and `direct.booking.cancelled`: a booking
 * made on the hotel's own website. A PMS that pushes room counts must put it in its own calendar before its
 * next push, and give the nights back when the booking is cancelled or reads `stayStatus` NOSHOW.
 */
export function isWebsiteBookingEvent(event: WebhookEvent): event is WebsiteBookingEvent {
  return isType(WEBSITE_BOOKING_EVENT_TYPES, event) && Boolean(event.data?.booking);
}

/** True for `channel.booking.created`, `.modified` and `.cancelled`: a booking an OTA sent. */
export function isOtaBookingEvent(event: WebhookEvent): event is OtaBookingEvent {
  return isType(OTA_BOOKING_EVENT_TYPES, event) && Boolean(event.data?.booking);
}

/** A channel problem or its end, with `data.sync`. */
export type SyncEvent = WebhookEvent & { type: SyncEventType; data: { sync: ChannelSyncEvent["data"]["sync"]; [key: string]: unknown } };
/** What a nightly read found changed on the channel manager's side, with `data.drift`. */
export type DriftEvent = WebhookEvent & { type: DriftEventType; data: { drift: ChannelDriftEvent["data"]["drift"]; [key: string]: unknown } };

/** True for `channel.sync.alert` and `channel.sync.recovered`: `event.data.sync` says which problem, on which channel. */
export function isSyncEvent(event: WebhookEvent): event is SyncEvent {
  return isType(SYNC_EVENT_TYPES, event) && Boolean(event.data?.sync);
}

/** True for `channel.drift.detected` and `channel.drift.healed`: `event.data.drift.cells` names the nights. */
export function isDriftEvent(event: WebhookEvent): event is DriftEvent {
  return isType(DRIFT_EVENT_TYPES, event) && Boolean(event.data?.drift);
}

/** How a one-time connect link ended, with `data.connect`. It names its hotel (`property`) and has a `sequence`. */
export type ConnectEvent = WebhookEvent & { type: ConnectEventType; data: { connect: ChannelConnectEvent["data"]["connect"]; [key: string]: unknown } };

/**
 * True for `channel.connect.completed` and `channel.connect.expired`. Match it to your link by
 * `data.connect.linkId` (the id `zs.connectLinks.create` answered; the event never carries the link's
 * address or your `reference`, because the hotel's own endpoints hear it too).
 *
 * `completed`: `selling` is true, `channelId` is the connection (`zs.channels.list()`), and
 * `futureBookings` says what became of the booking site's upcoming bookings: "pulled" (they arrive as
 * `channel.booking.created`), "failed" (the pull did not run; selling is on all the same) or "none"
 * (that booking site offers no such pull). `expired`: `opened` says whether anyone opened the link, and
 * `channelId` is set when the page saved a connection nobody started: it exists, paused.
 */
export function isConnectEvent(event: WebhookEvent): event is ConnectEvent {
  return isType(CONNECT_EVENT_TYPES, event) && Boolean(event.data?.connect);
}

/** An incident, as its events carry it: where it stands now, what we said with this change, and which of YOUR hotels it touches. */
export interface IncidentInEvent {
  /** The same on opened, every updated and resolved, and on `zs.status.get()`: group on it. */
  id: number;
  /** api · bookings_in · ari_out · ota:<booking site>. */
  component: string;
  componentName: string;
  severity: Status["incidents"]["open"][number]["severity"];
  status: Status["incidents"]["open"][number]["status"];
  title: string;
  /** What ZimmerStack said with this change, in plain words. */
  message: string;
  startedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Your hotels it touches: `all` when it touches every hotel, else their ids (at most 200; `count` has the real number). */
  properties: { all: boolean; count: number; ids: number[]; truncated: boolean };
}

/**
 * A `platform.incident.*` delivery. It is about your account, so it has NO `property` and NO `sequence`:
 * it is not in any hotel's event log. `zs.status.get()` reads the same incident at any time.
 */
export interface IncidentEvent {
  /** "evt_<uuid>", the same on every retry. */
  id: string;
  type: IncidentEventType;
  apiVersion: string;
  occurredAt: string;
  mode: "live" | "test";
  data: { incident: IncidentInEvent };
}

/** A support ticket, as its events carry it: where it stands, never the whole thread. */
export interface TicketInEvent {
  id: number;
  subject: string;
  severity: SupportTicket["severity"];
  status: SupportTicket["status"];
  properties: { all: boolean; ids: number[] };
  openedAt: string;
  lastMessageAt: string;
  closedAt: string | null;
}

/**
 * A `support.ticket.*` delivery. `data.message` is ZimmerStack's reply on `replied`, and the closing
 * note on `closed` when there was one (null otherwise). A long message is cut (`truncated`):
 * `zs.supportTickets.get(id)` has it whole. NO `property` and NO `sequence`.
 */
export interface SupportTicketEvent {
  id: string;
  type: SupportTicketEventType;
  apiVersion: string;
  occurredAt: string;
  mode: "live" | "test";
  data: { ticket: TicketInEvent; message: { id: number; author: "zimmerstack"; body: string; truncated: boolean; createdAt: string } | null };
}

/** Anything a guard can look at: a verified delivery, or a body you parsed yourself. */
type Typed = { type?: unknown; data?: unknown } | null | undefined;
const dataOf = (event: Typed): Record<string, unknown> => (event && typeof event.data === "object" && event.data !== null ? (event.data as Record<string, unknown>) : {});

/**
 * True for `platform.incident.opened`, `.updated` and `.resolved`. Check it BEFORE reading
 * `event.property`: an incident event has none.
 *
 * @example
 * const event = await verifyWebhook(rawBody, headers, secret);
 * if (isIncidentEvent(event)) return showBanner(event.data.incident.title, event.data.incident.status, event.data.incident.properties.ids);
 */
export function isIncidentEvent(event: Typed): event is IncidentEvent {
  return isType(INCIDENT_EVENT_TYPES, event) && Boolean(dataOf(event).incident);
}

/** True for `support.ticket.replied` and `support.ticket.closed`. Check it BEFORE reading `event.property`: it has none. */
export function isSupportTicketEvent(event: Typed): event is SupportTicketEvent {
  return isType(SUPPORT_TICKET_EVENT_TYPES, event) && Boolean(dataOf(event).ticket);
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
