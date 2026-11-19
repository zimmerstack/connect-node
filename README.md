# @zimmerstack/connect

Add a channel manager to your hotel software. This package sends a hotel's rooms and prices to
Booking.com, Airbnb, Expedia, Agoda, MakeMyTrip and the other booking sites, and brings their bookings
back to you.

- **Free to build.** You get a practice hotel the moment you sign up. Nothing you do there reaches a
  real booking site.
- **One public price.** A fixed price for each live property a month, on one invoice. You accept it in
  the partner portal. No call needed: <https://docs.zimmerstack.com/pricing>
- **Made for AI coding tools.** The package carries its own rules file and a helper your coding agent
  can ask. See [For AI coding agents](#for-ai-coding-agents).

[Docs](https://docs.zimmerstack.com) · [Quickstart](https://docs.zimmerstack.com/quickstart) ·
[Pricing](https://docs.zimmerstack.com/pricing) · [Partner portal](https://partner.zimmerstack.com/login) ·
[Starter app](https://github.com/zimmerstack/connect-starter) ·
[Changelog](https://docs.zimmerstack.com/changelog) · <support@zimmerstack.com>

## Start in five minutes

**1. Sign up.** It is free and takes one emailed code:
<https://www.zimmerstack.com/partners/pms-companies#join>. Your practice hotel is made for you. We call
it a sandbox. Working for one hotel only? Its owner makes your key in Admin → Developers → API keys, and
you can skip to step 3.

**2. Make a test key.** Open the [partner portal](https://partner.zimmerstack.com/login), then
Developers, then Create key. A test key starts with `zsk_test_`. It works on your practice hotel only.

**3. Install the package.** It needs Node 20 or newer.

```bash
npm install @zimmerstack/connect
```

**4. Put the key on your server.** Keep it out of your code.

```bash
# .env (do not commit this file)
ZIMMERSTACK_CONNECT_KEY=zsk_test_…
```

**5. Make your first call.**

```ts
import { ZimmerStack } from "@zimmerstack/connect";

const zs = new ZimmerStack(); // reads ZIMMERSTACK_CONNECT_KEY. Make one and reuse it.

// Which hotel is this?
const hotel = await zs.property.get();
console.log(hotel.name, hotel.currency, hotel.timezone);

// The rate calendar for two weeks: rooms down the side, nights across the top.
const grid = await zs.grid.load("2026-12-01", "2026-12-14");
console.log(grid.rows.length, "room types");
```

Want a working app to start from? The [starter app](https://github.com/zimmerstack/connect-starter) has
a one-click Deploy button.

### The key stays on a server

This package runs on a server only. Your key can change a hotel's prices on every booking site, so the
package refuses to start in a browser or a mobile app. Your web page calls your own server. Your server
calls ZimmerStack.

- Never put the key in a `VITE_`, `NEXT_PUBLIC_`, `REACT_APP_` or `EXPO_PUBLIC_` variable. Those are
  sent to every visitor's browser.
- Your app has no server (a Vite, Lovable or Bolt page)? The docs show the smallest one:
  <https://docs.zimmerstack.com/sdk#no-server>

## What you can do

| I want to | Call |
|---|---|
| See which hotels my key reaches | `zs.properties.list()` |
| Read one hotel's details | `zs.property.get()` |
| Show the rate calendar | `zs.grid.load(from, to)` |
| Save what a person changed in it | `zs.grid.save(edits)` |
| Set the rooms left to sell | `zs.availability.set(updates)` |
| Set prices | `zs.rates.set(updates)` |
| Close a night, or ask for a minimum stay | `zs.restrictions.set(updates)` |
| List a hotel's room types and rate plans | `zs.roomTypes.list()` · `zs.ratePlans.list()` |
| Create or change a room type or a rate plan | `zs.roomTypes.save(roomType)` · `zs.ratePlans.save(ratePlan)` |
| Delete a room type or a rate plan | `zs.roomTypes.delete(idOrRef)` · `zs.ratePlans.delete(idOrRef)` |
| Charge a different price on one booking site | `zs.channels.setModifier(channelId, steps)` |
| Read the bookings the booking sites sent | `zs.channelBookings.list()`, or a webhook |
| Read the bookings made on the hotel's own website | `zs.directBookings.list()` |
| Pretend a booking came in (practice hotel only) | `zs.sandbox.bookings.create(booking)` |
| Check that a change reached the booking sites | `zs.batches.wait(batchId)` · `zs.sync.get()` |
| Create a booking from your own booking engine | `zs.bookings.create(booking)` |
| Work with many hotels on one key | `zs.forProperty(propertyId)` |
| Add a hotel | `zs.properties.create(hotel)` |
| Remove a hotel I added | `zs.properties.delete(propertyId, { confirm })` |

Every call and every answer is typed, with the meaning of each field shown in your editor.

**Money.** You send a price as a normal number: `4500` means 4,500.00 in the hotel's own currency. When
you read prices one by one with `zs.rates.get()`, they come back in the smallest unit (`rateMinor`:
`450000` is 4,500.00). The calendar helpers `zs.grid.load()` and `zs.grid.save()` always use normal
numbers.

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
  restrictions: [{ ratePlanId: 901, date: "2026-12-31", stopSell: true }], // close a night. Never send a price of zero.
});

// Accepted means ZimmerStack has saved it and is sending it to the booking sites.
const batch = await zs.batches.wait(accepted[0]!.batchId); // "landed", or still "pending" after five minutes
```

Room counts usually reach the booking sites in seconds. A full calendar of prices can take minutes.
Inside a short-lived function (Vercel, Netlify), show the `batchId` and read `zs.sync.get()` later
instead of waiting.

Guide: <https://docs.zimmerstack.com/rate-grid>

## Set up a hotel's rooms: create, change, delete

A **room type** is a kind of room the hotel sells, like "Deluxe Room". A **rate plan** is one way to
sell it, like "Bed and breakfast". Prices belong to rate plans.

```ts
// `ref` is your own id for the room type.
const room = await zs.roomTypes.save({ ref: "deluxe", name: "Deluxe Room", roomCount: 8, adults: 2 });

// `defaultRate` is the plan's usual price: 4500 means 4,500.00.
const plan = await zs.ratePlans.save({ ref: "deluxe-bb", roomTypeRef: "deluxe", name: "Bed and breakfast", mealPlan: "CP", defaultRate: 4500 });

room.id; // name it when you set the rooms left to sell
plan.id; // name it when you set prices and stay rules

// Send the same ref again to change it. It never makes a second one.
await zs.roomTypes.save({ ref: "deluxe", name: "Deluxe Garden Room", roomCount: 8, adults: 2 });

// Delete by your own ref, or by ZimmerStack's id. There is no undo.
await zs.ratePlans.delete("deluxe-bb");
await zs.roomTypes.delete("deluxe"); // its rate plans are deleted with it
```

- These calls need the permission `catalog:write` on the key.
- To send many at once, use `zs.catalog.upsertRoomTypes(body)` and `zs.catalog.upsertRatePlans(body)`.
- A delete is refused while a booking site still sells that room or plan. Unmap it on the booking site's
  connection first. Nothing is deleted when a delete is refused.
- Call a delete only when a person chose to delete that one thing. Never from a loop or a clean-up
  script.

Guide: <https://docs.zimmerstack.com/channel-manager>

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
  if (isWebsiteBookingEvent(event)) await applyToMyCalendar(event.data.booking); // the hotel's own website
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

No database yet? Read the bookings back any time with `zs.channelBookings.list()`. To catch up after
your server was down, `zs.channelBookings.all({ since })` gives every booking changed since a time you
choose.

Guide: <https://docs.zimmerstack.com/webhooks>

## A different price on each booking site

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

A modifier changes prices sent after you save it. Prices already on the booking site stay until those
nights are sent again. `MODIFIER_TAKES_EFFECT` is that sentence, ready to show where a person saves.
`zs.rates.resend()` sends the nights again, unchanged. A hotel may ask a few times a day, so make it a
button of its own.

One call to `zs.channels.setModifier()` moves every price on that booking site. Call it when a person
saved the setting. Never from a loop, a timer or a set-up script.

Guide: <https://docs.zimmerstack.com/per-ota>

## Many hotels on one key

A software company's **company key** reaches all its hotels, so each call says which hotel it is for.

```ts
const { properties } = await zs.properties.list();
const hotel = zs.forProperty(properties[0]!.id); // the same client, working on one hotel
await hotel.grid.load("2026-12-01", "2026-12-14");
```

- A **test** company key reaches your practice hotels. While you have only one, the package finds it by
  itself, so the Start example works unchanged. With several, name one.
- A **live** key never guesses. Always name the hotel.
- An app that serves one hotel can name it once: `ZIMMERSTACK_PROPERTY_ID=61` on the server, or
  `new ZimmerStack({ propertyId: 61 })`.

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

The hotel works at once and joins your monthly invoice on the next 1st. Its first room types put it on
the channel manager; then you connect its booking sites in the partner portal.

```ts
// Remove a hotel you added. confirm is the hotel's exact name, so a wrong id never removes a hotel.
const gone = await zs.properties.delete(added.id, { confirm: added.name });
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

Guide: <https://docs.zimmerstack.com/hotels>

## Bookings from the hotel's own website

Some hotels sell on their own website through ZimmerStack's booking engine and keep your software as
their PMS. Those bookings reach you in two ways:

- the webhooks `direct.booking.created` and `direct.booking.cancelled` (your address must list both);
- `zs.directBookings.list()` and `zs.directBookings.all({ since })`, with the permission
  `direct-bookings:read`.

The booking looks like a booking site's booking. `channel.otaName` is `"Website"`, `finance` is null and
`amounts.paid` is what the guest paid online. There is no "modified" message.

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
that booking. The nights come back and no money moves.

Guide: <https://docs.zimmerstack.com/website-bookings>

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
  err.retryable;         // false means the request itself is wrong. Fix it. Do not send it again.
}
```

The package has already waited and tried again where that could help. Do not put its calls in a retry
loop of your own.

Every code, what it means and what to do: <https://docs.zimmerstack.com/errors>

## What the package does for you

| The rule | What the package does |
|---|---|
| The key stays on a server | Refuses to start in a browser or a mobile app. Sends the key to ZimmerStack only. Never prints it. |
| You may make only so many calls a minute | Watches the limit and slows down before it is reached. |
| Changes go out in order | Sends one change at a time, in the order you made them. Reads go up to four at once. |
| Try again only when that can help | Tries again after a "slow down" answer, a fault on our side or a network failure. Any other "no" comes straight back to you. |
| A retry must not save twice | Gives each change its own id and reuses it when it tries again, so the same change is never saved twice. A call that cannot be safely repeated, such as a delete, is not sent again when its result is unknown. |
| A request has a size limit | Splits a save at 1,000 updates or 5,000 night cells. |
| A refused key is not tried again | After a key is refused, it stops calling. |
| A test must not touch a real hotel | Refuses to change anything with a `zsk_live_` key while your tests run. |

Limits in full: <https://docs.zimmerstack.com/limits>

## Options

```ts
new ZimmerStack({
  apiKey,                 // default: process.env.ZIMMERSTACK_CONNECT_KEY
  propertyId,             // a company key's hotel. Default: ZIMMERSTACK_PROPERTY_ID (or use forProperty)
  timeoutMs: 30_000,      // how long one try may take
  maxRetries: 3,          // how many more tries, for what may pass later
  maxWaitSeconds: 120,    // the longest it waits for a limit before giving you the "no"
  onEvent: (e) => log(e), // every answer, wait and retry, for your logs. Never carries the key.
  fetch,                  // a stand-in for tests
});
```

## Test your integration

Use a `zsk_test_` key, or pass a fake `fetch`. Nothing you do with a test key reaches a booking site,
and `zs.sandbox.bookings.create()` sends your webhook a real message. A software company makes test keys
in the partner portal under Developers. A hotel's owner makes one in Admin → Developers → API keys.

Guide: <https://docs.zimmerstack.com/sandbox>

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
More: <https://docs.zimmerstack.com/ai>

## Words used here

| Word | What it means |
|---|---|
| Booking site | A website that sells the hotel's rooms: Booking.com, Airbnb, Expedia and the rest. Travel people say OTA. The API calls each one a channel. |
| Sandbox | Your practice hotel. It behaves like a real one, but no booking site ever sees it. |
| Key | A password for your software. `zsk_test_` works on a sandbox, `zsk_live_` on a real hotel. |
| Company key | One key for all of a software company's hotels. Each call says which hotel it is for. |
| Room type | A kind of room the hotel sells, like "Deluxe Room". |
| Rate plan | One way to sell a room type, like "Bed and breakfast". Prices belong to rate plans. |
| Stay rule | A rule for a night: closed for sale, or a minimum number of nights. The API calls these restrictions. |
| Webhook | A message ZimmerStack sends to your server when something happens, such as a new booking. |
| Permission | What a key may do, like `catalog:write` for changing room types and rate plans. The API calls it a scope. |

More words: <https://docs.zimmerstack.com/glossary>

## Find everything

| Where | What is there |
|---|---|
| <https://docs.zimmerstack.com> | The guides and the full reference |
| <https://docs.zimmerstack.com/quickstart> | The first calls, step by step |
| <https://docs.zimmerstack.com/pricing> | What a live property costs a month |
| <https://www.zimmerstack.com/partners/pms-companies#join> | Sign up, free |
| <https://partner.zimmerstack.com/login> | The partner portal: your practice hotels, keys, webhooks, hotels and bills |
| <https://github.com/zimmerstack/connect-starter> | A working app to start from, with a Deploy button |
| <https://docs.zimmerstack.com/changelog> | What changed, and when |
| <support@zimmerstack.com> | Questions, from any time zone. Answered within one working day. |
