# Building on @zimmerstack/connect: rules for coding agents

You are writing code that calls the ZimmerStack Connect API through its official package. A write
through it changes a real hotel's prices and rooms on every booking site it sells on. The package
enforces most of the API's rules for you; this file is the rest. Keep it in the repository (as
AGENTS.md or CLAUDE.md) and follow it. The whole API reference, in one file an agent can read:
https://docs.zimmerstack.com/llms-full.txt

## The key

- It lives in the environment variable `ZIMMERSTACK_CONNECT_KEY` on a server. Never write it into a
  file that is committed, a log line, an error message, a URL, a test fixture or anything a browser
  or a mobile app receives. Never print it. `new ZimmerStack()` reads it by itself.
- The package refuses to start in a browser or in React Native. Do not work around that: the
  person's own frontend calls their own server, and the server calls ZimmerStack. Never put the key in
  a variable a bundler sends to the browser (`VITE_`, `NEXT_PUBLIC_`, `REACT_APP_`, `EXPO_PUBLIC_`).
  An app with no server gets the smallest one: https://docs.zimmerstack.com/sdk#no-server. A plain
  `fetch` from a browser is refused too ("Failed to fetch"), on purpose.
- `zsk_test_…` is a sandbox: nothing reaches a channel. Build and test with it. `zsk_live_…` is a real
  hotel. The package refuses to WRITE with a live key under a test runner; never switch that off to
  make a test pass.
- A software vendor's company key acts on one hotel at a time: `zs.forProperty(propertyId)`
  (`zs.properties.list()` names them), or `ZIMMERSTACK_PROPERTY_ID` in the environment for an app that
  serves one hotel. A test company key that reaches one sandbox finds it by itself; with several,
  name one; a live key never guesses.
- No key yet: a software company signs up, free, at https://www.zimmerstack.com/partners/pms-companies#join
  and makes test keys in the partner portal (Developers); a hotel's owner makes one in Admin →
  Developers → API keys.

## Let the package pace; never work around it

- It reads the `RateLimit` header and slows down before a budget runs out, sends writes one at a
  time, retries only what passes with time (429, 5xx, a network failure) under the same idempotency
  key, and gives up with a `ZimmerStackError` otherwise. Do not wrap its calls in your own retry
  loop, and never resend a 4xx other than 429: it is a verdict on the request. Fix the request.
- Per minute: 120 requests and 30 writes per key; 300 and 60 for all of a hotel's keys together.
  A hotel also has budgets per hour and per day that count CHANGED cells (at least 10,000 an hour, 30,000
  a day). Hitting one is `error.code === "RATE_LIMITED"` with `error.retryAfterSeconds`: tell the
  person when to try again; do not sleep through an hour.
- One instance per process (`new ZimmerStack()` once, in a module). Two instances do not share a pace.
- Never write on a timer, in a loop over all nights, or "to be safe". Send what a person changed,
  when they changed it: `zs.grid.save(edits)` folds nights into ranges and splits a large save.
- Do not poll faster than every 15 seconds (`zs.batches.wait` already does it right), and stop.

## Money and dates

- A price is SENT in major units (4500 = 4,500.00 of the hotel's own currency) with that currency, and READ in minor
  units (`rateMinor`). `zs.grid.load` gives major units; `zs.grid.save` takes them.
- A date is a plain `YYYY-MM-DD` calendar day in the hotel's timezone. Never build one with
  `new Date()` arithmetic in local time; use `eachDate(from, to)`.
- To close a night send `stopSell: true`. Never a zero price, never zero rooms as a substitute.
- Writes may reach 365 days ahead. A write is accepted (202) when it is in ZimmerStack's record; it
  reaches the channels in seconds to minutes. `zs.sync.get()` says how far along it is.

## Room types and rate plans

- A hotel sells room types ("Deluxe Room") through rate plans ("Bed and breakfast"). Create or change
  one with `zs.roomTypes.save({ ref, name, roomCount, adults })` and
  `zs.ratePlans.save({ ref, roomTypeRef, name, mealPlan, defaultRate })`. `ref` is the person's own
  id for it: sending the same ref again changes that entity, it never makes a second one. Several in
  one request: `zs.catalog.upsertRoomTypes` and `zs.catalog.upsertRatePlans`. All need the scope
  `catalog:write`.
- Every later write names ZimmerStack's numeric `id`, not the ref: room counts name a room type's
  id, prices and stay rules name a rate plan's id. `zs.roomTypes.list()` and `zs.ratePlans.list()`
  give them, and so does the answer of each `save`.
- `zs.roomTypes.delete(idOrRef)` and `zs.ratePlans.delete(idOrRef)` delete for good, and a room
  type takes its rate plans with it. Call them only when a person chose to delete that one entity on
  a screen, after a confirmation that names it. Never from a loop, a sync job, a "reset" or a cleanup
  script, and never to repair a mismatch: send the entity again with `save` instead. A hotel may
  delete 60 entities a day.
- `CATALOG_CONFLICT` or `CHANNEL_MANAGER_ERROR` on a delete means the hotel still uses it: a
  booking site still sells it, an upcoming stay holds one of its rooms, or rooms are still assigned
  to the room type. Nothing was deleted. Show the message and stop; do not try another way round.

## Adding and removing a hotel (a software partner's company key)

- Only a COMPANY key with the scope `properties:write` can do either; a hotel's own key cannot
  (`COMPANY_KEY_REQUIRED`). The person ticks "Also add and remove hotels" when making the key in the
  partner portal; only the account's owner or an Admin is offered that tick box. Neither call names a
  hotel with `forProperty`.
- `zs.properties.create({ name, owner, address, roomTypes })` adds a hotel and answers with its `id`:
  act on it with `zs.forProperty(id)`. The owner gets the sign-in details by email, never the caller.
  It joins the partner's monthly invoice. With a `zsk_test_` key the same call makes a sandbox, which
  is never billed. A partner may add 20 hotels an hour.
- After adding: the hotel is not on the channel manager yet. The first `zs.roomTypes.save` (or
  `zs.catalog.upsertRoomTypes`) with the same refs puts it there; then the rate plans, then room
  counts and prices.
- `zs.properties.delete(propertyId, { confirm })` (also `zs.properties.remove`) removes a hotel the
  partner added, FOR GOOD: its booking sites are disconnected, its rate plans and then its room types
  are removed from the channel manager, the hotel is closed and it comes off the invoice from the next
  1st. `confirm` is the hotel's exact name from `zs.properties.list()`. There is no undo, and a
  removed hotel cannot be added again by API.
- Call `delete` only when a person chose to remove that one hotel on a screen, after typing or
  confirming its name. Never from a loop, a timer, a sync job, a "reset", a cleanup or a test against
  a live key, and never to fix a hotel that looks wrong. A partner may remove
  10 hotels a day.
- The answer's `channelManager.state` is `REMOVED`, or `RETRYING` when one step is still finishing:
  that is success, ZimmerStack retries it, do not call again in a loop. `PROPERTY_NOT_REMOVABLE` means
  this key may not remove that hotel (its owner let the partner in, or it uses more than the channel
  manager): show the message and stop.
- Both calls take longer than the others (a removal disconnects the booking sites one after another),
  so the client waits up to 95 seconds for them whatever `timeoutMs` is. If `delete` ends in
  `TIMEOUT` or `NETWORK_ERROR`, the person may press Remove again: a hotel already gone answers
  `replay: true`, one still being removed answers `PROPERTY_BUSY`. Never retry it in a loop.

## A channel's price modifier

- `zs.channels.setModifier(channelId, steps)` moves EVERY price sent to that channel from then on.
  Call it only when a person saved that setting on a screen. Never from a loop, a timer, a seed
  script or a test against a live key. A hotel may change modifiers 6 times a day.
- Saving a modifier makes the channel manager send that channel every date again, so prices already on the channel move to the new rule within minutes.
  Show that sentence where the person saves (`MODIFIER_TAKES_EFFECT`), and offer
  `zs.rates.resend()` as a separate, deliberate button ("Apply to nights already on sale"): 3 a day
  per hotel, never automatic.
- Keep the grid on the price before any modifier; show a channel's price beside it with
  `channelPrice(rate, steps)`.

## Website bookings: apply them before you push room counts

- When the hotel also sells on its own website through ZimmerStack's booking engine, those bookings
  reach you as the webhooks `direct.booking.created`, `direct.booking.modified` and
  `direct.booking.cancelled` (the endpoint receives each only when it lists that type) and by
  `zs.directBookings.all({ since })` (scope `direct-bookings:read`). They are not OTA bookings:
  `isWebsiteBookingEvent(event)` tells them apart, `channel.otaName` is `"Website"` and `finance` is null.
- `direct.booking.modified` is a no-show and its undo, nothing else yet: the hotel recorded that the guest
  did not arrive, or undid that. It is NOT a cancellation: `status` stays CONFIRMED and the payment is
  untouched, so never refund on it. Read `stayStatus` and each room's `status`: NOSHOW gives the nights
  back (they are on sale again on every channel), UPCOMING again holds them. `changes` names what moved
  (`"stayStatus"`, `"rooms[0].status"`); `previous` is the booking as it read before, `stayStatus`
  included. The sandbox does not simulate one: the endpoint's Test button sends the sample.
- A website booking takes one room off the count the channels hold, at once. A PMS that pushes absolute
  room counts must apply the booking to its own calendar BEFORE its next `zs.availability.set` or
  `zs.grid.save`, or that push puts the sold room back on sale. Read `zs.directBookings.all` before a
  full push. Nothing on our side stops the count from going up.
- `zs.directBookings.cancel(bookingId, { refund, reason })` cancels a whole website booking that is
  still UPCOMING, and moves the guest's money (scope `direct-bookings:cancel`, granted on its own).
  `refund` is `"policy"` (the default: what the booking's own cancellation policy gives back, as if the
  guest cancelled), `"full"` (everything paid online: the hotel is at fault, an overbooking) or
  `"none"` (the hotel settles the money itself). Call it only from a person's own cancel button, with
  the refund they chose on the screen; never from a loop, a sync job or a test against a live key.
  Show `refund.amount` and `refund.status` from the answer. `BOOKING_NOT_CANCELLABLE` (checked in,
  checked out, a no-show) goes to the hotel's desk; do not retry it. `replay: true` means it was
  already cancelled and no money moved. Your own cancel comes back as `direct.booking.cancelled`
  ("Cancelled by the hotel"): match it on the booking id and treat it as already applied.

## Errors

```ts
import { ZimmerStack, ZimmerStackError } from "@zimmerstack/connect";

try {
  await zs.rates.set(updates);
} catch (err) {
  if (err instanceof ZimmerStackError) {
    // err.code is stable (RATE_LIMITED, RATE_OUT_OF_BAND, SCOPE_MISSING, …); err.message is for people.
    // Show err.message to the person; branch on err.code; never retry unless err.retryable.
  }
  throw err;
}
```

- `SCOPE_MISSING`: the key was not given that permission. Say which one is missing; the hotel's
  owner grants it (Admin → Developers → API keys). Do not look for another route.
- `API_KEY_INVALID`, `API_KEY_REVOKED`, `API_KEY_EXPIRED`: stop. The client refuses every later call
  by itself; repeated bad calls get the server's address refused.
- `RATE_OUT_OF_BAND`, `MODIFIER_OUT_OF_BAND`: the value is outside what the hotel allows. It is a
  guard against a typing slip; show the message, never split the change into smaller steps to pass.

## The MCP server

The package carries an MCP server for you, the agent: `npx -y @zimmerstack/connect mcp`. If it is
connected, use it instead of guessing: `zimmerstack_reference` looks up any operation, type, limit
or error code from the API's own contract, and `zimmerstack_sandbox_read` /
`zimmerstack_sandbox_write` make one call on the sandbox so you can see real ids and try a body
before you write the code that sends it. It works with a `zsk_test_` key only and refuses a live
one. It is for building; the application you write calls the API through the client, never through
these tools.

## Before you call the work done

- [ ] The key is read from the environment, on a server, and appears in no committed file or log.
- [ ] Every screen that writes sends only what the person changed, once, on their action.
- [ ] No retry loop, no timer and no polling faster than 15 seconds around a call of this package.
- [ ] Errors show `err.message` to the person and branch on `err.code`.
- [ ] Tests run against a `zsk_test_` key or a fake `fetch`; none needs a live key.
- [ ] Where a modifier is saved, the screen says when it takes effect, and the re-send is its own button.
- [ ] A PMS that pushes room counts applies every website booking to its own calendar before it pushes.
- [ ] A website booking is cancelled only from a person's own action, with the refund they chose.
- [ ] A room type or a rate plan is deleted only from a person's own action, after a confirmation that names it.
