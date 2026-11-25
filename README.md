# @zimmerstack/connect

Add a channel manager to your hotel software. This package sends a hotel's rooms and prices to
Booking.com, Airbnb, Expedia, Agoda, MakeMyTrip and the other booking sites, and brings their bookings
back to you.

- **Free to build.** You get a sandbox with a practice hotel the moment you sign up, and your software
  can create more. Nothing you do there reaches a real booking site.
- **Public prices.** A fixed price for each live property a month, on one invoice. A partner in India
  pays the price plus GST. A partner outside India pays its own price, with nothing added. You accept
  it in the partner portal. Going live has a one-time onboarding fee of $50, paid once in the portal
  before your live key. The price list: <https://docs.zimmerstack.com/pricing>
- **Made for AI coding tools.** The package carries its own rules file and a helper your coding agent
  can ask. See [For AI coding agents](#for-ai-coding-agents).

[Docs](https://docs.zimmerstack.com) · [Quickstart](https://docs.zimmerstack.com/partner/first-call) ·
[Pricing](https://docs.zimmerstack.com/pricing) · [Partner portal](https://partner.zimmerstack.com/login) ·
[Starter app](https://github.com/zimmerstack/connect-starter) ·
[Source](https://github.com/zimmerstack/connect-node) ·
[Changelog](https://docs.zimmerstack.com/changelog) · <support@zimmerstack.com>

## Start here

You learn the API in the order a hotel is made: the hotel, its room types, its rate plans, then its
rooms and prices. All of it happens in your sandbox, with a test key. Nothing reaches a real booking
site and nothing is billed.

**1. Sign up.** It is free and takes one emailed code:
<https://www.zimmerstack.com/partners/pms-companies#join>. You get a sandbox: the place where your test
hotels live. A test hotel is a practice hotel that no booking site ever sees. One example test hotel is
made for you. Working for one hotel only? Its owner makes your key in Admin → Developers → API keys.
You join at step 3 and skip step 6, because your hotel is already there. Where a later step says
`hotel`, use `zs`.

**2. Make a test key.** Open the [partner portal](https://partner.zimmerstack.com/login), then
Developers, then **Create company key**. Under **Reaches**, choose **Your sandbox (zsk_test_)**. Keep
**Also add and remove hotels** ticked, then press **Create company key**. The key starts with
`zsk_test_` and is shown once, so copy it now. It is one key for all your test hotels, so each call
says which hotel it is for.

**3. Install the package.** It needs Node 20 or newer.

```bash
npm install @zimmerstack/connect
```

**4. Put the key on your server.** Keep it out of your code.

```bash
# .env (do not commit this file)
ZIMMERSTACK_CONNECT_KEY=zsk_test_…
```

**5. Make your first call.** Ask which hotels your key reaches.

```ts
import { ZimmerStack } from "@zimmerstack/connect";

const zs = new ZimmerStack(); // reads ZIMMERSTACK_CONNECT_KEY. Make one and reuse it.

const { properties } = await zs.properties.list();
for (const p of properties) console.log(p.id, p.name, p.currency, p.sandbox);
```

The list holds the example test hotel from step 1. Next, your software makes a hotel itself.

**6. Create a hotel.** With a test key, this call makes a hotel in your sandbox. With a live key, the same call adds a real hotel. The request is
checked exactly as for a real hotel, but nobody is emailed and nothing is billed. You can hold up to
five test hotels at one time, the example included.

```ts
const made = await zs.properties.create({
  name: "The Lantern House",
  owner: { name: "Asha Rao", email: "asha@lanternhouse.example", phone: "+91 98765 43210" },
  address: { line1: "14 Hill Road", city: "Shimla", country: "IN" },
  roomTypes: [{ ref: "rt-deluxe", name: "Deluxe Room", roomCount: 10, defaultRate: 4500 }],
});

const hotel = zs.forProperty(made.id); // the same client, working on this hotel
```

The request needs at least one room type. So the hotel is born with its first room type, and with one
room-only rate plan for it at `defaultRate`: 4500 means 4,500.00 in the hotel's own currency.

**7. Create room types.** A room type is a kind of room the hotel sells. This hotel has the Deluxe Room
already, so add a second one. `ref` is your own id for it.

```ts
const suite = await hotel.roomTypes.save({ ref: "rt-suite", name: "Suite", roomCount: 2, adults: 3 });
suite.id; // ZimmerStack's id for it: name it when you set the rooms left to sell
```

**8. Create rate plans.** A rate plan is one way to sell a room type. Prices belong to rate plans. Add
breakfast to the Deluxe Room, and give the Suite its first rate plan.

```ts
const breakfast = await hotel.ratePlans.save({ ref: "rp-bb", roomTypeRef: "rt-deluxe", name: "Bed and breakfast", mealPlan: "CP", defaultRate: 5000 });
await hotel.ratePlans.save({ ref: "rp-suite", roomTypeRef: "rt-suite", name: "Room only", mealPlan: "EP", defaultRate: 9000 });
breakfast.id; // name it when you set prices and stay rules
```

**9. Send availability and rates.** Availability is the rooms left to sell on each night. A rate is the
price of one rate plan on each night. Send both for three nights.

```ts
// Rooms left to sell name a room type's id. The Deluxe Room was born with the hotel, so read its id.
const deluxe = (await hotel.roomTypes.list()).find((room) => room.ref === "rt-deluxe")!;
await hotel.availability.set([{ roomTypeId: deluxe.id, dateFrom: "2026-12-24", dateTo: "2026-12-26", available: 3 }]);

// Prices name a rate plan's id.
const accepted = await hotel.rates.set([{ ratePlanId: breakfast.id, dateFrom: "2026-12-24", dateTo: "2026-12-26", rate: 5500 }]);

// Accepted means ZimmerStack has saved it. On a test hotel a change lands within a minute and stops there.
const batch = await hotel.batches.wait(accepted[0]!.batchId);
console.log(batch.status); // "landed"
```

An update can also name its room type or rate plan by your own ref, so there is no id to read first:
`{ roomTypeRef: "rt-deluxe", … }` in `availability.set`, and `{ ratePlanRef: "rp-bb", … }` in `rates.set`
and `restrictions.set`. Send the ref or the id, never both.

Each step has its own page in the docs, with every field explained:
[get a test key](https://docs.zimmerstack.com/partner/test-key) ·
[make your first call](https://docs.zimmerstack.com/partner/first-call) ·
[create a hotel](https://docs.zimmerstack.com/partner/create-hotel) ·
[create room types](https://docs.zimmerstack.com/partner/room-types) ·
[create rate plans](https://docs.zimmerstack.com/partner/rate-plans) ·
[send availability and rates](https://docs.zimmerstack.com/partner/send-availability-and-rates).

**Next: receive a booking, then go live.** Your test hotel can now take a test booking.
[Receive a booking](https://docs.zimmerstack.com/partner/receive-booking) shows how to add your webhook
address and pretend a booking came in; the short version is in [Receive bookings](#receive-bookings)
below. Then [accept the price](https://docs.zimmerstack.com/partner/price) and
[add your first hotel](https://docs.zimmerstack.com/partner/first-hotel) with a live key. The calls
stay the same: with a live key they work on real hotels.

Want a working app to start from? The [starter app](https://github.com/zimmerstack/connect-starter) has
a one-click Deploy button.

### The key stays on a server

This package runs on a server only. Your key can change a hotel's prices on every booking site, so the
package refuses to start in a browser or a mobile app. Your web page calls your own server. Your server
calls ZimmerStack.

- Never put the key in a `VITE_`, `NEXT_PUBLIC_`, `REACT_APP_` or `EXPO_PUBLIC_` variable. Those are
  sent to every visitor's browser.
- Your app has no server (a Vite, Lovable or Bolt page)? The docs show the smallest one:
  <https://docs.zimmerstack.com/guides/node-package#no-server>

## What you can do

| I want to | Call |
|---|---|
| See which hotels my key reaches | `zs.properties.list()` |
| Read one hotel's details | `zs.property.get()` |
| Show the rate calendar | `zs.grid.load(from, to)` |
| Save what a person changed in it | `zs.grid.save(edits)` |
| Set the rooms left to sell | `zs.availability.set(updates)` |
| Set prices | `zs.rates.set(updates)` |
| Stop selling one rate plan on a night, or ask for a minimum stay | `zs.restrictions.set(updates)` |
| Close a room type on some nights, everywhere, and keep it closed | `zs.availability.close({ roomTypeId, dateFrom, dateTo })` · `zs.availability.reopen(body)` |
| See what a change would do before I send it | `zs.rates.dryRun(updates)` · `zs.availability.dryRun(updates)` · `zs.restrictions.dryRun(updates)` |
| Read what a change did not do | `noticesOf(accepted)` |
| Find out why a night is not selling as I sent it | `zs.explain.night({ roomTypeId, date })` |
| List a hotel's room types and rate plans | `zs.roomTypes.list()` · `zs.ratePlans.list()` |
| Create or change a room type or a rate plan | `zs.roomTypes.save(roomType)` · `zs.ratePlans.save(ratePlan)` |
| Delete a room type or a rate plan | `zs.roomTypes.delete(idOrRef)` · `zs.ratePlans.delete(idOrRef)` |
| Set a price modifier on one booking site | `zs.channels.setModifier(channelId, steps)` |
| Send one OTA everything again when it shows a wrong number (a full sync) | `zs.channels.fullSync(channelId)` · `zs.channels.fullSyncAll()` |
| Read the bookings the booking sites sent | `zs.channelBookings.list()`, or a webhook |
| Read every booking and channel event, in order, from where I stopped | `zs.events.all({ after })` |
| Read the bookings made on the hotel's own website | `zs.directBookings.list()` |
| Pretend a booking came in (practice hotel only) | `zs.sandbox.bookings.create(booking)` |
| Pretend a no-show, or a channel problem (practice hotel only) | `zs.sandbox.bookings.noShow(bookingId)` · `zs.sandbox.syncEvents.create(body)` |
| Make the practice hotel's booking site refuse a price, or go down | `zs.sandbox.faults.set(body)` · `zs.sandbox.faults.clear()` |
| Create and manage my webhook addresses from code | `zs.webhookEndpoints.create(body)` and the rest |
| See how much of each limit is left | `zs.limits.get()` |
| See which of my calls were refused, and from which address they came | `zs.requests.list({ status: "errors" })` |
| Find out what is wrong | `npx @zimmerstack/connect doctor` |
| Check that a change reached the booking sites | `zs.batches.wait(batchId)` · `zs.sync.get()` |
| Create a booking from your own booking engine | `zs.bookings.create(booking)` |
| Work with many hotels on one key | `zs.forProperty(propertyId)` |
| Add a hotel | `zs.properties.create(hotel)` |
| Change a hotel | `zs.properties.update(propertyId, changes)` |
| Remove a hotel I added | `zs.properties.delete(propertyId, { confirm })` |
| Let a hotel connect a booking site itself | `zs.connectLinks.create({ propertyId, channel })` |
| Check that a hotel is ready, and make my software its source of truth | `zs.readiness.get()` · `zs.readiness.goLive()` |
| Make, replace and revoke the keys I made on a hotel | `zs.hotelKeys.create(propertyId, body)` · `zs.hotelKeys.rotate(propertyId, keyId)` · `zs.hotelKeys.revoke(propertyId, keyId, { reason })` |
| Read my bills and how many hotels I may still add | `zs.billing.get()` · `zs.billing.invoices()` · `zs.billing.nextInvoice()` |
| Open a support ticket and read the answer | `zs.supportTickets.create(body)` · `zs.supportTickets.get(ticketId)` |
| See whether something is wrong on ZimmerStack's side | `zs.status.get()` |

Every call and every answer is typed, with the meaning of each field shown in your editor.

**Money.** A price goes up and comes back in the same shape: the hotel's own currency, with that
currency's own decimals. You send a normal number or a decimal string (`4500.50` or `"4500.50"`) and it
is kept exactly; `zs.rates.get()` returns `rate: "4500.50"` beside `currency` and `decimals`. The
calendar helpers `zs.grid.load()` and `zs.grid.save()` always use normal numbers.

| Currency | Decimals (ISO 4217) | You send | You read `rate` | `rateMinor` |
|---|---|---|---|---|
| Rupee, euro, dollar, dirham, rupiah | 2 | `4500.50` | `"4500.50"` | `450050` |
| Yen, won, dong | 0 | `15000` | `"15000"` | `1500000` |
| Kuwaiti, Bahraini, Omani, Jordanian, Tunisian, Libyan dinar | 3 | `45.75` | `"46.000"` | `4600` |

`rateMinor` is still returned, and is always hundredths of the currency's unit: that is paise or cents
where a currency has two decimals, and it is not yen (`1500000` is 15,000 yen). Read `rate` and you never
divide. A number with more decimals than the currency has (`4500.505` in rupees) is rounded and named in
the answer's `rounded` list, and so is a fraction in a currency that has none, so nothing changes
without the answer saying so. A decimal string takes at most two decimals: one with more
(`"4500.505"`) is refused with a 400 `VALIDATION` error and nothing is saved. It is never rounded for
you. A three-decimal currency is kept as a whole amount for now.

The package has helpers for money, so you never do the arithmetic on floats (from 0.9.0). They take and
return the same decimal strings, and `decimals` comes from the API's own answer:

```ts
import { addAmounts, amountFromHundredths, amountFromMinorUnits, formatAmount, multiplyAmount, toAmount } from "@zimmerstack/connect";

const { currency, decimals } = await zs.property.get();  // "INR", 2 · "JPY", 0
toAmount(4500.5, decimals);                              // "4500.50": the shape the API reads and writes
multiplyAmount("4500.50", 3, decimals);                  // "13501.50": three nights, exact
addAmounts("0.10", "0.20", decimals);                    // "0.30", not 0.30000000000000004
amountFromMinorUnits(450050, decimals);                  // "4500.50": from a ledger that stores whole paise or cents
amountFromHundredths(1500000, 0);                        // "15000": from a rateMinor, in any currency
formatAmount("4500.50", { currency, decimals, locale: "en-IN" }); // "₹4,500.50", for a person to read
```

**Dates.** A date is a plain calendar day, `YYYY-MM-DD`, on the hotel's own clock.

## Show the rate calendar and save a change

```ts
const grid = await zs.grid.load("2026-12-01", "2026-12-14");

// Save only what a person changed. Nights next to each other are sent as one range.
const accepted = await zs.grid.save({
  rates: [
    { ratePlanId: 901, date: "2026-12-24", rate: 5200 },
    { ratePlanId: 901, date: "2026-12-25", rate: 5200 },
  ],
  restrictions: [{ ratePlanId: 901, date: "2026-12-31", stopSell: true }], // stop selling this rate plan that night. Never send a price of zero.
});

// Accepted means ZimmerStack has saved it and is sending it to the booking sites.
const batch = await zs.batches.wait(accepted[0]!.batchId); // "landed", "failed", or still "pending" after five minutes
```

`stopSell` closes one rate plan on that night. The room type's other rate plans keep selling. To stop
selling a room type on a night on every booking site, send its room count as 0 with
`zs.availability.set()` or `grid.save({ availability })`.

**Sent is not held: read the answer.** "Accepted" means saved by ZimmerStack, not yet on the booking
sites. Three things can still happen, and each one is told to you:

- A booking site's side refuses a value. The batch then reads `failed` with `parkedCells` and
  `lastError`: the value is held and not sent again. Send a corrected value for those nights.
- A write names a room type or rate plan that reaches no booking site. The batch lists it under
  `unreachable`.
- A price is kept differently from how you sent it. The write's answer lists it under `rounded`.

And later, someone can change a price on a booking site's side. A check that runs every night finds it,
sends your value again and tells you: see [Receive bookings](#receive-bookings) for `channel.drift.detected`.

Room counts usually reach the booking sites in seconds. A full calendar of prices can take minutes.
Inside a short-lived function (Vercel, Netlify), show the `batchId` and read `zs.sync.get()` later
instead of waiting.

Guide: <https://docs.zimmerstack.com/guides/rate-grid>

## See what a change will do, and read what it did not do

"Accepted" means ZimmerStack saved your change. It does not say the change does what you meant. Three
things do (from 0.9.0).

**1. Ask first: a dry run.** The same updates, checked exactly as the real change, and nothing is saved.

```ts
const [preview] = await zs.restrictions.dryRun([{ ratePlanId: 901, dateFrom: "2026-12-31", dateTo: "2026-12-31", stopSell: true }]);
preview.verdict; // "would-write", "nothing-to-write", or "would-refuse" with the refusal you would get
```

A dry run answers a `WritePreview`, and `set` answers a `WriteAccepted`: two types, so your code cannot
mistake one for the other. A dry run counts against the per-minute limits like the change it previews,
so it is not a way to read the calendar.

**2. Read the notices.** Every answer of `set`, and every dry run, can carry notices: one plain sentence
each, about what the change did **not** do, with what to do about it.

```ts
import { findNotice, noticesOf } from "@zimmerstack/connect";

const accepted = await zs.restrictions.set([{ ratePlanId: 901, dateFrom: "2026-12-31", dateTo: "2026-12-31", stopSell: true }]);
for (const notice of noticesOf(accepted)) show(notice.level, notice.message, notice.action); // warnings first
findNotice(accepted, "ROOM_STILL_ON_SALE"); // the room still sells through its other rate plans
```

The two that explain most surprises:

- **Stop-sell is a switch on one rate plan.** The room keeps selling through its other rate plans, and
  through a rate a booking site makes on its own side (`ROOM_STILL_ON_SALE`).
- **A room count of 0 is a count, not a switch.** It closes the room everywhere, but a cancellation at a
  booking site puts a room back, and your next count replaces it (`COUNT_ZERO_IS_NOT_STOP_SELL`).

A notice is never an error: the change was saved. Decide on `notice.code` (`NOTICES` lists every code),
and show `message` and `action` to the person who saved.

**3. Close a room type everywhere, in one call.** Its count goes to 0 **and** stop-sell is switched on
for every one of its rate plans, so it is closed and stays closed.

```ts
const closed = await zs.availability.close({ roomTypeId: 412, dateFrom: "2026-12-30", dateTo: "2027-01-02" });
closed.notReached; // read this: what the close could not reach, and why
await zs.availability.reopen({ roomTypeId: 412, dateFrom: "2026-12-30", dateTo: "2027-01-02", available: 3 });
```

`reopen` undoes exactly what `close` did. Pass `available` when your software knows how many rooms are
free now; without it each night gets back the count it held before. `closeDryRun` and `reopenDryRun`
show what each would do.

**Why is this night not selling as I sent it?** One read tells the night's whole story:

```ts
const night = await zs.explain.night({ roomTypeId: 412, date: "2026-12-31" });
night.summary; // plain sentences, most important first: show them to the person who asked
```

It answers what your software last sent, what ZimmerStack holds and who set it, and what the channel
manager was last seen holding, with any value it refused in its own words. It cannot see a booking
site's own screen: it reads the channel manager's copy, as last seen. "What your software last sent" is
there for changes made after this feature shipped.

Guides: <https://docs.zimmerstack.com/guides/dry-run> · <https://docs.zimmerstack.com/guides/notices> ·
<https://docs.zimmerstack.com/guides/close-and-reopen> · <https://docs.zimmerstack.com/guides/explain-one-night>

## Set up a hotel's rooms: create, change, delete

A **room type** is a kind of room the hotel sells, like "Deluxe Room". A **rate plan** is one way to
sell it, like "Bed and breakfast". Prices belong to rate plans.

```ts
// `ref` is your own id for the room type.
const room = await zs.roomTypes.save({ ref: "deluxe", name: "Deluxe Room", roomCount: 8, adults: 2 });

// `defaultRate` is the plan's real price for a night: 4500 means 4,500.00. A new rate plan needs it:
// every date of the plan can be sold at this price until you send the price of each night.
const plan = await zs.ratePlans.save({ ref: "deluxe-bb", roomTypeRef: "deluxe", name: "Bed and breakfast", mealPlan: "CP", defaultRate: 4500 });

room.id; // name it when you set the rooms left to sell
plan.id; // name it when you set prices and stay rules

// Send the same ref again to change it. It never makes a second one.
await zs.roomTypes.save({ ref: "deluxe", name: "Deluxe Garden Room", roomCount: 8, adults: 2 });

// Delete by your own ref (a string), or by ZimmerStack's id (a number). There is no undo.
await zs.ratePlans.delete("deluxe-bb");
await zs.roomTypes.delete("deluxe"); // its rate plans are deleted with it
```

- These calls need the permission `catalog:write` on the key.
- To send many at once, use `zs.catalog.upsertRoomTypes(body)` and `zs.catalog.upsertRatePlans(body)`.
- A delete by your ref is one request. The API finds what the ref names among the hotel's own room types
  or rate plans (`DELETE /catalog/room-types/ref:deluxe`). A string is always read as a ref: `"412"` is
  the ref 412, never the id 412.
- A room type or a rate plan made on ZimmerStack's own screens has no ref. Delete it by its id, the
  number `zs.roomTypes.list()` and `zs.ratePlans.list()` give.
- The same two deletes, named as the API names them: `zs.catalog.deleteRoomType(412)` or
  `zs.catalog.deleteRoomType({ ref: "deluxe" })`, and `zs.catalog.deleteRatePlan` in the same way.
- A delete is refused while a booking site still sells that room or plan. Unmap it on the booking site's
  connection first. Nothing is deleted when a delete is refused.
- Call a delete only when a person chose to delete that one thing. Never from a loop or a clean-up
  script.

Guide: <https://docs.zimmerstack.com/reference>

## Receive bookings

A **webhook** is a message ZimmerStack sends to your server when something happens, such as a new
booking. Add your address in the partner portal under Developers. Then check each message with
`verifyWebhook` before you trust it.

```ts
import { isOtaBookingEvent, isWebsiteBookingEvent, verifyWebhook } from "@zimmerstack/connect";

export async function POST(request: Request) {
  // Pass the body exactly as it arrived, before any JSON parsing.
  const event = await verifyWebhook(await request.text(), request.headers, process.env.ZIMMERSTACK_WEBHOOK_SECRET!);
  // A message can arrive twice. Remember event.id and skip one you have seen.
  if (isOtaBookingEvent(event)) await save(event.data.booking); // a booking site: created, modified, cancelled
  if (isWebsiteBookingEvent(event)) await applyToMyCalendar(event.data.booking); // the hotel's own website: created, a no-show, cancelled
  return new Response(null, { status: 204 });
}
```

`verifyWebhook` throws `ZimmerStackWebhookError` when a message is not from ZimmerStack, or is more than
five minutes old. Answer 400 and do nothing with the body.

Try it on your practice hotel. This pretends Booking.com sent a booking, and your webhook receives the
real, signed message:

```ts
await zs.sandbox.bookings.create({ roomTypeId: 412, checkIn: "2026-12-05", nights: 2, rooms: 1, adults: 2, guestName: "Asha Verma", otaName: "Booking.com", paidByOta: false });
```

**The webhook is the nudge. The event log is the truth** (from 0.9.0). A webhook can arrive twice, late,
out of order, or not at all when your server is down for a day. So every event of a hotel also has a
place in one ordered list: its `sequence`, one higher than the hotel's last event. Save the last
sequence you applied, and read from there:

```ts
// Run this when a webhook arrives, on a schedule, and when your server starts.
for await (const event of zs.events.all({ after: await loadPlace(hotelId) })) {
  await apply(event);                         // the same shape the webhook carries
  await savePlace(hotelId, event.sequence);   // your new place
}
```

Built this way, nothing depends on a webhook having arrived. Events stay in the log for 90 days. If you
were away for longer, pass `onGap` to hear of it, then read each booking's latest state with
`zs.channelBookings.all({ since })` and `zs.directBookings.all({ since })`. A booking also carries a
`version` (1, 2, 3 and so on): a higher version is a later state, whatever order things arrived in.

Besides bookings, your address can receive five more kinds of message, each only when it lists the
type. Narrow them with `isSyncEvent`, `isDriftEvent`, `isConnectEvent`, `isIncidentEvent` and
`isSupportTicketEvent`:

- `channel.sync.alert` and `channel.sync.recovered`: a problem with a booking site began (a refused
  value, a disconnect, prices or room counts that stopped going out) and ended.
- `channel.drift.detected` and `channel.drift.healed`: the nightly check found a booking site's side
  holding something other than what you sent, sent your value again, and later found them agreeing.
- `channel.connect.completed` and `channel.connect.expired`: a connect link you made ended. The hotel
  started selling on the booking site, or the link ran out first.
- `platform.incident.opened`, `.updated` and `.resolved`: ZimmerStack recorded a problem on its own
  side that touches your hotels, and later ended it.
- `support.ticket.replied` and `support.ticket.closed`: ZimmerStack answered your support ticket.

The last two kinds are about your account, not one hotel. They have **no `event.property`** and no
`sequence`, and they are not in the event log. Check `isIncidentEvent` and `isSupportTicketEvent` before
any code that reads `event.property`.

**A guest's phone and email.** A webhook carries them only while your address has guest contact
switched on. A read by API returns them until 30 days after checkout; after that they are `null` and
`guest.contactWithheld` says `"retention"`. Every read that returned contact is logged, and the hotel's
owner can see the list. Copy what you need when the booking arrives.

**Your webhook addresses, from code** (from 0.9.0). A company key with the permission `webhooks:manage`
(tick **Also manage webhooks** when you make the key) creates and looks after them without the portal:

```ts
const { endpoint, secret } = await zs.webhookEndpoints.create({ url: "https://pms.example/zimmerstack", dataAck: true });
// `secret` is shown this once. Store it in your server's settings now.
await zs.webhookEndpoints.test(endpoint.id, { eventType: "channel.booking.created" }); // a signed sample
await zs.webhookEndpoints.pause(endpoint.id);   // before planned downtime: events are held
await zs.webhookEndpoints.resume(endpoint.id);  // they go out, oldest first
```

Also there: `update` (the address, the event types, the guest-contact switch), `rotateSecret`,
`recover(id, since)`, `delete`, and `deliveries.list`, `deliveries.get` and `deliveries.redeliver` for the
delivery log.

Hotels outside India (from 0.7.0): a booking carries `taxes`, the hotel's own tax lines, wherever the
hotel has confirmed them. When a booking site sends a booking in another currency than the hotel's,
`amounts.receivedCurrency` names it; the amounts are as the site sent them, never converted. At such a
hotel `zs.bookings.create` also takes `nightlyRateIncludesTaxes`; `false` is refused with
`TAXES_NOT_CONFIGURED` where the hotel has confirmed no lines, and `TAXES_INSIDE_RATES` where all its
taxes sit inside its prices.

**What the OTA said about each room** (the API, 25 Nov 2026; no new package version needed). Each room
of an OTA booking carries `mealPlanSource` (`"ota"`, `"ratePlan"` or `"default"`: who decided
`mealPlan`), `mealPlanText` (the OTA's own meal words), `mealPrice` (a meal the guest can add, not in
the price), `nightlyRates` (the OTA's price for each night) and `commission` (the OTA's commission on
that room). `finance.taxIncludedInAmount` says whether the tax is inside `amounts.total`. Each is `null`
where the OTA sent nothing, and on bookings from before that day. A booking made on MakeMyTrip now has
`channel.otaName` `"MakeMyTrip"`, where it said `"Goibibo"` before: match the two as one OTA. How to
save each one in a PMS: <https://docs.zimmerstack.com/guides/webhooks#pms-meal-money>

Guide: <https://docs.zimmerstack.com/guides/webhooks>

## A price modifier on one booking site

You send one price for each rate plan and night. A booking site's **modifier** changes it for that site
only: a few steps, applied in order.

```ts
import { MODIFIER_TAKES_EFFECT, channelPrice } from "@zimmerstack/connect";

const { channels } = await zs.channels.list();
const booking = channels.find((c) => c.kind === "BookingCom")!;

// Booking.com is sent 18 % more, then 200 less. Needs the permission channel-modifiers:write.
await zs.channels.setModifier(booking.channelId, [
  { action: "increase", type: "percent", value: 18 },
  { action: "decrease", type: "fixed", value: 200 },
]);

channelPrice(4500, booking.modifier ?? []); // what Booking.com is sent for 4,500. Show it beside your calendar.
```

`MODIFIER_TAKES_EFFECT` is the sentence to show where a person saves one: saving makes the channel
manager send that channel every date again, so prices already on sale move to the new rule within
minutes. No re-send is needed. `zs.rates.resend()` stays for the rare case where you want our
record's prices sent again, unchanged; a hotel may ask a few times a day, so never call it
automatically.

One call to `zs.channels.setModifier()` moves every price on that booking site. Call it when a person
saved the setting. Never from a loop, a timer or a set-up script.

Guide: <https://docs.zimmerstack.com/guides/price-per-ota>

## A full sync of one OTA

Sometimes one OTA shows a number that our connectivity partner does not hold: it missed an update, or a
room was mapped after its dates were sent. A **full sync** fixes it. Our connectivity partner sends that
OTA everything it holds for the hotel again: availability, rates and restrictions, for every date.

```ts
const { channels } = await zs.channels.list();
const sync = await zs.channels.fullSync(channels[0]!.channelId); // needs the permission ari:write
if (sync.started) console.log("Sent. This OTA takes the next full sync at", sync.nextAt);

const all = await zs.channels.fullSyncAll(); // every OTA of the hotel, one after another
for (const line of all.channels) if (!line.started) console.log(line.channelId, line.code, line.retryAt ?? "");
```

- Nothing new leaves ZimmerStack, and none of your numbers changes. `zs.rates.resend()` is the other
  thing: it sends ZimmerStack's own rates again.
- An OTA takes one full sync an hour for each connection, also counting one the hotel's owner started
  in ZimmerStack. Inside the hour `fullSync()` throws `RATE_LIMITED` with the scope `full-sync-hour`.
  `fullSyncAll()` never throws for one OTA: its line says why.
- Let a person press it on the OTA's own screen. Never call it on a timer.
- On a sandbox nothing is sent: `started` is false and `notice` says why.

Page: <https://docs.zimmerstack.com/reference/send-everything-to-one-ota-again>

## Many hotels on one key

A software company's **company key** reaches all its hotels, so each call says which hotel it is for.

```ts
const { properties } = await zs.properties.list();
const hotel = zs.forProperty(properties[0]!.id); // the same client, working on one hotel
await hotel.grid.load("2026-12-01", "2026-12-14");
```

- A **test** company key reaches all your practice hotels. While you have only one, the package finds it
  by itself. With several, name one, as the Start does from step 6.
- A **live** key never guesses. Always name the hotel.
- An app that serves one hotel can name it once: `ZIMMERSTACK_PROPERTY_ID=61` on the server, or
  `new ZimmerStack({ propertyId: 61 })`.
- Each hotel has its own queue (from 0.8.0). One hotel that is close to its limit waits by itself; the
  others keep going. What all your hotels share, your company's limit, is kept for all of them together.

## Add a hotel, remove a hotel

A software company can add a hotel and remove one it added from its own code. You need a company key
with the permission `properties:write`: tick **Also add and remove hotels** when you make the key in the
partner portal (the account's owner or an Admin can; they are the people who may add a hotel by hand).
With a test key (`zsk_test_`) the same two calls make and delete a practice hotel, so you can try them
safely.

```ts
// Add a hotel. Its owner gets the sign-in details by email; they are never sent to you.
const added = await zs.properties.create({
  name: "Ganga Guest House",
  owner: { name: "Meera Joshi", email: "meera@gangaguesthouse.example", phone: "+91 98765 43210" },
  address: { line1: "14 Assi Ghat Road", city: "Varanasi", country: "IN" },
  roomTypes: [{ ref: "rt-river", name: "River View Room", roomCount: 6, defaultRate: 3200 }],
});

// From now on, name the new hotel's id.
const hotel = zs.forProperty(added.id);
await hotel.roomTypes.save({ ref: "rt-river", name: "River View Room", roomCount: 6, adults: 2 });
```

The hotel works at once and joins your monthly invoice on the next 1st. It is put on the channel manager
when its billing starts, with the room types you sent; then you connect its booking sites in the partner
portal.

```ts
// Change a hotel you added: its name, its address, or both. Only what you send changes.
const changed = await zs.properties.update(added.id, { name: "Ganga Riverside Guest House", address: { line1: "16 Assi Ghat Road" } });
changed.changed; // ["name", "address.line1"]
```

It never changes the hotel's country, currency, time zone, owner or tax id. It changes the hotel in
ZimmerStack, not the name of its listing on a booking site.

```ts
// Remove a hotel you added. confirm is the hotel's exact name as it is now, so a wrong id never removes a hotel.
const gone = await zs.properties.delete(added.id, { confirm: changed.name });
gone.channelManager.state; // "REMOVED", or "RETRYING" while one step is still finishing
```

One call does it all, in this order: the hotel's booking sites are disconnected, its rate plans and
then its room types are removed from the channel manager, and the hotel is closed. It comes off your
invoice from the next 1st. **There is no undo.** Call it only when a person chose to remove that
hotel, never from a loop or a clean-up script. Move the hotel's booking sites to its next channel
manager first, so it keeps selling.

A removal takes a little while, because the booking sites are disconnected one after another. The
package waits up to a minute and a half for these two calls. If no answer arrives at all (a network
error), you can safely call `delete` again: a hotel that is already gone answers `replay: true`, and
one that is still being removed answers `PROPERTY_BUSY` (wait, then ask again).

Guide: <https://docs.zimmerstack.com/guides/add-and-remove-hotels>

## Connect a booking site, go live, and a hotel's keys

A software company's **company key** can do three more things without the partner portal (from 0.9.0).
Each needs its own permission, ticked when the key is made.

**A connect link: the last step, never the first.** A link alone does not connect a booking site,
except Airbnb (there the host signs in on Airbnb's own page). Every other booking site must first
accept our connectivity partner for the hotel, in its extranet or through its support. That step
can take days, and no call does it: `hotelStep` in the answer says how. Until it is done, the booking
site refuses what the hotel types on the link's page.

1. At the booking site, first: the hotel's step (`hotelStep`).
2. Then the link: the hotel's person types the hotel's id at the booking site.
3. Then the mapping: they match each room and rate there to one of the hotel's rate plans.
4. Then Start selling: the whole calendar is sent, and bookings start to reach you.

Every step: <https://docs.zimmerstack.com/guides/connect-an-ota#how-it-unfolds>

```ts
import { shownOnce } from "@zimmerstack/connect";

const made = await zs.connectLinks.create({ propertyId: 61, channel: "bookingcom" });
await tellTheHotel(made.hotelStep); // the step at the booking site, first (null for Airbnb)
await sendOnceTheStepIsDone(shownOnce(made)); // then the link
```

The hotel's person opens the link on ZimmerStack's page and types the hotel's id at the booking site
(MakeMyTrip and Goibibo also ask for the access token they give). Then they confirm each room and
rate match, and press Start selling. You then receive `channel.connect.completed`. No call takes the
booking site's details or a match. A link is made with a **live** key only: a practice hotel has no
booking site to connect. Permission: `channels:connect`.

**Readiness and go-live.** A hotel you add is yours from the first day. A hotel that let you in with
your vendor code is not, until it goes live.

```ts
const hotel = zs.forProperty(61);
const report = await hotel.readiness.get();              // four checks, each with what to do
await hotel.rates.set(aYearOfPrices, { beforeGoLive: true });   // stored, and waits for go-live
if ((await hotel.readiness.get()).ready) await hotel.readiness.goLive();
await hotel.availability.set(aYearOfCounts);             // right after going live: your room counts
```

`beforeGoLive: true` says you know the hotel is not live yet. **Prices and stay rules sent this way are
stored and wait.** The readiness report asks for a price for every rate plan and night of the year
ahead.

**Room counts are different.** Until the hotel is live, a room count may only **lower** what is on sale.
A lower count goes to the booking sites at once, because a count that waited could sell a room twice. A
count that **raises** what is on sale is refused (it comes back in the answer's `rejected` list),
because the hotel's own people may still be running its counts. So send your room counts again right
after going live.

**A hotel's keys.** Make, replace and revoke the keys you made on a hotel you added. Permission:
`keys:manage`.

```ts
import { shownOnce, withoutShownOnce } from "@zimmerstack/connect";

const minted = await zs.hotelKeys.create(61, { name: "Night audit job", scopes: ["ari:read"] });
await secrets.put("zimmerstack/hotel-61", shownOnce(minted)); // the key is in this answer only
console.log(withoutShownOnce(minted));                        // safe to log: the key is not in it
```

**Shown once.** A key, a connect link and a webhook secret are each in one answer and nowhere else.
`shownOnce(answer)` returns the value. If the answer is a repeat of an earlier request, the value is not
in it: `shownOnce` then throws an error that names the call that gets you a new one. It never hands you
an empty value to store by mistake.

Guides: <https://docs.zimmerstack.com/guides/connect-an-ota> · <https://docs.zimmerstack.com/partner/go-live> ·
<https://docs.zimmerstack.com/guides/keys-and-scopes#hotel-keys>

## Your bills, support and status

Also for a company key, each with its own permission (from 0.9.0):

```ts
const bill = await zs.billing.get();          // what is owed, your hotel quota, money paid ahead (billing:read)
const next = await zs.billing.nextInvoice();  // what the next invoice is made of, hotel by hotel

const ticket = await zs.supportTickets.create({ severity: "many_hotels", subject: "Prices are not going out", message: "Since 08:10 UTC …", propertyIds: [61, 62] }); // support:write

const { incidents } = await zs.status.get();  // is something wrong on ZimmerStack's side? Any key.
```

- Billing is **read only**: nothing pays or changes anything. `atCost` lists what the channel manager
  charged above the room types and rate plans a hotel includes, passed on at cost. A line marked
  `RECORDED` is not on an invoice yet.
- A ticket has three levels. `many_hotels` (two or more hotels cannot sell or take bookings) gets a first
  reply within the hour, 9:00 to 21:00 India time, every day; the other two within one working day.
  ZimmerStack attaches what its own records show, so never paste a key or a guest's details.
- `zs.status.get()` lists the incidents that touch your hotels. During one, keep what your people
  changed and send it when it ends.

Guides: <https://docs.zimmerstack.com/guides/bills-by-api> · <https://docs.zimmerstack.com/guides/support> ·
<https://docs.zimmerstack.com/guides/status-and-incidents>

## Bookings from the hotel's own website

Some hotels sell on their own website through ZimmerStack's booking engine and keep your software as
their PMS. Those bookings reach you in two ways:

- the webhooks `direct.booking.created`, `direct.booking.modified` and `direct.booking.cancelled` (your
  address receives each one only when it lists that type);
- `zs.directBookings.list()` and `zs.directBookings.all({ since })`, with the permission
  `direct-bookings:read`.

The booking looks like a booking site's booking. `channel.otaName` is `"Website"`, `finance` is null and
`amounts.paid` is what the guest paid online.

`direct.booking.modified` (from 0.6.0) tells you about a **no-show**: the hotel recorded that the guest did
not arrive, or undid that. A no-show is not a cancellation. `status` stays `CONFIRMED` and the payment is
untouched, so refund nothing. Read `stayStatus`:

- `NOSHOW`: the nights are on sale again on every booking site. Free the room in your own calendar.
- `UPCOMING` again: the hotel undid the no-show. Hold the room.

`changes` names what moved (`"stayStatus"`, `"rooms[0].status"`) and `previous` is the booking as it read
before. Nothing else sends this message yet: other dates, one room of several cancelled or a payment taken
at the desk still send none, so read `zs.directBookings.all({ since })` on a slow schedule too. An address
that listed the other two types before 21 Nov 2026 keeps receiving exactly those two until its owner ticks
the third.

**Apply a website booking to your own calendar before you next send room counts.** The booking takes
one room off the count the booking sites hold. If you then send your old count, that room goes back on
sale.

```ts
for await (const booking of zs.directBookings.all({ since: lastSeen })) applyToMyCalendar(booking);
await zs.grid.save(edits); // only now
```

Your software can also cancel a website booking and say what the guest gets back. This needs its own
permission, `direct-bookings:cancel`.

```ts
const { refund, replay } = await zs.directBookings.cancel(bookingId, { refund: "policy", reason: "Guest phoned to cancel" });
// refund.amount is a normal number. refund.status is NONE, PENDING, PROCESSED or MANUAL.
```

- `refund: "policy"` gives back what the booking's own cancellation rules allow now. Use it when the
  guest asked to cancel. It is the default.
- `refund: "full"` gives back everything the guest paid online. Use it when the hotel is at fault, such
  as an overbooking.
- `refund: "none"` moves no money. The hotel settles it another way.

The refund goes back to the guest's online payment, and is never more than that payment. A booking that
is checked in, checked out or a no-show answers `BOOKING_NOT_CANCELLABLE`. One that is already cancelled
answers `replay: true` and moves no money. Your own cancel comes back to you as
`direct.booking.cancelled`: match it on the booking id and treat it as done. Call this from a person's
own cancel button, never from a background job.

To try it with a test key, call `zs.sandbox.bookings.create({ …, otaName: "Website" })` and then cancel
that booking. The nights come back and no money moves. To try a no-show, call
`zs.sandbox.bookings.noShow(bookingId)` on that booking: your address receives the real
`direct.booking.modified`, and `{ undo: true }` takes it back.

Guide: <https://docs.zimmerstack.com/guides/website-bookings>

## When the API says no

```ts
import { ZimmerStackError } from "@zimmerstack/connect";

try {
  await zs.rates.set(updates);
} catch (err) {
  if (!(err instanceof ZimmerStackError)) throw err;
  err.code;              // never changes: "RATE_OUT_OF_BAND", "SCOPE_MISSING", "RATE_LIMITED". Decide on this.
  err.message;           // a sentence for the person at the screen. Show it.
  err.retryAfterSeconds; // set when you hit a limit: how long to wait
  err.freesAt;           // the same as a moment (a Date): when to send it again
  err.scope;             // which limit said no: "writes", "cells-hour", "rate-resends-day"
  err.retryable;         // false means the request itself is wrong. Fix it. Do not send it again.
}
```

The package has already waited and tried again where that could help. Do not put its calls in a retry
loop of your own.

A limit that frees within two minutes is waited out for you. A longer one (a limit per hour or per day)
comes straight back as a `RATE_LIMITED` error that says when it frees, so a person is not left waiting.
A job that may wait can say so, and the package holds the call and tells you when it lands:

```ts
const zs = new ZimmerStack({ onEvent: (e) => e.type === "wait" && console.log(e.message) });
await zs.rates.set(updates, { maxWaitSeconds: 3600 }); // "PUT /rates lands in about 25 minutes (waiting for the cells-hour budget)."
```

Every code, what it means and what to do: <https://docs.zimmerstack.com/guides/errors>

## When something is wrong: the doctor

One command looks at your whole integration and says what to fix (from 0.9.0):

```bash
npx @zimmerstack/connect doctor
```

It reads the key from `ZIMMERSTACK_CONNECT_KEY` (the environment, or your project's `.env.local` or
`.env`), and checks, in order:

| It checks | What it tells you |
|---|---|
| The key | Whether it is the right shape, before anything is sent. A key that was mistyped or cut short is caught by its own checksum. Then whether it answers: revoked, expired, or called from an address that is not on its list. |
| Is it ZimmerStack | The open incidents on ZimmerStack's side that touch your hotels, with what was last said. |
| Hotels and permissions | Which hotels the key reaches, and what it may do on each. For a hotel that is not live yet, which readiness checks have not passed and what to do. |
| Limits | Every limit and how full it is, and whether the integration is paused. |
| Refused calls | The last day's refused calls, grouped by reason, with what to do about each and the last request id. |
| Webhook addresses | Whether each one is being answered, and its last failures. If your server answers 401, it says to check how you verify the signature. |
| Sync and drift | Whether what you sent reached the booking sites, which values were refused, and what the nightly check found changed on a booking site's side. |

It only reads, with a test key or a live key, and it never prints the key. It exits with 0 when nothing
needs attention and 1 when something does, so you can run it after a deploy. `--property <id>` looks at
one hotel of a company key; `--json` prints the report for a script. The same checks from your own
code: `diagnose()` and `formatDoctorReport(report)`.

Name a night and it explains that night too:

```bash
npx @zimmerstack/connect doctor --room-type 412 --night 2026-12-31
```

## Keys

- A key made since 22 Nov 2026 is `zsk_live_` (or `zsk_test_`), 40 letters and digits, then 6
  characters that are a checksum of the rest. `checkKey(value)` tells a real key from a mistyped one
  without sending it anywhere; use it where a person pastes a key. A key made before that day keeps
  working until it is rotated.
- **Rotate** a key in the screen where it was made (the partner portal, or the hotel owner's Developers
  screen). The new key is shown once and the old one keeps working for 24 hours, so you can swap with
  no downtime. Company keys can be rotated too. A person does this for a hotel's own key and for a
  company key. The keys a software company made on a hotel can also be made, rotated and revoked by
  API (`zs.hotelKeys`, above).
- **A key found in a public place** (a public repository, for example) is revoked at once and its holder
  is emailed. Calls then answer `API_KEY_REVOKED`: make a new key and keep it in your server's settings,
  never in code.
- **What a key did** is kept for 7 days: `zs.requests.list()` gives the time, the route, the status, the
  error code, the address and the request id of each call, never a body. An address you do not
  recognise is the first sign of a leaked key.

Guide: <https://docs.zimmerstack.com/guides/keys-and-scopes>

## What the package does for you

| The rule | What the package does |
|---|---|
| The key stays on a server | Refuses to start in a browser or a mobile app. Sends the key to ZimmerStack only. Never prints it. |
| You may make only so many calls a minute | Reads every limit from every answer (the key's, the hotel's, your company's) and slows down before one is reached. |
| Changes go out in order | Sends one hotel's changes one at a time, in the order you made them. Each hotel has its own queue, so one hotel never holds up another. At most four calls at once. |
| Try again only when that can help | Tries again after a "slow down" answer, always. Tries again after a fault on our side or a network failure only when sending twice cannot apply the change twice: a read, or a change that carries its own id (next row). Any other "no" comes straight back to you. |
| A limit per hour or per day | Waits when the wait is under two minutes. Otherwise gives you the "no" at once with when it frees, and stops sending calls that would only be refused again. |
| A retry must not save twice | Gives each change its own id and reuses it when it tries again, so the same change is never saved twice. A call that cannot be safely repeated, such as a delete, is not sent again when its result is unknown. |
| A request has a size limit | Splits a save at 1,000 updates or 5,000 night cells. |
| A refused key is not tried again | After a key is refused, it stops calling. |
| A test must not touch a real hotel | Refuses to change anything with a `zsk_live_` key while your tests run. |

Limits in full: <https://docs.zimmerstack.com/guides/rate-limits>

## Limits

Every limit the API holds you to, from the one table the server enforces. You do not need to learn it:
the package reads the limits from every answer and keeps inside them. It is here so you can size a job.
`zs.limits.get()` (from 0.8.0) answers the same rows for your key, with what is left of each and when it
refills:

```ts
const { budgets, shield } = await zs.limits.get();
const today = shield?.budgets.find((b) => b.scope === "cells-day");
console.log(today?.remaining, "changed cells left today; room again in", today?.resetSeconds, "s");
```

A write is every call that is not a read. An IPv6 /56 counts as one address. A key that has just worked
from your address is counted against its own limits, not the address's, so many hotels behind one
office address are not held to the address's limit.

<!-- limits-table:begin (generated from connectApiLimitsTable.ts; run `pnpm --dir apps/backend exec tsx ts/scripts/connect-api-limits-doc.ts`) -->
**Budgets the key guard and the routes measure (429 `RATE_LIMITED`).**

| `data.scope` | In `RateLimit` as | Per | Window | Quota | Counts |
|---|---|---|---|---|---|
| `api-address` | `api-address` | address, on each API machine | 60 s fixed | 1,200 | every request to any ZimmerStack API route from one address (an IPv6 /56 counts as one address), counted on each API machine: the guard in front of everything, the Connect API included |
| `ip` | `ip` | address | 60 s sliding | 240 | requests from one address (an IPv6 /56 counts as one address) that carry no key verified from it in the last ten minutes, checked before the key is read. A key that has authenticated from that address is counted against its own budgets, not here |
| `ip-auth` | `ip-auth` | address | 60 s sliding | 20 | 401 answers, and 403 IP_NOT_ALLOWED, to one address; past it the address's unverified requests are refused before any lookup. A key that authenticated from that address in the last ten minutes keeps working |
| `key-auth` | `key-auth` | address and key | 60 s sliding | 5 | 401 and 403 IP_NOT_ALLOWED answers to one key (its first twelve characters) from one address; past it that key is refused from that address before any lookup, so one revoked key never uses up its address's budget |
| `global-unauthenticated` | `global-unauthenticated` | everyone without a verified key | 60 s sliding | 1,200 | requests from every address together that carry no recently verified key and so cost a key lookup: the most a flood of made-up keys can ask of the database |
| `requests` | `key` | key | 60 s sliding | 120 | every request on one key |
| `writes` | `key-writes` | key | 60 s sliding | 30 | every request on one key that is not a GET (PUT, POST and DELETE); a dry run (dryRun: true) is a write here |
| `property` | `property` | property (all its keys) | 60 s sliding | 300 | every request on all of a property's keys together (five keys are not five budgets) |
| `property-writes` | `property-writes` | property (all its keys) | 60 s sliding | 60 | every request that is not a GET on all of a property's keys together |
| `cells` | `cells` | property (all its keys) | 60 s sliding | 20,000 | cells a property's writes name after range expansion, charged before anything is read or written. A dry run is charged the same cells as the write it previews; a close or a reopen (POST /availability/close) is charged the room type's count and each of its rate plans for every night |
| `company` | `company` | company key (all its hotels) | 60 s sliding | 1,200 | every request on one company key, across all its hotels (each hotel keeps its own key and property budgets too) |
| `global` | `global` | everyone | 60 s sliding | 3,000 | every authenticated request on the Connect API, all keys together; test keys count in a ceiling of their own of the same size, so a sandbox never spends what live hotels use |
| `bookings` | `bookings` | key | 60 s sliding | 20 | POST /bookings on one key |
| `property-bookings` | `property-bookings` | property (all its keys) | 60 s sliding | 40 | POST /bookings on all of a property's keys together |
| `property-bookings-day` | — | property (all its keys) | rolling 24 hours | 500 | POST /bookings per property per ROLLING 24 HOURS (not per minute); the owner can raise it per property |
| `direct-cancels` | `direct-cancels` | key | 60 s sliding | 10 | POST /direct-bookings/{bookingId}/cancel on one key (a replay is not counted) |
| `property-direct-cancels-day` | — | property (all its keys) | rolling 24 hours | 50 | POST /direct-bookings/{bookingId}/cancel per property per ROLLING 24 HOURS (not per minute) |

**Budgets over an hour and a day (429 `RATE_LIMITED`). "At least" is the least any property gets; `GET /limits` answers your own.**

| `data.scope` | In `RateLimit` as | Per | Window | Quota | Counts |
|---|---|---|---|---|---|
| `cells-hour` | — | property (all its keys) | one clock hour (UTC) | at least 10,000 | changed cells, all of a property's keys together. At least this many; a larger property gets two of its own full calendars an hour. A dry run changes nothing and is never counted here |
| `cells-day` | — | property (all its keys) | rolling 24 hours | at least 30,000 | changed cells, all of a property's keys together. At least this many; a larger property gets six of its own full calendars a day. A dry run changes nothing and is never counted here |
| `vendor-cells-day` | — | software vendor (all its hotels) | rolling 24 hours | at least 150,000 | a software vendor's changed cells across all its hotels (company keys and keys it minted). At least this many, plus 15,000 for each hotel it serves; a sandbox is never counted here |
| `shield-lane` | — | property (all its keys) | one clock hour (UTC) | at least 500 | cells of writes that only close inventory, accepted while the property is out of budget or paused (the safety lane). At least this many; sixty nights of every room type |
| `structure-creates` | — | property | 60 s sliding | 20 | new room types and rate plans per property; a row already here that the write puts on the channel manager counts when it gets there, never when the answer's notice says it could not; also the most one request may create (TOO_MANY_NEW_ENTITIES) |
| `structure-creates-day` | — | property | rolling 24 hours | 300 | new room types and rate plans per property |
| `structure-edits-day` | — | property | rolling 24 hours | 300 | changed room types and rate plans per property |
| `structure-deletes-day` | — | property | rolling 24 hours | 60 | deleted room types and rate plans per property |
| `vendor-structure-creates-day` | — | software vendor (all its hotels) | rolling 24 hours | at least 500 | a software vendor's new room types and rate plans across all its hotels |
| `vendor-remote-properties-day` | — | software vendor | rolling 24 hours | 10 | hotels a software vendor puts on the channel manager for the first time |
| `vendor-property-removals-day` | — | software vendor | rolling 24 hours | 10 | hotels a software partner removes (DELETE /properties/{propertyId}, and Remove hotel in the partner portal); a sandbox is never counted |
| `partner-new-properties-hour` | — | software partner | one hour | 20 | hotels a partner adds, POST /properties and the partner portal's form together; a sandbox is never counted |
| `partner-new-sandboxes-hour` | — | software partner | rolling hour | 30 | sandboxes a partner makes with a test key (POST /properties), counted when one is made; the partner portal's own sandbox button is not counted |
| `connect-links-hour` | — | property | rolling hour | 10 | one-time connect links a software partner makes for one hotel (POST /connect-links), every booking site together; a link that was withdrawn or ran out still counts |
| `partner-connect-links-hour` | — | software partner | rolling hour | 120 | one-time connect links a software partner makes across all its hotels (POST /connect-links) |
| `modifier-changes-day` | — | property | rolling 24 hours | 6 | changes to a channel's price modifier per property (PUT /channels/{channelId}/modifier); steps the channel already holds are not counted |
| `rate-resends-day` | — | property | rolling 24 hours | 3 | times a property's prices are sent to the channels again (POST /rates/resend) |
| `full-sync-hour` | — | OTA connection | rolling hour | 1 | full syncs of one OTA connection (POST /channels/{channelId}/full-sync, and each connection of POST /full-sync); one the hotel's owner started in ZimmerStack counts too |
| `partner-support-tickets-day` | — | software partner | rolling 24 hours | 20 | support tickets a partner opens (POST /support-tickets), both key modes together; a replayed idempotency key is not counted |
| `partner-support-messages-hour` | — | software partner | rolling hour | 60 | messages a partner adds to its support tickets (POST /support-tickets/{ticketId}/messages) |

**Caps: the most one request may carry, and the most of a thing that may exist (a 4xx of their own, never a 429).**

| `data.scope` | In `RateLimit` as | Per | Window | Quota | Counts |
|---|---|---|---|---|---|
| `maxUpdatesPerRequest` | — | request | one request | 1,000 | entries in one updates array (400 TOO_MANY_UPDATES past it) |
| `maxCellsPerRequest` | — | request | one request | 5,000 | cells (entity × night) one request may name after range expansion (400 TOO_MANY_CELLS past it) |
| `maxBodyBytes` | — | request | one request | 1,048,576 | the JSON body; larger is 413 PAYLOAD_TOO_LARGE before a byte is validated |
| `horizonDays` | — | request | one request | 500 | the last writable night and the last bookable arrival: today + this many, in the property's calendar (400 HORIZON past it) |
| `maxNightsPerBooking` | — | request | one request | 90 | nights in one POST /bookings |
| `newEntitiesPerRequest` | — | request | one request | 20 | new room types or rate plans one structure write may create (400 TOO_MANY_NEW_ENTITIES past it) |
| `maxRoomTypes` | — | property | one request | 18 | live room types on a hotel (a vacation rental has figures of its own, on GET /limits): 409 CATALOG_LIMIT_REACHED past it |
| `maxRatePlans` | — | property | one request | 180 | live rate plans on a hotel: 409 CATALOG_LIMIT_REACHED past it |
| `maxActiveKeysPerProperty` | — | property | one request | 5 | active hotel keys on one property (409 KEY_LIMIT past it) |
| `maxActiveCompanyKeys` | — | software partner | one request | 5 | active company keys of one software partner |
| `maxSandboxes` | — | software partner | one request | 5 | sandboxes one software partner may hold at once |
| `maxAllowedCidrs` | — | key | one request | 20 | entries in one key's address allowlist |
| `idempotencyRetentionDays` | — | key | one request | 7 | how long an x-idempotency-key replays its first answer |
| `maxSupportMessageChars` | — | request | one request | 5,000 | characters in one support ticket message, the first included (400 VALIDATION past it) |
| `maxSupportTicketProperties` | — | request | one request | 200 | hotels one support ticket may name in propertyIds; past it send allProperties (400 VALIDATION) |
<!-- limits-table:end -->

## Options

```ts
new ZimmerStack({
  apiKey,                 // default: process.env.ZIMMERSTACK_CONNECT_KEY
  propertyId,             // a company key's hotel. Default: ZIMMERSTACK_PROPERTY_ID (or use forProperty)
  timeoutMs: 30_000,      // how long one try may take
  maxRetries: 3,          // how many more tries, for what may pass later
  maxWaitSeconds: 120,    // the longest it holds a call for a limit before giving you the "no". Any call can pass its own.
  onEvent: (e) => log(e), // every answer, wait and retry, for your logs ("lands in about 25 minutes"). Never carries the key.
  fetch,                  // a stand-in for tests
});
```

## Test your integration

Use a `zsk_test_` key, or pass a fake `fetch`. Nothing you do with a test key reaches a booking site,
and `zs.sandbox.bookings.create()` sends your webhook a real message. A practice hotel can make a real
message of every type: a booking arriving, changing and cancelled, a cancellation with no booking before
it (`arrivesCancelled: true`), a website booking and its no-show, and a channel problem with its end
(`zs.sandbox.syncEvents.create()`). It can also be made to fail: `zs.sandbox.faults.set({ kind: "refuse" })`
makes its pretend booking site refuse the next price, so you can watch your software handle it. A software company makes test keys
in the partner portal under Developers. A hotel's owner makes one in Admin → Developers → API keys.

Guide: <https://docs.zimmerstack.com/guides/sandbox>

## For AI coding agents

Building with Claude Code, Cursor, Codex, Copilot or a tool like Lovable? Give the agent three things.

**1. The rules file.** The package ships one. Add it to your project's rules so the agent follows it.
Add to your file, do not replace it: Next.js and other tools write their own `AGENTS.md`.

```bash
cat node_modules/@zimmerstack/connect/AGENTS.md >> AGENTS.md   # or >> CLAUDE.md
```

**2. A first prompt.** Paste this and change the last line to what you want:

```text
Read node_modules/@zimmerstack/connect/AGENTS.md and follow it.
Use @zimmerstack/connect on the server only, with the key in ZIMMERSTACK_CONNECT_KEY.
Build a page that shows the rate calendar for the next 14 nights, lets me change a price and save it,
and add a webhook route that checks each message with verifyWebhook and lists the bookings.
```

**3. The helper.** The package carries an MCP server. Connect it and the agent can read the rules, look
up any part of the API, and try a call on your practice hotel before it writes code.

| Tool | What the agent gets |
|---|---|
| `zimmerstack_rules` | The rules for building on the API: the key, pacing, money and dates, a closing checklist. |
| `zimmerstack_reference` | Any call, type, limit or error code, from the API's own contract. |
| `zimmerstack_sandbox_read` | One read on your practice hotel: real ids and real shapes. |
| `zimmerstack_sandbox_write` | One change on your practice hotel, to try a request before writing the code that sends it. |
| `zimmerstack_doctor` | The doctor's checks on your practice hotel's key: what is wrong, and what to do. |
| `zimmerstack_sandbox_limits` | Every limit of the key and how full it is. |
| `zimmerstack_sandbox_events` | The practice hotel's ordered event log, from a sequence: the exact body your webhook receives. |
| `zimmerstack_sandbox_simulate` | One real event of any type on your practice hotel: a booking arriving, changing, cancelled, a no-show, a channel problem and its end. |
| `zimmerstack_sandbox_dry_run` | What a change would do on your practice hotel, with nothing saved, and its notices. |
| `zimmerstack_sandbox_explain` | One night's whole story on your practice hotel. |
| `zimmerstack_sandbox_close` | Close a room type everywhere on your practice hotel, or reopen it. |
| `zimmerstack_sandbox_fault` | Make the practice hotel's pretend booking site refuse a price, slow down or go down, so your handling can be tried. |

```bash
# Claude Code
claude mcp add zimmerstack -- npx -y @zimmerstack/connect mcp
```

```json
// Cursor (.cursor/mcp.json) and Claude Code's project file (.mcp.json)
{ "mcpServers": { "zimmerstack": { "command": "npx", "args": ["-y", "@zimmerstack/connect", "mcp"] } } }
```

The helper runs on your own machine. It reads `ZIMMERSTACK_CONNECT_KEY` from the environment, or from
your project's `.env.local` or `.env`, so the key never goes into the agent's settings file. It uses a
test key only and refuses a live one, so an agent cannot change a real hotel through it. Without a key,
the rules and the lookups still work.

The whole API in one file an agent can read: <https://docs.zimmerstack.com/llms-full.txt>.
More: <https://docs.zimmerstack.com/guides/build-with-ai>

## Words used here

| Word | What it means |
|---|---|
| Booking site | A website that sells the hotel's rooms: Booking.com, Airbnb, Expedia and the rest. Travel people say OTA. The API calls each one a channel. |
| Sandbox | Where your practice hotels live. The docs call one a test hotel. It behaves like a real hotel, but no booking site ever sees it. |
| Key | A password for your software. `zsk_test_` works in your sandbox, `zsk_live_` on a real hotel. |
| Company key | One key for all of a software company's hotels. Each call says which hotel it is for. |
| Room type | A kind of room the hotel sells, like "Deluxe Room". |
| Rate plan | One way to sell a room type, like "Bed and breakfast". Prices belong to rate plans. |
| Stay rule | A rule for a night: closed for sale, or a minimum number of nights. The API calls these restrictions. |
| Webhook | A message ZimmerStack sends to your server when something happens, such as a new booking. |
| Permission | What a key may do, like `catalog:write` for changing room types and rate plans. The API calls it a scope. |

More words: <https://docs.zimmerstack.com/words>

## Find everything

| Where | What is there |
|---|---|
| <https://docs.zimmerstack.com> | The guides and the full reference |
| <https://docs.zimmerstack.com/partner/first-call> | The first calls, step by step |
| <https://docs.zimmerstack.com/pricing> | What a live property costs a month |
| <https://www.zimmerstack.com/partners/pms-companies#join> | Sign up, free |
| <https://partner.zimmerstack.com/login> | The partner portal: your practice hotels, keys, webhooks, hotels and bills |
| <https://github.com/zimmerstack/connect-starter> | A working app to start from, with a Deploy button |
| <https://github.com/zimmerstack/connect-node> | This package's source, copied at every release |
| <https://docs.zimmerstack.com/changelog> | What changed, and when |
| <support@zimmerstack.com> | Questions, from any time zone. Answered within one working day. |
