import { isDriftEvent, isOtaBookingEvent, isSyncEvent, isWebsiteBookingEvent, type LoggedEvent } from "@zimmerstack/connect";

import { zs } from "@/lib/zimmerstack";

/**
 * The event log (https://docs.zimmerstack.com/events): the webhook is the nudge, the log is the truth.
 * Run this when a webhook arrives, on a schedule, and when your server starts. `place` is the last
 * sequence you applied for this hotel; keep it in your own database, with what you applied.
 */
export async function catchUp(place: number, savePlace: (sequence: number) => Promise<void>): Promise<number> {
  // #region catch-up
  // Every event after the place you saved, in order, to the end of the log.
  for await (const event of zs().events.all({ after: place }, { onGap: readBookingsAgain })) {
    await apply(event);
    // The event's sequence is your new place. Save it with what you applied, in one transaction.
    await savePlace(event.sequence);
    place = event.sequence;
  }
  // #endregion
  return place;
}

/** Yours to write: one event, applied once. The same event may be handed to you twice; `event.id` tells. */
async function apply(event: LoggedEvent): Promise<void> {
  // #region apply
  if (isOtaBookingEvent(event) || isWebsiteBookingEvent(event)) {
    // A booking arrived, changed or was cancelled. version counts its events: 1, 2, 3 and so on.
    console.log(event.sequence, event.type, event.data.booking.reference, "version", event.data.booking.version);
  } else if (isSyncEvent(event)) {
    // A problem with a booking site began (channel.sync.alert) or ended (channel.sync.recovered).
    console.log(event.sequence, event.type, event.data.sync.event);
  } else if (isDriftEvent(event)) {
    // A nightly read found a booking site's side holding something other than what you sent.
    console.log(event.sequence, event.type, event.data.drift.cellCount, "nights");
  }
  // A type you do not know yet is skipped, never an error: its sequence is still your place.
  // #endregion
}

/** Called once when the log no longer holds what follows your place: events are kept 90 days. */
function readBookingsAgain(gap: { after: number; earliestSequence: number }): void {
  // Read each booking's latest state with zs().channelBookings.all({ since }) and
  // zs().directBookings.all({ since }), then carry on from the log.
  console.log(`events ${gap.after + 1} to ${gap.earliestSequence - 1} are no longer in the log`);
}
