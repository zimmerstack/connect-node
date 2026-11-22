import {
  ZimmerStackWebhookError,
  isConnectEvent,
  isIncidentEvent,
  isOtaBookingEvent,
  isSupportTicketEvent,
  isWebsiteBookingEvent,
  verifyWebhook,
  type ConnectEvent,
  type IncidentEvent,
  type OtaBookingEvent,
  type SupportTicketEvent,
  type WebhookEvent,
  type WebsiteBookingEvent,
} from "@zimmerstack/connect";

/**
 * POST /api/webhooks/zimmerstack: a booking arrived, changed, was a no-show or was cancelled, from an OTA or
 * from the hotel's own website; a connect link ended; ZimmerStack opened or ended an incident, or answered
 * a support ticket. An endpoint receives each family only when it lists its types.
 */
export async function POST(request: Request): Promise<Response> {
  let event: WebhookEvent;
  try {
    // The body exactly as it arrived: read it as text, before any JSON parsing.
    event = await verifyWebhook(await request.text(), request.headers, process.env.ZIMMERSTACK_WEBHOOK_SECRET ?? "");
  } catch (err) {
    if (err instanceof ZimmerStackWebhookError) return new Response(null, { status: 400 });
    throw err;
  }

  // Deliveries are at-least-once: remember event.id and skip one you have already handled.
  // Two families are about your account, not one hotel: they carry no event.property and no sequence.
  // Tell them apart FIRST, before any code that reads the hotel.
  if (isIncidentEvent(event)) {
    // platform.incident.opened · .updated · .resolved: something is wrong on ZimmerStack's side.
    await showIncident(event);
  } else if (isSupportTicketEvent(event)) {
    // support.ticket.replied · .closed: ZimmerStack answered your ticket.
    await showTicketReply(event);
  } else if (isConnectEvent(event)) {
    // channel.connect.completed · .expired: how a one-time connect link ended. This one names its hotel.
    await connectLinkEnded(event);
  } else if (isOtaBookingEvent(event)) {
    // channel.booking.created · .modified · .cancelled: a booking an OTA sent.
    await saveBooking(event);
  } else if (isWebsiteBookingEvent(event)) {
    // direct.booking.created · .modified · .cancelled: a guest booked on the hotel's own website, the hotel
    // recorded that the guest did not arrive (or undid that), or the booking was cancelled. The endpoint
    // receives each only when it lists that type.
    await applyWebsiteBooking(event);
  }
  // Answer fast (within a few seconds) and do slow work afterwards: a slow answer is retried.
  return new Response(null, { status: 204 });
}

/** Yours to write: store event.data.booking under its reference, in your own database. */
async function saveBooking(event: OtaBookingEvent): Promise<void> {
  void event;
}

/**
 * Yours to write: put the booking in your own calendar. A website booking takes one room off the count the
 * channels hold at once; apply it BEFORE your next push of room counts, or that push puts the sold room back
 * on sale. A room gives its nights back when its `status` reads CANCELLED or NOSHOW: a cancelled booking
 * frees every room, and a no-show (direct.booking.modified, `stayStatus` NOSHOW) frees them too although the
 * booking's `status` stays CONFIRMED and the hotel keeps the payment. A no-show the hotel undid reads
 * UPCOMING again: hold the room.
 */
async function applyWebsiteBooking(event: WebsiteBookingEvent): Promise<void> {
  void event;
}

/**
 * Yours to write: show a banner to the hotels in event.data.incident.properties (all of them when
 * `all` is true), with the title and what ZimmerStack said. Keep what people change meanwhile and send
 * it when `status` reads resolved; do not resend everything.
 */
async function showIncident(event: IncidentEvent): Promise<void> {
  void event;
}

/** Yours to write: show event.data.message to whoever opened ticket event.data.ticket.id. */
async function showTicketReply(event: SupportTicketEvent): Promise<void> {
  void event;
}

/**
 * Yours to write: find your link by event.data.connect.linkId. `completed`: the booking site is selling,
 * and its upcoming bookings follow as channel.booking.created when futureBookings is "pulled".
 * `expired`: nobody finished; make a new link.
 */
async function connectLinkEnded(event: ConnectEvent): Promise<void> {
  void event;
}
