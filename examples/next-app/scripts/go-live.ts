import { shownOnce, withoutShownOnce, type AvailabilityWrite, type RatesWrite } from "@zimmerstack/connect";

import { zs } from "@/lib/zimmerstack";

/*
 * A software partner's company key, without the partner portal: a one-time connect link for a booking
 * site, the readiness report and go-live, and the keys it made on a hotel
 * (https://docs.zimmerstack.com/guides/connect-an-ota, /partner/go-live, /guides/keys-and-scopes#hotel-keys).
 */

/**
 * Have the hotel's own person connect Booking.com. Only Airbnb is connected from the link alone: every other
 * booking site must first accept our connectivity partner for the hotel, so the step goes before the link.
 */
export async function sendConnectLink(propertyId: number, stepThenLink: (firstStep: string | null, url: string) => Promise<void>): Promise<string> {
  // #region connect-link
  // One link, one hotel, one booking site. A live key only: a sandbox has no booking site to connect.
  const made = await zs().connectLinks.create({ propertyId, channel: "bookingcom", reference: "onboarding-4471" });

  // hotelStep is what the hotel does at the booking site FIRST (null for Airbnb). It can take days.
  // Tell the hotel the step now; send the address once the hotel has done it. On the page the
  // hotel's person types its hotel id at the booking site, matches the rooms and starts selling.
  // The address is in this answer only and opens once: keep it safe, never log it.
  await stepThenLink(made.hotelStep, shownOnce(made));
  console.log(withoutShownOnce(made).link.id, made.link.status, "opens until", made.link.expiresAt);
  // #endregion
  return made.link.id;
}

/** Is this hotel ready for your software to be its source of truth? */
export async function readReadiness(propertyId: number): Promise<boolean> {
  // #region readiness
  const report = await zs().forProperty(propertyId).readiness.get();
  console.log(report.live ? "already live" : report.ready ? "ready" : "not ready");

  // Each check that did not pass says what it found and what to do.
  for (const check of report.checks) if (!check.passed) console.log(check.id, check.summary, check.action);
  // #endregion
  return report.ready;
}

/** Send a year of prices first, switch, then send the room counts. Call it when a person decided this hotel goes live. */
export async function sendAheadAndGoLive(propertyId: number, aYearOfPrices: RatesWrite["updates"], aYearOfCounts: AvailabilityWrite["updates"]): Promise<void> {
  // #region send-ahead-and-go-live
  const hotel = zs().forProperty(propertyId);

  // beforeGoLive says you know the hotel is not live yet. These prices are stored and WAIT for go-live.
  const sent = await hotel.rates.set(aYearOfPrices, { beforeGoLive: true });
  console.log(sent[0]?.heldUntilGoLive ? "stored, waiting for go-live" : "sent");

  // Room counts are NOT sent ahead. Until the hotel is live a count may only lower what is on sale
  // (it goes to the booking sites at once); a count that raises it is refused, in the answer's rejected list.

  const report = await hotel.readiness.get();
  if (!report.ready) return console.log("not ready yet:", report.checks.filter((c) => !c.passed).map((c) => c.id).join(", "));

  // The switch. From now on everything you send is pushed, and what waited goes out.
  const live = await hotel.readiness.goLive();
  console.log(live.live, live.replay ? "it already was" : `since ${live.wentLiveAt}`);

  // Now the room counts: live, they are sent exactly as you write them.
  await hotel.availability.set(aYearOfCounts);
  // #endregion
}

/** Mint a key on a hotel you added, and keep it. */
export async function mintHotelKey(propertyId: number, store: (key: string) => Promise<void>): Promise<number> {
  // #region hotel-key
  const minted = await zs().hotelKeys.create(propertyId, { name: "Night audit job", scopes: ["ari:read", "channel-bookings:read"] });

  // The key is in this answer only. Store it before anything else; shownOnce never hands you an empty one.
  await store(shownOnce(minted));
  // What is safe to log: the answer without the key.
  console.log(withoutShownOnce(minted).view.maskedKey, minted.view.scopes.join(", "));
  // #endregion
  return minted.view.id;
}

/** Replace a key: the old one keeps answering for 24 hours, so nothing stops. */
export async function rotateHotelKey(propertyId: number, keyId: number, store: (key: string) => Promise<void>): Promise<void> {
  // #region rotate-hotel-key
  const rotated = await zs().hotelKeys.rotate(propertyId, keyId);
  await store(shownOnce(rotated));
  console.log("the old key answers until", rotated.retired.retireAt);
  // #endregion
}
