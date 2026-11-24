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
  An app with no server gets the smallest one: https://docs.zimmerstack.com/guides/node-package#no-server. A plain
  `fetch` from a browser is refused too ("Failed to fetch"), on purpose.
- `zsk_test_…` is a sandbox: nothing reaches a channel. Build and test with it. `zsk_live_…` is a real
  hotel. The package refuses to WRITE with a live key under a test runner; never switch that off to
  make a test pass.
- A software vendor's company key acts on one hotel at a time: `zs.forProperty(propertyId)`
  (`zs.properties.list()` names them), or `ZIMMERSTACK_PROPERTY_ID` in the environment for an app that
  serves one hotel. A test company key that reaches one sandbox finds it by itself; with several,
  name one; a live key never guesses.
- No key yet: a software company signs up, free, at https://www.zimmerstack.com/partners/pms-companies#join
  and makes its test key in the partner portal: Developers → Create company key → Your sandbox
  (zsk_test_), with "Also add and remove hotels" ticked. A hotel's owner makes one in Admin →
  Developers → API keys.
- A software company builds in the order a hotel is made, all with that test key: `zs.properties.list()`
  (the hotels the key reaches), `zs.properties.create(hotel)` (a test hotel in its sandbox, born with its
  first room type and one room-only rate plan), then on `zs.forProperty(id)`: `roomTypes.save`,
  `ratePlans.save`, `availability.set` and `rates.set`. The same steps, one page each:
  https://docs.zimmerstack.com/partner/test-key
- A key is zsk_live_ (or zsk_test_ on a sandbox) + 40 letters and digits + a 6-character checksum (the CRC32 of everything before it, in base 62), so a key can be told from a look-alike without asking us. Where a person pastes a key (a settings screen, a
  deploy script), check it with `checkKey(value)` first: it tells a mistyped or cut-short key from a real
  one without sending it anywhere, and its `message` never contains the key.
- The key your code runs on is replaced by a person, never by code: no route makes, rotates or revokes
  a hotel's own key or a company key. Every key can be rotated, company keys included: the new key is shown once and the old one keeps answering for 24 hours, then answers 401 API_KEY_REVOKED. A key reported as found in a public place (for example by GitHub secret scanning in a public repository) is revoked at once and its holder is emailed: requests on it answer 401 API_KEY_REVOKED.
  So when calls suddenly answer `API_KEY_REVOKED`, do not retry: tell the person to make a new key.
  (The one thing that is by API: the keys a software partner made on a hotel, below.)
- When something is wrong, run `npx @zimmerstack/connect doctor` before changing code: it checks the
  key, the hotels and scopes it reaches, every budget, the last day's refused requests, the webhook
  endpoints and the sync state, and says what to do about each. It only reads and never prints the key.

## Let the package pace; never work around it

- It reads every budget in the `RateLimit` headers and slows down before one runs out, and sends one
  hotel's writes one at a time, in order. It sends a request again only when that is safe: a 429
  always, after its `Retry-After`; a 5xx or a network failure only for a read, or for a write that
  carries an idempotency key (a delete carries none, and is never sent twice). Anything else is a
  `ZimmerStackError` at once. Do not wrap its calls in your own retry loop, and never resend a 4xx
  other than 429: it is a verdict on the request. Fix the request.
- Per minute: 120 requests and 30 writes per key; 300 and 60 for all of a hotel's keys together.
  A write is every call that is not a read. A hotel also has budgets per hour and per day that count
  CHANGED cells (at least 10,000 an hour, 30,000
  a day). Hitting one is `error.code === "RATE_LIMITED"` with `error.retryAfterSeconds` and
  `error.freesAt`: tell the person when to try again; do not sleep through an hour. A job that may wait
  passes `{ maxWaitSeconds: 3600 }` on the call: the package then holds it and tells `onEvent` when it
  lands. `zs.limits.get()` answers every budget with what is left of it.
- One instance per process (`new ZimmerStack()` once, in a module). Two instances do not share a pace.
  Under a company key each hotel (`zs.forProperty(id)`) has its own queue and its own pace: one hotel's
  budget never holds up another's calls.
- Never write on a timer, in a loop over all nights, or "to be safe". Send what a person changed,
  when they changed it: `zs.grid.save(edits)` folds nights into ranges and splits a large save.
- Do not poll faster than every 15 seconds (`zs.batches.wait` already does it right), and stop.

## Every limit, from the API's own table

The package keeps inside these by itself; they are here so you can size a job. `zs.limits.get()` answers
the same rows for your key with what is left of each. "At least" is what the smallest hotel gets: a larger
hotel gets more, and `zs.limits.get()` says exactly.

- `api-address`: 1,200 requests, 60 s fixed, per address, on each API machine.
- `ip`: 240 requests, 60 s sliding, per address.
- `ip-auth`: 20 failed authentications, 60 s sliding, per address.
- `key-auth`: 5 failed authentications, 60 s sliding, per address and key.
- `global-unauthenticated`: 1,200 requests, 60 s sliding, per everyone without a verified key.
- `requests`: 120 requests, 60 s sliding, per key.
- `writes`: 30 writes, 60 s sliding, per key.
- `property`: 300 requests, 60 s sliding, per property (all its keys).
- `property-writes`: 60 writes, 60 s sliding, per property (all its keys).
- `cells`: 20,000 cells, 60 s sliding, per property (all its keys).
- `company`: 1,200 requests, 60 s sliding, per company key (all its hotels).
- `global`: 3,000 requests, 60 s sliding, per everyone.
- `bookings`: 20 bookings, 60 s sliding, per key.
- `property-bookings`: 40 bookings, 60 s sliding, per property (all its keys).
- `property-bookings-day`: 500 bookings, rolling 24 hours, per property (all its keys).
- `direct-cancels`: 10 cancels, 60 s sliding, per key.
- `property-direct-cancels-day`: 50 cancels, rolling 24 hours, per property (all its keys).
- `cells-hour`: at least 10,000 changed cells, one clock hour (UTC), per property (all its keys).
- `cells-day`: at least 30,000 changed cells, rolling 24 hours, per property (all its keys).
- `vendor-cells-day`: at least 150,000 changed cells, rolling 24 hours, per software vendor (all its hotels).
- `shield-lane`: at least 500 closing cells, one clock hour (UTC), per property (all its keys).
- `structure-creates`: 20 new room types and rate plans, 60 s sliding, per property.
- `structure-creates-day`: 300 new room types and rate plans, rolling 24 hours, per property.
- `structure-edits-day`: 300 changed room types and rate plans, rolling 24 hours, per property.
- `structure-deletes-day`: 60 deleted room types and rate plans, rolling 24 hours, per property.
- `vendor-structure-creates-day`: at least 500 new room types and rate plans, rolling 24 hours, per software vendor (all its hotels).
- `vendor-remote-properties-day`: 10 hotels, rolling 24 hours, per software vendor.
- `vendor-property-removals-day`: 10 hotels, rolling 24 hours, per software vendor.
- `partner-new-properties-hour`: 20 hotels, one hour, per software partner.
- `partner-new-sandboxes-hour`: 30 sandboxes, rolling hour, per software partner.
- `connect-links-hour`: 10 connect links, rolling hour, per property.
- `partner-connect-links-hour`: 120 connect links, rolling hour, per software partner.
- `modifier-changes-day`: 6 changes, rolling 24 hours, per property.
- `rate-resends-day`: 3 re-sends, rolling 24 hours, per property.
- `partner-support-tickets-day`: 20 tickets, rolling 24 hours, per software partner.
- `partner-support-messages-hour`: 60 messages, rolling hour, per software partner.
- `maxUpdatesPerRequest`: 1,000 entries, per request.
- `maxCellsPerRequest`: 5,000 cells, per request.
- `maxBodyBytes`: 1,048,576 bytes, per request.
- `horizonDays`: 500 nights, per request.
- `maxNightsPerBooking`: 90 nights, per request.
- `newEntitiesPerRequest`: 20 new room types and rate plans, per request.
- `maxRoomTypes`: 18 room types, per property.
- `maxRatePlans`: 180 rate plans, per property.
- `maxActiveKeysPerProperty`: 5 keys, per property.
- `maxActiveCompanyKeys`: 5 keys, per software partner.
- `maxSandboxes`: 5 sandboxes, per software partner.
- `maxAllowedCidrs`: 20 addresses or ranges, per key.
- `idempotencyRetentionDays`: 7 days, per key.
- `maxSupportMessageChars`: 5,000 characters, per request.
- `maxSupportTicketProperties`: 200 hotels, per request.

## Money and dates

- A price is SENT and READ in major units of the hotel's own currency, with that currency's own decimals (ISO 4217: 2 for
  rupees, euros and dollars, 0 for yen; `decimals` on `GET /property`). Send a number or a decimal string (4500.50 or
  "4500.50"); read `rate` ("4500.50") beside `currency` and `decimals`. It is kept exactly: never round a price yourself.
  `zs.grid.load` gives major units; `zs.grid.save` takes them.
- `rateMinor` and every other `…Minor` field is HUNDREDTHS of the major unit for every currency (450050 = 4500.50;
  1500000 = 15000 yen), which is the ISO minor unit only where the currency has two decimals. Prefer `rate`.
- A price sent as a NUMBER with more decimals than the currency has (4500.505 in rupees) is rounded and named in
  the answer's `rounded` list, and so is a fraction in a currency that has none (15000.5 yen): show that list to
  the person, never hide it. A price sent as a decimal STRING takes at most two decimals: one with more
  ("4500.505") is refused, 400 `VALIDATION`, and nothing is written. It is never rounded for you.
- Never do money arithmetic on floats, and never divide by 100 yourself. The package's helpers work on the
  strings: `toAmount(value, decimals)`, `addAmounts`, `subtractAmounts`, `multiplyAmount(amount, factor, decimals)`,
  `compareAmounts`, `formatAmount(amount, { currency, decimals, locale })`. A ledger that stores whole minor
  units (cents, paise, yen) converts with `amountFromMinorUnits` and `amountToMinorUnits`; an API `…Minor`
  field becomes the string with `amountFromHundredths(rateMinor, decimals)`. `decimals` always comes from the
  API's answer, never from a table of your own.
- A date is a plain `YYYY-MM-DD` calendar day in the hotel's timezone. Never build one with
  `new Date()` arithmetic in local time; use `eachDate(from, to)`.
- `stopSell: true` closes ONE rate plan on that night: a switch. The room type's other rate plans keep
  selling, and so does a rate an OTA derives on its own side. A room count of 0 (`zs.availability.set`)
  is a COUNT: it closes the room type everywhere, and an OTA cancellation or your next count moves it. To
  close a room type and keep it closed, do both in one call: `zs.availability.close` (below). Say which
  of these a button does. Never a zero price.
- Writes may reach 500 days ahead. A write is accepted (202) when it is in ZimmerStack's record; it
  reaches the channels in seconds to minutes. `zs.sync.get()` says how far along it is.

## Sent is not held: read what comes back

- A 202 says "in ZimmerStack's record", not "on the booking sites". Show "saving" until
  `zs.batches.wait(batchId)` reads `landed`. `failed` is not a network error to retry: the channel
  manager refused a value (`parkedCells`, `lastError`) or the write named a room type or rate plan that
  reaches no channel (`unreachable`). A refused value is held, not sent again: send a corrected value for
  those nights. Sending the same value again is refused with the same words.
- Read every write's answer, not only its status: `rejected` (cells not written, with the reason),
  `rounded` (prices kept differently from what was sent), `priceWarnings` and `warnings`. Show them to the
  person who saved.
- A value that ZimmerStack's record and the channel manager both already hold is dropped as unchanged
  (`noopCells`): it is not sent again. So sending the same grid twice does no harm, and it does not
  "refresh" the channels either: never resend on a timer to be safe.
- Someone can change a price or a stay rule on the channel manager's side or in an OTA's extranet. A
  nightly read finds it: `channel.drift.detected` names the nights (`data.drift.cells`, your value and
  theirs), your value is sent again unless the hotel switched that repair off, and `channel.drift.healed`
  follows when a later read agrees. `zs.sync.get()` carries `rates.driftCells`. Show it; never answer it
  by pushing the whole calendar every night.
- `channel.sync.alert` says a problem began (`data.sync.event`: a refused value, a disconnect, prices or
  room counts that stopped going out, a setting changed) and `channel.sync.recovered` that it ended. Show
  both to the hotel; neither is a reason to resend everything.
- A night more than a year ahead that your software never wrote is closed on the booking sites. A room
  count you write for it is sent as written; otherwise it opens by itself when it comes inside the year.

## See what a write will do, and read what it did not do

- Every answer of `zs.availability.set`, `zs.rates.set` and `zs.restrictions.set` may carry `notices`: what
  the write did NOT do, one sentence each with a stable `code`, a `level` (warning or info) and an
  `action`. Read them after every save with `noticesOf(accepted)` and show the warnings to the person
  who saved (`message` and `action`). Branch on `code` (`NOTICES` lists all 19 with what each
  means); a code you do not know was added later, so show it too. A notice is never an error: the write
  was accepted.
- The two that explain most surprises: `ROOM_STILL_ON_SALE` (you stop-sold one rate plan and the room
  still sells through `otherRatePlanIds`) and `COUNT_ZERO_IS_NOT_STOP_SELL` (a count of 0 is a count, which
  the next OTA cancellation or your next count moves).
- `zs.availability.dryRun(updates)`, `zs.rates.dryRun(updates)` and `zs.restrictions.dryRun(updates)` answer
  what the same `set` WOULD do and write nothing: a `WritePreview` (`dryRun: true`, `verdict`, what would
  change, what is already held, the notices), never a `WriteAccepted`. Use one before a large or unusual
  write, or to show a person what a button will do. It spends the minute budgets like the write it
  previews (one request, one write, the same cells), so it is not a free read of the calendar: never
  dry-run on a timer or to "check" a night. `zs.rates.get` and its siblings are the reads.
- `zs.availability.close({ roomTypeId, dateFrom, dateTo })` closes one room type on those nights everywhere:
  its count goes to 0 and stop-sell is switched on for every one of its rate plans. Read `notReached` in
  the answer: it names what the close could not reach (a rate an OTA links on its own side is closed only
  by the count). `zs.availability.reopen` undoes exactly that close; pass `available` when your software
  knows how many rooms are free now. `closeDryRun` and `reopenDryRun` show what each would do. Call
  close and reopen from a person's action or a rule a person set; never from a loop over all rooms.
- When a person asks "why is this night not selling as we sent it", call
  `zs.explain.night({ roomTypeId, date })` and show its `summary`: what your software last sent, what
  ZimmerStack's record holds and who set it, what the channel manager was last seen holding, and any
  value it refused, in its own words. It reads the channel manager's copy as last seen, never a booking
  site's own screen; `seenAt: null` means "never read back", not "wrong". Never loop it over a calendar.

## Bookings and events: the webhook is the nudge, the log is the truth

- Every event of a hotel (an OTA booking arriving, changing, cancelled; a website booking; a channel
  problem and its end; drift) has a `sequence`, one higher than the hotel's last. The webhook carries it,
  and `GET /events` lists every event once, in that order, for 90 days.
- Build the receiver so nothing depends on a delivery: verify it (`verifyWebhook`), answer 2xx at once,
  then read the log from the place you saved:
  `for await (const event of zs.events.all({ after: place })) { apply(event); place = event.sequence; }`
  and save `place` with what you applied, in one transaction. Run the same loop on a schedule (every few
  minutes is plenty) and after a restart: a missed, repeated or out-of-order delivery then changes nothing.
- `event.data.booking.version` counts a booking's events (1, 2, 3 …). A copy you hold with a higher
  version is newer than the event in your hand: do not overwrite it.
- `onGap` on `zs.events.all` fires when the log no longer holds what follows your place (a first run, or
  an outage longer than the log keeps): read `zs.channelBookings.all({ since })` and
  `zs.directBookings.all({ since })`, then carry on from the log.
- Narrow an event with `isOtaBookingEvent`, `isWebsiteBookingEvent`, `isSyncEvent`, `isDriftEvent`,
  `isConnectEvent`. A type you do not know is skipped, never an error: new types are added without notice.
- Two families are about your ACCOUNT, not one hotel: `platform.incident.*` (`isIncidentEvent`) and
  `support.ticket.*` (`isSupportTicketEvent`). They carry no `property` and no `sequence` and are not in
  the event log. Check for them BEFORE any code that reads `event.property`; `zs.status.get()` and
  `zs.supportTickets.get(id)` are the reads behind them.
- A cancelled room stays in `rooms[]` with `status: "CANCELLED"`; `stay` and `occupancy` count the rooms
  still live. `finance.virtualCard: true` means the OTA pays the hotel with a card it issues: the guest
  owes the desk nothing for the room. No card number is ever sent.

## Guest contact

- A guest's phone and email are returned by the API until 30 days after checkout. After that guest.phone and guest.email are null and guest.contactWithheld says "retention", so you can tell withheld from a booking that never had one. The name, the stay and the money stay.
  Copy what you need into your own system when the booking arrives; do not plan to read it back later.
- `guest.contactWithheld` says why `phone` and `email` are null: `"retention"` is final, `"unavailable"`
  means ask again. Never treat null as "the guest gave none" when it is set.
- Every read that returned contact is logged (the key, the partner behind it, when, which bookings) and the hotel's owner sees the list. Read contact only where a person needs it.
- An endpoint receives phone and email only while its owner has guest contact switched on; it can be switched at any time. A partner's company endpoint starts with it off.

## Webhook endpoints by API (a software partner's company key)

- With the scope `webhooks:manage` a company key creates, changes, pauses, resumes, tests and recovers
  its own company webhook endpoints: `zs.webhookEndpoints.*`. No hotel is named: an endpoint is the
  partner's. A test key manages test endpoints (your sandboxes' events), a live key live ones.
- The signing secret is in the answer of `zs.webhookEndpoints.create` and `.rotateSecret`, once. Store it
  in the server's settings at that moment (never in code, a log or a chat); no call reads it back.
- Before planned downtime call `zs.webhookEndpoints.pause`: events are held and `resume` sends them, oldest
  first. After an outage call `zs.webhookEndpoints.recover(id, since)`, or simply read the log.
- `zs.webhookEndpoints.delete` is for good and takes the delivery log with it: only on a person's action.

## Going live, connect links and a hotel's keys (a software partner's company key)

- A hotel you add (`zs.properties.create`) is live from the start. A hotel that let you in by your vendor
  code is not: until it is, a call that names it answers `ARI_NOT_AUTHORITATIVE`.
  `zs.forProperty(id).readiness.get()` answers four checks, each with a sentence and what to do.
- To send a year first, pass `{ beforeGoLive: true }` on each call: `zs.rates.set(prices, { beforeGoLive: true })`.
  Prices and stay rules sent this way are stored and wait (the answer says `heldUntilGoLive: true`).
  A price for every rate plan and night of the year ahead is what the readiness report asks for.
- ROOM COUNTS ARE NOT SENT AHEAD. Until the hotel is live a room count may only LOWER what is on sale:
  one at or below what is on sale goes to the booking sites at once (a held count would oversell a
  room), and one that raises it is refused in the answer's `rejected` list (`NOTHING_ACCEPTED` when
  nothing else in the request landed), because the hotel's own people may still be running its counts.
  Do not loop on that refusal and do not try to work around it: send the room counts with
  `zs.availability.set` right after `goLive` answers.
- `zs.readiness.goLive()` makes your software the hotel's source of truth. Call it when a person decided
  to, once `ready` is true. `NOT_READY` lists the checks that did not pass (`err.details`): fix them and
  call again; never retry it in a loop. Only ZimmerStack support switches a hotel back.
- Connecting a booking site: `zs.connectLinks.create({ propertyId, channel })` (scope `channels:connect`,
  a LIVE key: a test key is refused) answers a one-time `url` for the hotel's own person, who types the
  hotel's id at the booking site (MakeMyTrip also its access token) and confirms every room and rate match
  on ZimmerStack's page. Only Airbnb is connected from the link alone (the host signs in on Airbnb's own
  page): every other booking site must first accept our connectivity partner for the hotel, in its extranet
  or through its support. Send `hotelStep` to the hotel first and the `url` once that step is done. Never
  ask a hotel for a booking site's sign-in, hotel id or token, never store one, and never build a screen
  that takes one: no call accepts it.
  Listen for `channel.connect.completed` and `channel.connect.expired` (match on `data.connect.linkId`).
- `zs.hotelKeys.list`, `.create`, `.rotate` and `.revoke` (scope `keys:manage`) manage the keys you made on
  a hotel you added; never a company key, never the hotel's own. A rotation makes a new key with the same name, scopes, addresses and expiry; the old one keeps answering for 24 hours (retireAt), then stops.
- A VALUE SHOWN ONCE is in one answer and nowhere else: the `key` of `zs.hotelKeys.create` and `.rotate`,
  the `url` of `zs.connectLinks.create`, the `secret` of `zs.webhookEndpoints.create` and `.rotateSecret`.
  Take it with `shownOnce(answer)` and put it in the server's secret store in the same step. It is null
  on a retry of the same request: `shownOnce` then throws `ZimmerStackShownOnceError`, whose `nextStep`
  names the call that gets a new one. Never write code that stores `answer.key ?? ""`. Log
  `withoutShownOnce(answer)`, never the answer itself.

## Billing, support and status (a software partner's company key)

- `zs.billing.get()`, `.invoices()` and `.nextInvoice()` (scope `billing:read`) READ what the partner
  portal's Billing page shows. Nothing pays or changes anything by API. Amounts are decimal strings in
  major units beside `…Minor`: use the money helpers, and never add amounts of two currencies.
- `atCost` on `zs.billing.get()` lists what the channel manager charged above its included room types and
  rate plans, passed on at cost. An item with `status: "RECORDED"` is on no invoice yet: show it as
  recorded, never as billed.
- `zs.supportTickets.create({ severity, subject, message, propertyIds })` (scope `support:write`) opens a
  ticket; ZimmerStack attaches what its own records show. The level follows from the hotels you name: many_hotels needs two or more propertyIds or allProperties true; one_hotel needs exactly one; question takes any or none.
  Open one from a person's action or from one alert, never from a loop, and never put a key, a secret or
  a guest's details in the message.
- Before blaming your own code for a failure across hotels, read `zs.status.get()`: the open incidents
  that touch your hotels. During one, keep what people changed and send it when it is resolved; do not
  resend everything.

## Room types and rate plans

- A hotel sells room types ("Deluxe Room") through rate plans ("Bed and breakfast"). Create or change
  one with `zs.roomTypes.save({ ref, name, roomCount, adults })` and
  `zs.ratePlans.save({ ref, roomTypeRef, name, mealPlan, defaultRate })`. `ref` is the person's own
  id for it: sending the same ref again changes that entity, it never makes a second one. Several in
  one request: `zs.catalog.upsertRoomTypes` and `zs.catalog.upsertRatePlans`. All need the scope
  `catalog:write`.
- A new rate plan needs `defaultRate`, its real price for a night: without it the request is refused
  (400 `VALIDATION`, `details.refs` names the plans) and nothing in it is saved. Every date of a new
  plan can be sold at that price until the price of each night is sent, so never write a test number
  or a made-up one; ask the person for the price. `defaultRate: null` is refused for a plan the
  integration made.
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

## Adding, changing and removing a hotel (a software partner's company key)

- Only a COMPANY key with the scope `properties:write` can do any of the three; a hotel's own key
  cannot (`COMPANY_KEY_REQUIRED`). The person ticks "Also add and remove hotels" when making the key in
  the partner portal; only the account's owner or an Admin is offered that tick box. None of the calls
  names a hotel with `forProperty`.
- `zs.properties.create({ name, owner, address, roomTypes })` adds a hotel and answers with its `id`:
  act on it with `zs.forProperty(id)`. The owner gets the sign-in details by email, never the caller.
  It joins the partner's monthly invoice. With a `zsk_test_` key the same call makes a sandbox, which
  is never billed. A partner may add 20 hotels an hour.
- After adding: a hotel added with its room types is put on the channel manager when its billing
  starts, usually at once (`channelManager` in the answer says). If a call answers 409
  CHANNEL_MANAGER_DISABLED, send its room types again with the same refs (`zs.roomTypes.save` or
  `zs.catalog.upsertRoomTypes`); then the rate plans, then room counts and prices.
- `zs.properties.update(propertyId, { name, address })` changes the name or the address of a hotel the
  partner added. Send only what changes: `name`, and under `address` any of `line1`, `city`,
  `state`, `postalCode`. It never changes the hotel's country, currency, time zone, owner or tax id
  (sending one is `VALIDATION`), and it changes the hotel's record in ZimmerStack, not the name of its
  listing on a booking site. The answer's `changed` lists the fields whose stored value moved; empty
  means everything sent was already stored. `PROPERTY_NOT_CHANGEABLE` means the hotel's owner let the
  partner in, so the owner changes it: show the message and stop. After a new name, `delete` wants that
  new name in `confirm`.
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
  included. On a sandbox, `zs.sandbox.bookings.noShow(bookingId)` makes the real event for a booking
  simulated with `otaName: "Website"`, and `{ undo: true }` its undo.
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
before you write the code that sends it. `zimmerstack_doctor` says what is wrong when a call is
refused or a webhook does not arrive; `zimmerstack_sandbox_limits` prints every budget and how full it
is; `zimmerstack_sandbox_simulate` makes a real booking or channel event of any type on the sandbox, and
`zimmerstack_sandbox_events` reads the ordered log, so a receiver and its catch-up can be tried end to
end. `zimmerstack_sandbox_dry_run` shows what a write would do with nothing written, and its notices;
`zimmerstack_sandbox_explain` tells one night's whole story; `zimmerstack_sandbox_close` closes or reopens
a room type everywhere; `zimmerstack_sandbox_fault` makes the sandbox's pretend channel refuse, throttle
or go down, so the code that handles a refused value or an outage can be tried before a live hotel meets
one (in your own tests: `zs.sandbox.faults.set` and `.clear`). It works with a `zsk_test_` key only and refuses a live one. It is for building; the application
you write calls the API through the client, never through these tools.

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
- [ ] The webhook receiver saves its place in the event log and catches up from it; nothing depends on a delivery arriving, or arriving in order.
- [ ] A write's answer is read: `rejected`, `rounded` and a batch that reads `failed` reach the person who saved.
- [ ] Money is handled as the API's decimal strings with the package's helpers; nothing divides by 100.
- [ ] Guest contact the application needs is copied when the booking arrives, and `contactWithheld` is handled.
- [ ] After every save of prices, room counts or stay rules, the notices (`noticesOf`) reach the person who saved.
- [ ] A button that closes a night says what it closes: one rate plan (stop-sell), the room's count (0), or both (`zs.availability.close`).
- [ ] A value shown once (a key, a connect link, a webhook secret) is taken with `shownOnce`, stored at once, and never logged.
- [ ] Code that reads `event.property` runs only after the event is known not to be an incident or a support-ticket event.
- [ ] No screen asks for, and no code stores, a booking site's password.
- [ ] `npx @zimmerstack/connect doctor` reports nothing that needs attention.
