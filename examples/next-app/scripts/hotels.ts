import { zs } from "@/lib/zimmerstack";

/*
 * A software partner adds a hotel and removes one it added, with its company key (scope properties:write).
 * The docs' "Add and remove hotels" page prints the two steps below. With a zsk_test_ key the same two
 * calls make and delete a sandbox, so you can try them without touching a real hotel or your invoice.
 */

/** Add a hotel: the answer's id is the one every later call names. */
export async function addHotel(): Promise<number> {
  // #region add-a-hotel
  // The hotel's name, its owner, its address and its room types. The owner gets the sign-in details by
  // email; they are never sent to you. defaultRate is in the hotel's own money, in major units.
  const added = await zs().properties.create({
    name: "Ganga Guest House",
    owner: { name: "Meera Joshi", email: "meera@gangaguesthouse.example", phone: "+91 98765 43210" },
    address: { line1: "14 Assi Ghat Road", city: "Varanasi", country: "IN" },
    roomTypes: [{ ref: "rt-river", name: "River View Room", roomCount: 6, defaultRate: 3200 }],
  });
  console.log(added.id, added.name, added.billing.state, added.replay);

  // From now on, name that id. The first room types you send put the hotel on the channel manager:
  // the same ref as above, so it becomes that room type and not a second one.
  const theHotel = zs().forProperty(added.id);
  const room = await theHotel.roomTypes.save({ ref: "rt-river", name: "River View Room", roomCount: 6, adults: 2 });
  console.log(room.id, room.action);
  // #endregion
  return added.id;
}

/** Remove a hotel you added, for good. Call it only when a person chose to remove that hotel. */
export async function removeHotel(propertyId: number): Promise<void> {
  // #region remove-a-hotel
  // Read the hotel's name first: confirm must be its exact name, so a wrong id never removes a hotel.
  const { properties } = await zs().properties.list();
  const hotel = properties.find((p) => p.id === propertyId);
  if (!hotel) throw new Error(`No hotel ${propertyId} that this key reaches.`);

  // One call, in this order: its booking sites are disconnected, its rate plans and then its room types
  // are removed from the channel manager, and the hotel is closed. There is no undo.
  const gone = await zs().properties.delete(hotel.id, { confirm: hotel.name });

  // REMOVED: nothing is left on the channel manager. RETRYING: the hotel is closed and off your invoice,
  // and one step is still finishing; ZimmerStack retries it, so do not call again in a loop.
  console.log(gone.removed, gone.billing.state, gone.channelManager.state);
  // #endregion
}
