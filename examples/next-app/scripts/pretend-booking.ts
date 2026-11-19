import { zs } from "@/lib/zimmerstack";

/** The sandbox (https://docs.zimmerstack.com/sandbox): have ZimmerStack send you an OTA booking. Test keys only. */
export async function pretendBooking(roomTypeId: number, checkIn: string): Promise<void> {
  // #region pretend-booking
  // A pretend Booking.com guest on your sandbox. The nights come off the room type's availability and
  // your webhook endpoint receives the real channel.booking.created delivery, signed, with mode "test".
  const booking = await zs().sandbox.bookings.create({ roomTypeId, checkIn, nights: 2, guestName: "Asha Verma", otaName: "Booking.com" });
  console.log(booking.reference, booking.status, booking.webhook.eventType);

  // Cancel it: channel.booking.cancelled is delivered the same way.
  await zs().sandbox.bookings.cancel(booking.bookingId);
  // #endregion
}
