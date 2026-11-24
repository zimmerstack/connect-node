import type { DirectBookingCancel } from "@zimmerstack/connect";

import { zs } from "@/lib/zimmerstack";

/**
 * Cancel a booking a guest made on the hotel's own website, from your PMS, with the refund the person at
 * the desk chose (https://docs.zimmerstack.com/guides/website-bookings#cancel). The key needs the scope
 * direct-bookings:cancel. Call it from that person's own cancel button: it moves the guest's money.
 */
export async function cancelWebsiteBooking(bookingId: number, refund: DirectBookingCancel["refund"], reason: string): Promise<void> {
  // #region cancel
  // refund: "policy" when the guest asked to cancel, "full" when the hotel is at fault (an overbooking),
  // "none" when the hotel settles the money another way. Left out, it is "policy".
  const answer = await zs().directBookings.cancel(bookingId, { refund, reason });
  // What the guest gets back, in major units, and where it stands: NONE, PENDING, PROCESSED or MANUAL.
  console.log(answer.booking.status, answer.refund.amount, answer.refund.currency, answer.refund.status);
  // replay: true means it was already cancelled and no money moved this time.
  if (answer.replay) console.log("already cancelled");
  // #endregion
}
