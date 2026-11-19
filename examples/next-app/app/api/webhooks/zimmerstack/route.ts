import { ZimmerStackWebhookError, isOtaBookingEvent, isWebsiteBookingEvent, verifyWebhook, type OtaBookingEvent, type WebhookEvent, type WebsiteBookingEvent } from "@zimmerstack/connect";

/** POST /api/webhooks/zimmerstack: a booking arrived, changed or was cancelled, from an OTA or from the hotel's own website. */
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
  if (isOtaBookingEvent(event)) {
    // channel.booking.created · .modified · .cancelled: a booking an OTA sent.
    await saveBooking(event);
  } else if (isWebsiteBookingEvent(event)) {
    // direct.booking.created · .cancelled: a guest booked, or cancelled, on the hotel's own website. The
    // endpoint receives these only when it lists both types. There is no modified event.
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
 * channels hold at once, so a cancelled one gives it back; apply it BEFORE your next push of room counts,
 * or that push puts the sold room back on sale.
 */
async function applyWebsiteBooking(event: WebsiteBookingEvent): Promise<void> {
  void event;
}
