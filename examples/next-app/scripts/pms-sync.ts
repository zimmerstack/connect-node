import { zs } from "@/lib/zimmerstack";

// Channel manager (https://docs.zimmerstack.com/reference), for a PMS that keeps its own bookings:
// the hotel's room types and rate plans by API, and the bookings that come back.

/** The PMS owns the hotel's structure: send the list, by your own ids. Needs the scope catalog:write. */
export async function sendStructure(): Promise<void> {
  // #region structure
  // Upsert by ref, your own id: what is new is created, what differs is changed, the rest is left.
  const rooms = await zs().catalog.upsertRoomTypes({
    roomTypes: [{ ref: "rt-deluxe", name: "Deluxe Garden Room", roomCount: 8, adults: 2, children: 1 }],
  });

  // A plan names its room type by the ref you gave it. defaultRate is its standing price, in major units.
  const plans = await zs().catalog.upsertRatePlans({
    ratePlans: [{ ref: "rp-bb", roomTypeRef: "rt-deluxe", name: "Bed and breakfast", mealPlan: "CP", occupancy: 2, defaultRate: 4500 }],
  });

  // Each answer names our id for the entity (what every later write uses), what was done, and its sync.
  for (const item of [...rooms.items, ...plans.items]) console.log(item.ref, item.id, item.action, item.sync);
  // #endregion
}

/** One room type or one rate plan at a time, and how to delete one. Needs the scope catalog:write. */
export async function oneAtATime(): Promise<void> {
  // #region one-at-a-time
  // Create a room type, or change it when you sent this ref before. The answer carries our id for it.
  const room = await zs().roomTypes.save({ ref: "rt-penthouse", name: "Penthouse", roomCount: 1, adults: 3, children: 1 });

  // A rate plan that sells it. defaultRate is its standing price, in major units: 12000 = 12,000.00.
  const plan = await zs().ratePlans.save({ ref: "rp-ph-ro", roomTypeRef: "rt-penthouse", name: "Room only", mealPlan: "EP", defaultRate: 12000 });
  console.log(room.id, room.action, plan.id, plan.action);

  // Delete by your own ref (a string) or by our id (a number). There is no undo, so call it only when a
  // person chose to delete. A plan a channel still sells is refused; a room type takes its plans with it.
  const gone = await zs().ratePlans.delete("rp-bb");
  console.log(gone.id, gone.deleted);
  // #endregion
}

/** OTA bookings, pulled: for a missed webhook delivery, or a system that prefers to poll. Scope channel-bookings:read. */
export async function pullOtaBookings(since: string): Promise<void> {
  // #region ota-bookings
  // Every OTA booking changed since that instant (ISO 8601), in its latest version, cancellations
  // included: the same booking object the webhooks carry. all() follows the cursor for you.
  for await (const booking of zs().channelBookings.all({ since })) {
    console.log(booking.reference, booking.status, booking.channel.otaName);
  }
  // #endregion
}

/** Website bookings, pulled: read these BEFORE a full push of room counts. Scope direct-bookings:read. */
export async function pullWebsiteBookings(since: string): Promise<void> {
  // #region website-bookings
  // A booking on the hotel's own website took a room off the count the channels hold. Apply each one
  // to your own calendar before your next zs().availability.set, or that push puts the sold room back on sale.
  for await (const booking of zs().directBookings.all({ since })) {
    console.log(booking.reference, booking.status); // then: applyToMyCalendar(booking)
  }
  // #endregion
}
