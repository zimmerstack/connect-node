import type { BookingCreate } from "@zimmerstack/connect";

import { zs } from "@/lib/zimmerstack";

// The Quickstart's steps (https://docs.zimmerstack.com/partner/first-call) with the package, one function per
// step. zs() is this app's one client: lib/zimmerstack.ts.

/** Which hotel is this key for, and what may it do? */
export async function whoAmI(): Promise<void> {
  // #region who-am-i
  // Which hotel, in which currency and timezone, and what this key may do.
  const property = await zs().property.get();
  console.log(`${property.name}: ${property.currency}, ${property.timezone}, scopes ${property.scopes.join(", ")}`);
  // #endregion
}

/** The ids every write and every booking names. */
export async function readCatalog(): Promise<void> {
  // #region catalog
  // Room types and their rate plans, with the ids every write and every booking names.
  // Keep them, read again when the owner changes the property, and never guess an id.
  const catalog = await zs().catalog.get();
  for (const room of catalog.roomTypes) {
    const plans = catalog.ratePlans.filter((plan) => plan.roomTypeId === room.id);
    console.log(room.id, room.name, plans.map((plan) => `${plan.id} ${plan.name}`).join(", "));
  }
  // #endregion
}

/** A software vendor's company key: list the hotels it reaches, then act on one. */
export async function companyKey(): Promise<void> {
  // #region company-key
  // The hotels this key may act on. A hotel's own key needs none of this: the key is the hotel.
  const { properties } = await zs().properties.list();

  for (const property of properties) {
    const hotel = zs().forProperty(property.id); // the same client and pace, acting on one hotel
    const catalog = await hotel.catalog.get();
    console.log(property.name, `${catalog.roomTypes.length} room types`);
  }
  // #endregion
}

/** A booking engine hands one booking to the PMS. `booking` is the body the Quickstart prints as booking.json. */
export async function postBooking(booking: BookingCreate): Promise<void> {
  // #region post-booking
  // You price the stay; externalReference is your own reservation id. The package may retry this
  // for you: the same externalReference always returns the same booking, never a second one.
  const created = await zs().bookings.create(booking);
  console.log(created.bookingId, created.reference, created.status);
  // #endregion
}

/** A PMS pushes how many rooms are left to sell, then sees the change reach the channels. */
export async function pushAvailability(roomTypeId: number, from: string, to: string): Promise<void> {
  // #region push-availability
  // A room count is the count, not a change to it. A range is one update, however many nights.
  const [accepted] = await zs().availability.set([{ roomTypeId, dateFrom: from, dateTo: to, available: 5 }]);
  if (!accepted) return;

  // Accepted means it is in ZimmerStack's record and on its way to the channels.
  // wait() asks no more often than every 15 seconds: "landed", or still "pending" after five minutes.
  const batch = await zs().batches.wait(accepted.batchId);
  const sync = await zs().sync.get(); // the whole property, at any time
  console.log(`${accepted.acceptedCells} nights, ${batch.status}, inventory ${sync.inventory.state}`);
  // #endregion
}
