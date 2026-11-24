import { zs } from "@/lib/zimmerstack";

/** Bookings (https://docs.zimmerstack.com/one-hotel/website-bookings): read back what your booking engine handed to the PMS, and cancel one. */
export async function readAndCancel(bookingId: number): Promise<void> {
  // #region read-and-cancel
  // What this API created on the property, newest first. Front-desk and OTA bookings are never listed.
  const { items } = await zs().bookings.list();
  console.log(items.map((item) => `${item.reference} ${item.status}`).join(", "));

  // One booking, by the bookingId its create answered with.
  const booking = await zs().bookings.get(bookingId);

  // Cancel the whole booking: its nights re-open on the channels. One the desk has already checked
  // in is refused (BOOKING_NOT_CANCELLABLE). To change dates or rooms, cancel and create again.
  if (booking.status === "UPCOMING") await zs().bookings.cancel(bookingId, { reason: "The guest cancelled on our website" });
  // #endregion
}
