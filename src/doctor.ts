import { ZimmerStack, aboutHowLong, type ZimmerStackOptions } from "./client.ts";
import { ZimmerStackError, ZimmerStackUsageError } from "./errors.ts";
import type { Explain, Limits, Readiness, RequestLog, Status, WebhookEndpoint } from "./generated.ts";
import { checkKey } from "./key.ts";

/**
 * The doctor: one look at an integration when something is wrong (`npx @zimmerstack/connect doctor`).
 *
 * It only READS. In order: is the key the right shape (checked offline, by its own checksum, before
 * anything is sent) and does it answer; is something wrong on ZimmerStack's side (the open incidents
 * that touch your hotels); which hotels and scopes it reaches, and for a hotel that is not live yet,
 * which readiness checks have not passed; every budget and how full it is; the last day's refused
 * requests, grouped by reason; whether the webhook endpoints are being answered, with their last
 * failures; how far what you sent has travelled, and what the last nightly read found changed on the
 * channel manager's side; and, when you name a night, that night's whole story. Each finding is one plain
 * sentence and, where there is something to do, what to do. The key is never printed, returned or put in
 * a message.
 *
 * `diagnose` is what the command runs; call it from your own health page or a deploy check if you like.
 */

export type DoctorCheck = "key" | "reach" | "status" | "hotels" | "limits" | "requests" | "webhooks" | "sync" | "night";

export interface DoctorFinding {
  /** ok: as it should be · info: worth knowing, nothing to do now · attention: something to fix (the command exits 1) */
  level: "ok" | "info" | "attention";
  check: DoctorCheck;
  /** What was found, in one sentence for a person. */
  message: string;
  /** What to do about it; absent when there is nothing to do. */
  action?: string;
  /** The hotel the finding is about, when it is about one. */
  propertyId?: number;
}

/** One budget as the doctor read it. `percentUsed` is null when the API does not count it where this route can read it. */
export interface DoctorBudget {
  propertyId: number | null;
  scope: string;
  per: string;
  window: string;
  quota: number;
  unit: string;
  used: number | null;
  remaining: number | null;
  resetSeconds: number | null;
  percentUsed: number | null;
}

export interface DoctorReport {
  /** false when at least one finding needs attention. */
  ok: boolean;
  checkedAt: string;
  /** "test": a sandbox key. null when the key could not be read at all. */
  mode: "live" | "test" | null;
  keyKind: "hotel" | "company" | null;
  /** The hotels that were looked at (a company key's first few, or the one named). */
  hotels: Array<{ id: number; name: string; sandbox: boolean }>;
  findings: DoctorFinding[];
  budgets: DoctorBudget[];
}

export interface DoctorOptions extends Pick<ZimmerStackOptions, "apiKey" | "fetch" | "baseUrl"> {
  /** A company key: look at this hotel only. Without it the first `maxHotels` hotels are looked at. */
  propertyId?: number;
  /** How many of a company key's hotels to look at. Default 5. */
  maxHotels?: number;
  /**
   * One night to explain (GET /explain): a room type's id and a date, optionally one rate plan. A company
   * key that reaches more than one hotel names the hotel too (`propertyId`): a room type belongs to one.
   */
  night?: { roomTypeId: number; date: string; ratePlanId?: number };
  signal?: AbortSignal;
  /** The clock, for tests. */
  now?: () => Date;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A budget this full is worth a line. */
const NEARLY_FULL = 80;
const PORTAL = "the partner portal (https://partner.zimmerstack.com, Developers)";
const OWNER = "Admin → Developers → API keys (https://admin.zimmerstack.com/configure/developers)";

/** What a scope lets a key do, in a few words. A scope this list does not know is shown by its name. */
const SCOPE_DOES: Record<string, string> = {
  "ari:read": "read the calendar and the sync state",
  "ari:write": "send room counts, prices and stay rules",
  "catalog:write": "create and change room types and rate plans",
  "channel-modifiers:write": "set a channel's price modifier",
  "channel-bookings:read": "read OTA bookings and the channel events",
  "direct-bookings:read": "read the hotel's own website bookings",
  "direct-bookings:cancel": "cancel a website booking and refund it",
  "bookings:read": "read the bookings it created",
  "bookings:write": "create and cancel bookings in the PMS",
  "bookings:payments": "record a payment on a booking it creates",
  "properties:write": "add and remove hotels",
  "webhooks:manage": "manage your company webhook endpoints",
  "channels:connect": "make one-time connect links",
  "keys:manage": "list, mint, rotate and revoke the keys you made on a hotel",
  "billing:read": "read your invoices and your hotel quota",
  "support:write": "open and answer support tickets",
};

/** What to do about a refusal seen in the request log, by its code. */
const REFUSAL_ADVICE: Record<string, string> = {
  VALIDATION: "The request itself is wrong: a field is missing, misnamed or out of range. Read the message your code received (err.message, err.details) and fix the request; sending it again unchanged is refused again.",
  RATE_LIMITED: "A budget was used up. The package waits a minute's budget out by itself; if you call the API without it, wait for Retry-After. If this is constant, send only what changed instead of whole calendars.",
  SCOPE_MISSING: "The key was not given that permission. Whoever made the key adds the scope; no rotation is needed.",
  IP_NOT_ALLOWED: "A request came from an address that is not on the key's allowlist. If it is your own server, add its address to the key; if you do not recognise it, rotate the key.",
  API_KEY_INVALID: "A request carried a key the API does not know. Check the environment of every server that calls the API.",
  API_KEY_REVOKED: "A request carried a revoked key: one that was replaced, revoked by a person, or reported as found in a public place. Put the current key on every server.",
  API_KEY_EXPIRED: "A request carried a key past its end of life. Make a new key and put it on every server.",
  PROPERTY_REQUIRED: "A company key called a hotel route without naming the hotel. Use zs.forProperty(id), or send the X-ZS-Property header.",
  PROPERTY_NOT_FOUND: "A request named a hotel this key may not act on (its owner ended your access, or the id is wrong). zs.properties.list() names the hotels the key reaches.",
  ARI_NOT_AUTHORITATIVE: "A call went to a hotel that is not live yet (your software is not its source of truth), so nothing was written. zs.readiness.get() says what is missing; send values ahead with { beforeGoLive: true }, then zs.readiness.goLive().",
  NOT_READY: "zs.readiness.goLive() was called before every readiness check passed. zs.readiness.get() lists the checks with what to do about each; call goLive again once they pass.",
  LIVE_KEY_REQUIRED: "A connect link was asked for with a test key. A link connects a real booking site, so it is made with a live key; a sandbox has none.",
  KEY_LIMIT: "The hotel already holds as many active keys as a hotel may. Revoke one you no longer use (zs.hotelKeys.revoke), then mint.",
  SUPPORT_TICKET_CLOSED: "A message was sent to a closed support ticket. Open a new ticket and name the old one.",
  WRITES_SUSPENDED: "ZimmerStack has suspended this integration's writes. Write to support@zimmerstack.com; the reason is on zs.sync.get().",
  IDEMPOTENCY_KEY_REUSED: "One idempotency key was sent with two different requests. Make a new key for every new write; reuse a key only to send the same write again.",
  IDEMPOTENCY_IN_FLIGHT: "The same write was sent again while the first was still running. Wait a moment and send it once; the package does.",
  RATE_OUT_OF_BAND: "A price was outside the band the hotel allows around its standing price. It is a guard against a typing slip: check the price, never split the change into steps.",
  CHANNEL_MANAGER_ERROR: "The channel manager did not take a change, so nothing was changed. Try once more later; if it repeats, write to support@zimmerstack.com with a request id.",
  TOO_MANY_UPDATES: "One request carried more updates than a request may. zs.grid.save and the set methods split a large write for you.",
  TOO_MANY_CELLS: "One request named more nights than a request may. zs.grid.save and the set methods split a large write for you.",
};

const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const ago = (iso: string | null | undefined, now: Date): string => {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "at an unknown time";
  const ms = now.getTime() - t;
  return ms < 60_000 ? "just now" : `${aboutHowLong(ms)} ago`;
};
const list = (items: string[], max = 4): string => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`);

/** Why a read did not answer, as a finding. A refusal for a missing scope is information, not a fault. */
function refusalFinding(check: DoctorCheck, what: string, err: unknown, propertyId?: number): DoctorFinding {
  const hotel = propertyId === undefined ? {} : { propertyId };
  if (err instanceof ZimmerStackError) {
    if (err.code === "SCOPE_MISSING") return { level: "info", check, message: `${what} was not read: this key does not hold the scope that route needs.`, ...hotel };
    if (err.code === "RATE_LIMITED") {
      return { level: "attention", check, message: `${what} was not read: the ${err.scope ?? "request"} budget is used up right now.`, action: `It has room again in ${aboutHowLong((err.retryAfterSeconds ?? 60) * 1000)}. Run the doctor again then.`, ...hotel };
    }
    return { level: "attention", check, message: `${what} was not read: ${err.code}${err.status ? ` (${err.status})` : ""}. ${err.message}`, ...hotel };
  }
  return { level: "attention", check, message: `${what} was not read: ${err instanceof Error ? err.name : "an unexpected error"}.`, ...hotel };
}

function budgetRows(limits: Limits): DoctorBudget[] {
  const propertyId = limits.key.propertyId;
  return [...limits.budgets, ...(limits.shield?.budgets ?? [])].map((b) => ({
    propertyId,
    scope: b.scope,
    per: b.per,
    window: b.window,
    quota: b.quota,
    unit: b.unit,
    used: b.used,
    remaining: b.remaining,
    resetSeconds: b.resetSeconds,
    percentUsed: b.used === null || b.quota <= 0 ? null : Math.min(100, Math.round((b.used / b.quota) * 100)),
  }));
}

function limitFindings(limits: Limits, rows: DoctorBudget[], propertyId: number | undefined): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const hotel = propertyId === undefined ? {} : { propertyId };
  for (const b of rows) {
    if (b.remaining === 0) {
      out.push({
        level: "attention",
        check: "limits",
        message: `The ${b.scope} budget is used up: ${b.quota.toLocaleString("en-US")} ${b.unit} per ${b.per}, ${b.window}.`,
        action: `It has room again in ${aboutHowLong((b.resetSeconds ?? 60) * 1000)}. The package waits by itself for a minute's budget; for an hour's or a day's, send less: only the nights that changed.`,
        ...hotel,
      });
    } else if (b.percentUsed !== null && b.percentUsed >= NEARLY_FULL) {
      out.push({ level: "info", check: "limits", message: `The ${b.scope} budget is ${b.percentUsed}% used (${(b.used ?? 0).toLocaleString("en-US")} of ${b.quota.toLocaleString("en-US")} ${b.unit}, ${b.window}).`, ...hotel });
    }
  }
  const counted = rows.filter((b) => b.percentUsed !== null);
  if (counted.length > 0 && out.length === 0) {
    const fullest = counted.reduce((a, b) => ((b.percentUsed ?? 0) > (a.percentUsed ?? 0) ? b : a));
    out.push({ level: "ok", check: "limits", message: `${plural(rows.length, "budget")} read; the fullest is ${fullest.scope} at ${fullest.percentUsed}%.`, ...hotel });
  }
  const standing = limits.shield?.standing;
  if (standing && standing.level !== "CLEAR") {
    const until = standing.until ? ` until ${standing.until}` : "";
    out.push(
      standing.level === "WATCH"
        ? { level: "info", check: "limits", message: `This integration is being watched${standing.reason ? `: ${standing.reason}` : ""}. Nothing is refused.`, ...hotel }
        : {
            level: "attention",
            check: "limits",
            message:
              standing.level === "PAUSED"
                ? `This integration's writes are paused${until}${standing.reason ? `: ${standing.reason}` : ""}. Only writes that close inventory are accepted.`
                : `This integration's writes are suspended${standing.reason ? `: ${standing.reason}` : ""}. Every write is refused until ZimmerStack releases it.`,
            action: standing.level === "PAUSED" ? "A pause with an end lifts by itself. Fix what the reason names; send closes on their own if a night must stop selling now." : "Write to support@zimmerstack.com with the hotel's id.",
            ...hotel,
          }
    );
  }
  return out;
}

/** Is something wrong on ZimmerStack's side: the open incidents that touch this key's hotels, and the ones that ended in the last week. */
function statusFindings(status: Status, now: Date): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const whose = (p: Status["incidents"]["open"][number]["properties"]) => (p.all ? "every hotel" : `${plural(p.count, "hotel")} of yours${p.ids.length ? ` (${list(p.ids.map((id) => `#${id}`), 6)})` : ""}`);
  for (const incident of status.incidents.open) {
    const said = incident.updates[0]?.message;
    out.push({
      // An incident is ZimmerStack's to fix, not yours: it is a note, and the command still exits 0 for it.
      level: "info",
      check: "status",
      message: `ZimmerStack has an open incident on ${incident.componentName} (${incident.severity.replace(/_/g, " ")}, ${incident.status}), started ${ago(incident.startedAt, now)}, touching ${whose(incident.properties)}: ${incident.title}.${said ? ` Latest: ${said}` : ""}`,
      action: "This is on ZimmerStack's side: there is nothing to fix in your integration. Keep what your people changed and send it when the incident is resolved (platform.incident.resolved, or zs.status.get()). Do not resend everything.",
    });
  }
  for (const incident of status.incidents.recent) {
    out.push({ level: "info", check: "status", message: `An incident on ${incident.componentName} ended ${ago(incident.resolvedAt ?? incident.updatedAt, now)}: ${incident.title}.` });
  }
  if (status.incidents.open.length === 0) {
    out.push({
      level: "ok",
      check: "status",
      message: `ZimmerStack reports no open incident that touches your hotels${status.incidents.recent.length ? "" : ", and none in the last 7 days"}.`,
      // "operational" is a person's word, not a monitor's: say so, so a problem nobody reported yet is still reported.
      action: status.incidents.recent.length ? undefined : "An incident is recorded by ZimmerStack's staff. If something looks wrong on its side and none is listed, write to support@zimmerstack.com or open a ticket (zs.supportTickets.create).",
    });
  }
  if (status.page) out.push({ level: "info", check: "status", message: `The status page: ${status.page}` });
  return out.map((f) => (f.action === undefined ? { level: f.level, check: f.check, message: f.message } : f));
}

/** A hotel that is not live yet: what its readiness report says, check by check. */
function readinessFindings(who: string, report: Readiness, propertyId: number): DoctorFinding[] {
  const failing = report.checks.filter((c) => !c.passed);
  const out: DoctorFinding[] = [
    {
      level: "attention",
      check: "hotels",
      message: `${who} is not live yet: your software is not its source of truth, so what you send is refused (ARI_NOT_AUTHORITATIVE) unless the call says beforeGoLive.`,
      action: report.ready
        ? "Every readiness check passed. zs.forProperty(id).readiness.goLive() switches it on: call it when a person has decided to."
        : `${plural(failing.length, "readiness check")} of ${report.checks.length} ${failing.length === 1 ? "has" : "have"} not passed (below). Do what each says, read zs.readiness.get() again, then zs.readiness.goLive().`,
      propertyId,
    },
  ];
  for (const check of failing) {
    out.push({ level: "attention", check: "hotels", message: `${who}, readiness check ${check.id}: ${check.summary}`, ...(check.action ? { action: check.action } : {}), propertyId });
  }
  return out;
}

/** One night, explained: the API's own sentences, and the facts in it that need a person. */
function nightFindings(who: string, night: Explain, now: Date, propertyId: number): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const about = `${who}, ${night.roomType.name} (#${night.roomType.id}) on ${night.date}`;
  for (const sentence of night.summary) out.push({ level: "info", check: "night", message: `${about}: ${sentence}`, propertyId });
  const lastPush = night.count.pushes[0];
  if (lastPush && lastPush.outcome === "refused") {
    out.push({
      level: "attention",
      check: "night",
      message: `${about}: the last send of this night's room count was refused by the channel manager ${ago(lastPush.at, now)}${lastPush.words ? `, in its words: ${lastPush.words}` : ""}.`,
      action: "Send the count again (zs.availability.set). If it is refused again, the words say why: fix that at the hotel's booking site or write to support@zimmerstack.com.",
      propertyId,
    });
  }
  for (const plan of night.plans) {
    const name = `${plan.name} (#${plan.ratePlanId})`;
    if (plan.send.held) {
      out.push({
        level: "attention",
        check: "night",
        message: `${about}: the value sent for ${name} was refused by the channel manager ${ago(plan.send.held.since, now)} and is held, not sent again. Its words: ${plan.send.held.words}`,
        action: "Send a different value for that night. The same value is answered as held.",
        propertyId,
      });
    }
    if (plan.reach === "not-linked") {
      out.push({ level: "attention", check: "night", message: `${about}: ${name} is not on the channel manager, so nothing sent for it reaches a booking site.`, action: "Save the rate plan again (zs.ratePlans.save) so it is linked, then send the night again.", propertyId });
    } else if (plan.reach === "not-mapped") {
      out.push({
        level: "attention",
        check: "night",
        message: `${about}: no connected booking site sells ${name}, so a price or a stop-sell sent for it changes nothing a guest sees${night.channels.seenAt ? ` (the connections were last read ${ago(night.channels.seenAt, now)})` : ""}.`,
        action: "A person matches the plan to the booking site's rate (a connect link, the partner portal or the hotel's Channels app). A plan matched today reads mapped after the next nightly read.",
        propertyId,
      });
    }
  }
  const seen = [night.count.channelManager.seenAt, ...night.plans.flatMap((p) => [p.price.channelManager.seenAt, p.stayRules.channelManager.seenAt])];
  out.push({
    level: "info",
    check: "night",
    message: `${about}: this is ZimmerStack's record and the channel manager's copy as last seen${seen.some((at) => at === null) ? " (part of this night was never read back from it, so that part is not known)" : ""}. It is not a booking site's own screen.${night.count.lastSent === null && night.plans.every((p) => p.price.lastSent === null && p.stayRules.lastSent === null) ? ` What your software last sent was not found in the ${plural(night.searched.batches, "write")} looked through: values are kept only for writes made since this was added.` : ""}`,
    propertyId,
  });
  return out;
}

async function requestFindings(zs: ZimmerStack, now: Date, signal: AbortSignal | undefined): Promise<DoctorFinding[]> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const refused: RequestLog["items"] = [];
  let more = false;
  let cursor: string | undefined;
  // At most five pages of refusals (1,000 requests): enough to group a bad day, and a bounded number of reads.
  for (let page = 0; page < 5; page++) {
    const answer = await zs.requests.list({ since, status: "errors", limit: 200, cursor }, { signal });
    refused.push(...answer.items);
    more = answer.more;
    cursor = answer.more ? (answer.nextCursor ?? undefined) : undefined;
    if (!cursor) break;
  }
  const out: DoctorFinding[] = [];
  if (refused.length === 0) out.push({ level: "ok", check: "requests", message: "No request made with this key was refused in the last 24 hours." });
  const groups = new Map<string, RequestLog["items"]>();
  for (const r of refused) {
    const reason = r.errorCode ?? `HTTP ${r.status}`;
    groups.set(reason, [...(groups.get(reason) ?? []), r]);
  }
  for (const [reason, items] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const last = items[0]!; // the log is newest first
    const routes = [...new Set(items.map((r) => `${r.method} ${r.route}`))];
    const recent = now.getTime() - Date.parse(last.at) < HOUR_MS;
    const fault = items.some((r) => r.status >= 500);
    out.push({
      // Still happening in the last hour, or a fault on our side: look now. Older than that: it may be fixed already.
      level: recent || fault ? "attention" : "info",
      check: "requests",
      message: `${reason}: ${plural(items.length, "request")} refused in the last 24 hours${more ? " (and more)" : ""}, the last ${ago(last.at, now)}, on ${list(routes)}.${last.requestId ? ` Last request id: ${last.requestId}.` : ""}`,
      action: REFUSAL_ADVICE[reason] ?? (fault ? "That is a fault on ZimmerStack's side. If it repeats, write to support@zimmerstack.com and quote the request id." : "Look the code up: https://docs.zimmerstack.com/guides/errors"),
    });
  }
  // The newest requests of any status, for the addresses they came from: an address that is not yours is the first sign of a leaked key.
  const newest = await zs.requests.list({ limit: 200 }, { signal });
  const addresses = [...new Set(newest.items.map((r) => r.address).filter((a): a is string => Boolean(a)))];
  if (addresses.length > 0) {
    out.push({
      level: "info",
      check: "requests",
      message: `The newest ${plural(newest.items.length, "request")} came from ${plural(addresses.length, "address", "addresses")}: ${list(addresses, 6)}.`,
      action: "If one of them is not a server of yours, rotate the key now.",
    });
  }
  return out;
}

function endpointFindings(endpoint: WebhookEndpoint, failures: Array<{ eventType: string; lastError: string | null; attempts: number; occurredAt: string }>, lastStatus: number | null, now: Date): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  let host = "an address that does not parse";
  try {
    host = new URL(endpoint.url).host;
  } catch {
    /* keep the words */
  }
  const name = `Endpoint ${endpoint.id} (${host})`;
  if (endpoint.status === "SUSPENDED") {
    out.push({
      level: "attention",
      check: "webhooks",
      message: `${name} is suspended${endpoint.statusReason ? `: ${endpoint.statusReason}` : ""}. Events sent while it is suspended are dropped, not held.`,
      action: "Fix the receiver, resume the endpoint, then recover since the moment it stopped (zs.webhookEndpoints.recover), or read the event log from your last sequence (zs.events.all).",
    });
  } else if (endpoint.status === "PAUSED") {
    out.push({ level: "info", check: "webhooks", message: `${name} is paused. Its events are held and go out, oldest first, when it is resumed.`, action: "Resume it when your receiver is ready (zs.webhookEndpoints.resume)." });
  } else if (endpoint.health.state === "failing") {
    out.push({
      level: "attention",
      check: "webhooks",
      message: `${name} is failing: ${plural(endpoint.health.consecutiveFailures, "delivery", "deliveries")} in a row${endpoint.health.failingSince ? `, since ${ago(endpoint.health.failingSince, now)}` : ""}${endpoint.health.lastErrorMessage ? `. Last error: ${endpoint.health.lastErrorMessage}` : ""}.`,
      action:
        lastStatus === 400 || lastStatus === 401 || lastStatus === 403
          ? `Your receiver answered ${lastStatus}: it is refusing the delivery, most often because the signature did not verify. Verify the RAW body (before any JSON parsing) with this endpoint's current secret; after a rotation the new secret must be in place within 24 hours.`
          : "Your receiver must be reachable on a public https address and answer 2xx within 10 seconds. Answer first, do the work afterwards. An endpoint that fails for 72 hours is suspended.",
    });
  } else if (endpoint.health.lastSuccessAt) {
    out.push({ level: "ok", check: "webhooks", message: `${name} is answering: its last delivery was accepted ${ago(endpoint.health.lastSuccessAt, now)}.` });
  } else {
    out.push({ level: "info", check: "webhooks", message: `${name} has not accepted a delivery yet.`, action: "Send it a test (zs.webhookEndpoints.test) and read what your receiver answered in the delivery log." });
  }
  if (endpoint.previousSecretExpiresAt && Date.parse(endpoint.previousSecretExpiresAt) > now.getTime()) {
    out.push({ level: "info", check: "webhooks", message: `${name} is in a secret rotation: deliveries are signed with both secrets until ${endpoint.previousSecretExpiresAt}.`, action: "Put the new secret on your receiver before then." });
  }
  if (endpoint.status === "ACTIVE" && endpoint.health.state !== "failing" && failures.length > 0) {
    const f = failures[0]!;
    out.push({
      level: "info",
      check: "webhooks",
      message: `${name} has ${plural(failures.length, "failed delivery", "failed deliveries")} in its log; the newest is a ${f.eventType} of ${ago(f.occurredAt, now)}${f.lastError ? ` (${f.lastError})` : ""}.`,
      action: "Send one again with zs.webhookEndpoints.deliveries.redeliver, or read the event log from your last sequence: nothing is lost.",
    });
  }
  if (!endpoint.eventTypes.some((t) => t.startsWith("channel.booking."))) {
    out.push({ level: "info", check: "webhooks", message: `${name} does not listen to OTA bookings (it takes: ${list(endpoint.eventTypes)}).` });
  }
  return out;
}

async function webhookFindings(zs: ZimmerStack, keyKind: "hotel" | "company", now: Date, signal: AbortSignal | undefined): Promise<DoctorFinding[]> {
  if (keyKind === "hotel") {
    return [{ level: "info", check: "webhooks", message: "A hotel's own key cannot read webhook endpoints.", action: "The hotel's owner sees them, with every delivery, under Admin → Developers → Webhooks." }];
  }
  let endpoints: WebhookEndpoint[];
  try {
    endpoints = (await zs.webhookEndpoints.list({ signal })).items;
  } catch (err) {
    if (err instanceof ZimmerStackError && err.code === "SCOPE_MISSING") {
      return [{ level: "info", check: "webhooks", message: "This key does not hold the scope webhooks:manage, so the doctor cannot look at your webhook endpoints.", action: `See them in ${PORTAL}, or make a company key with "Also manage webhooks" ticked.` }];
    }
    return [refusalFinding("webhooks", "The webhook endpoints", err)];
  }
  if (endpoints.length === 0) {
    return [{ level: "info", check: "webhooks", message: "No webhook endpoint of this key's mode exists: your software hears of bookings only when it reads the event log.", action: "Create one with zs.webhookEndpoints.create, or read zs.events.all on a schedule." }];
  }
  const out: DoctorFinding[] = [];
  for (const endpoint of endpoints) {
    let failures: Array<{ id: string; eventType: string; lastError: string | null; attempts: number; occurredAt: string }> = [];
    let lastStatus: number | null = null;
    try {
      failures = (await zs.webhookEndpoints.deliveries.list(endpoint.id, { status: "FAILED", limit: 5 }, { signal })).items;
      const newest = failures[0];
      if (newest && endpoint.health.state === "failing") {
        // What the receiver answered on the newest failed delivery: a 401 reads very differently from a timeout.
        const detail = await zs.webhookEndpoints.deliveries.get(endpoint.id, newest.id, { signal });
        lastStatus = detail.attempts_log[detail.attempts_log.length - 1]?.responseStatus ?? null;
      }
    } catch (err) {
      out.push(refusalFinding("webhooks", `Endpoint ${endpoint.id}'s delivery log`, err));
    }
    out.push(...endpointFindings(endpoint, failures, lastStatus, now));
  }
  return out;
}

async function hotelFindings(zs: ZimmerStack, hotel: { id: number; name: string; sandbox: boolean }, keyKind: "hotel" | "company", now: Date, signal: AbortSignal | undefined, budgets: DoctorBudget[]): Promise<DoctorFinding[]> {
  const out: DoctorFinding[] = [];
  const propertyId = hotel.id;
  const who = `${hotel.name} (#${hotel.id})`;

  /* which scopes, and whether its writes go anywhere */
  let scopes: string[] = [];
  let writesRefused = false;
  try {
    const property = await zs.property.get({ signal });
    scopes = property.scopes ?? [];
    const may = scopes.map((s) => SCOPE_DOES[s] ?? s);
    out.push({
      level: "info",
      check: "hotels",
      message: `${who}${property.sandbox ? ", a sandbox" : ""}: this key may ${may.length ? list(may, 12) : "only read which hotel it is for"}.`,
      propertyId,
    });
    if (!property.sandbox && scopes.includes("ari:write") && property.ariAuthoritative === false) {
      writesRefused = true;
      try {
        // No scope is needed to read it, and it calls no channel.
        out.push(...readinessFindings(who, await zs.readiness.get({ signal }), propertyId));
      } catch (err) {
        out.push({
          level: "attention",
          check: "hotels",
          message: `${who} is not live yet: your software is not its source of truth, so what you send is refused (ARI_NOT_AUTHORITATIVE).`,
          action: "zs.readiness.get() says what is missing and zs.readiness.goLive() switches it on.",
          propertyId,
        });
        out.push(refusalFinding("hotels", `${who}'s readiness report`, err, propertyId));
      }
    }
    if (property.products && property.products.channelManager === false) {
      out.push({ level: "info", check: "hotels", message: `${who} is not on the channel manager yet.`, action: "The first room type you save for it (zs.roomTypes.save) puts it there.", propertyId });
    }
  } catch (err) {
    out.push(refusalFinding("hotels", `${who}'s details`, err, propertyId));
  }

  /* every budget */
  try {
    const limits = await zs.limits.get({ signal });
    const rows = budgetRows(limits);
    budgets.push(...rows);
    out.push(...limitFindings(limits, rows, propertyId));
  } catch (err) {
    out.push(refusalFinding("limits", `${who}'s budgets`, err, propertyId));
  }

  /* how far what was sent has travelled, and what the last nightly read found */
  if (scopes.includes("ari:read")) {
    try {
      const sync = await zs.sync.get({ signal });
      const before = out.length;
      if (sync.inventory.state === "OUT_OF_SYNC") {
        out.push({
          level: "attention",
          check: "sync",
          message: `${who}: room counts are not reaching the channels${sync.inventory.outOfSyncSince ? `, since ${ago(sync.inventory.outOfSyncSince, now)}` : ""}${sync.inventory.lastError ? `. Last error: ${sync.inventory.lastError}` : ""}.`,
          action: "ZimmerStack keeps trying and nothing you sent is lost. If it has lasted more than an hour, write to support@zimmerstack.com with the hotel's id.",
          propertyId,
        });
      } else if (sync.inventory.state === "PENDING") {
        out.push({ level: "info", check: "sync", message: `${who}: ${plural(sync.inventory.pendingCells, "room count")} on the way to the channels.`, propertyId });
      } else if (sync.inventory.state === "DISABLED" && !writesRefused && !sync.sandbox) {
        out.push({ level: "info", check: "sync", message: `${who}: room counts are not being sent to any channel.`, action: "That is expected until a booking site is connected and selling.", propertyId });
      }
      if (sync.rates.parkedCells > 0) {
        out.push({
          level: "attention",
          check: "sync",
          message: `${who}: ${plural(sync.rates.parkedCells, "price or stay-rule night")} were refused by the channel manager and are held: they are not on sale as you sent them.`,
          action: "Send a corrected value for those nights. The batch that carried them reads failed (zs.batches.get), and channel.sync.alert named the refusal.",
          propertyId,
        });
      }
      const erroredAfterLastPush = sync.rates.lastErrorAt && (!sync.rates.lastPushAt || Date.parse(sync.rates.lastErrorAt) > Date.parse(sync.rates.lastPushAt));
      if (erroredAfterLastPush) {
        out.push({
          level: "attention",
          check: "sync",
          message: `${who}: the last send of prices failed ${ago(sync.rates.lastErrorAt, now)}${sync.rates.lastError ? `: ${sync.rates.lastError}` : ""}.`,
          action: "ZimmerStack retries by itself. If the newest pending batch stays pending for more than a few minutes, write to support@zimmerstack.com.",
          propertyId,
        });
      } else if (sync.rates.dirtyCells > 0) {
        out.push({ level: "info", check: "sync", message: `${who}: ${plural(sync.rates.dirtyCells, "price or stay-rule night")} on the way to the channels.`, propertyId });
      }
      if ((sync.rates.driftCells ?? 0) > 0) {
        out.push({
          level: "info",
          check: "sync",
          message: `${who}: the last nightly read found ${plural(sync.rates.driftCells ?? 0, "night")} where the channel manager held something other than what you sent${sync.rates.driftSeenAt ? ` (read ${ago(sync.rates.driftSeenAt, now)})` : ""}. Someone changed a price or a stay rule on the channel manager's side.`,
          action: "Your value is sent again by itself unless the hotel switched that repair off; channel.drift.detected named the nights and channel.drift.healed follows when a later read agrees. If the number is still here tomorrow, send those nights again.",
          propertyId,
        });
      }
      const unreachable = sync.newestPendingBatch?.unreachable ?? [];
      if (unreachable.length > 0) {
        out.push({
          level: "attention",
          check: "sync",
          message: `${who}: the newest write named ${plural(unreachable.length, "room type or rate plan", "room types or rate plans")} that reach no channel, so those values were written and sent nowhere.`,
          action: "zs.catalog.get() shows each one's sync state. Save the room type or rate plan again (zs.roomTypes.save, zs.ratePlans.save) so it is linked, then send the nights again.",
          propertyId,
        });
      }
      if (out.length === before) out.push({ level: "ok", check: "sync", message: `${who}: everything you sent is ${sync.sandbox ? "in the sandbox's record" : "on the channels"}, and the last nightly read agreed with it.`, propertyId });

      const channels = await zs.channels.list({ signal });
      const issues = [...channels.channels.flatMap((c) => c.openIssues.map((i) => ({ ...i, on: c.kind }))), ...channels.propertyIssues.map((i) => ({ ...i, on: "the hotel" }))];
      for (const issue of issues) {
        out.push({
          level: "attention",
          check: "sync",
          message: `${who}: an open channel problem on ${issue.on}: ${issue.event}, raised ${ago(issue.raisedAt, now)}.`,
          action: "The hotel sees it on its Channels screen with what to do. channel.sync.recovered is sent when it ends.",
          propertyId,
        });
      }
      if (!sync.sandbox && channels.channels.length === 0) {
        out.push({ level: "info", check: "sync", message: `${who}: no booking site is connected yet, so nothing you send is on sale anywhere.`, action: keyKind === "company" ? "Send the hotel a one-time connect link (zs.connectLinks.create, scope channels:connect), or connect one on the hotel's page in the partner portal." : "Connect one in the Channels app (https://channels.zimmerstack.com).", propertyId });
      }
    } catch (err) {
      out.push(refusalFinding("sync", `${who}'s sync state`, err, propertyId));
    }
  } else {
    out.push({ level: "info", check: "sync", message: `${who}: the sync state was not read, because this key does not hold ari:read.`, propertyId });
  }
  return out;
}

/**
 * Run every check and return what was found. Reads only; never throws for something the API answered
 * (that is a finding). `apiKey` defaults to the environment variable ZIMMERSTACK_CONNECT_KEY.
 *
 * @example
 * const report = await diagnose();
 * if (!report.ok) console.error(formatDoctorReport(report));
 */
export async function diagnose(options: DoctorOptions = {}): Promise<DoctorReport> {
  const now = options.now?.() ?? new Date();
  const report: DoctorReport = { ok: true, checkedAt: now.toISOString(), mode: null, keyKind: null, hotels: [], findings: [], budgets: [] };
  const done = (): DoctorReport => {
    report.ok = !report.findings.some((f) => f.level === "attention");
    return report;
  };
  const key = options.apiKey ?? (typeof process !== "undefined" && process.env ? process.env.ZIMMERSTACK_CONNECT_KEY : undefined);

  /* 1. the key's shape, offline */
  const shape = checkKey(key);
  report.mode = shape.mode;
  if (!shape.ok) {
    report.findings.push({
      level: "attention",
      check: "key",
      message: shape.message,
      action:
        shape.problem === "empty"
          ? `Put the key in the environment variable ZIMMERSTACK_CONNECT_KEY on your server (or in the project's .env while you build). A software company makes one in ${PORTAL}; a hotel's owner under ${OWNER}.`
          : "Nothing was sent. Copy the key again, whole, from where it was shown when it was made; a key is shown once, so if it is gone, make a new one.",
    });
    return done();
  }
  report.findings.push({ level: shape.format === "legacy" ? "info" : "ok", check: "key", message: shape.message });

  let zs: ZimmerStack;
  try {
    // Short waits and one retry: a doctor that hangs is no help. Reads only, so a live key is fine anywhere.
    zs = new ZimmerStack({ apiKey: key, fetch: options.fetch, baseUrl: options.baseUrl, timeoutMs: 20_000, maxRetries: 1, maxWaitSeconds: 15 });
  } catch (err) {
    report.findings.push({ level: "attention", check: "key", message: err instanceof ZimmerStackUsageError ? err.message : "The client could not be made with this key." });
    return done();
  }

  /* 2. does it answer, and whose is it */
  let hotels: Array<{ id: number; name: string; sandbox: boolean }>;
  try {
    const listed = await zs.properties.list({ signal: options.signal });
    report.keyKind = listed.keyKind === "company" ? "company" : "hotel";
    hotels = listed.properties.map((p) => ({ id: p.id, name: p.name, sandbox: p.sandbox === true }));
    report.findings.push({
      level: "ok",
      check: "reach",
      message:
        report.keyKind === "company"
          ? `The key answers. It is a company key that reaches ${plural(hotels.length, "hotel")}${hotels.length ? `: ${list(hotels.map((h) => `${h.name} (#${h.id})`), 6)}` : ""}.`
          : `The key answers. It is the key of one hotel: ${hotels[0] ? `${hotels[0].name} (#${hotels[0].id})` : "which it could not name"}.`,
    });
  } catch (err) {
    const code = err instanceof ZimmerStackError ? err.code : "";
    const say = (message: string, action: string) => report.findings.push({ level: "attention", check: "reach", message, action });
    if (code === "API_KEY_INVALID") say("The API does not know this key.", `It may belong to another environment, or have been deleted. Make a new one in ${PORTAL} (a hotel's owner: ${OWNER}).`);
    else if (code === "API_KEY_REVOKED") say("This key was revoked: replaced by a rotation whose 24 hours have passed, revoked by a person, or reported as found in a public place.", "Make a new key, put it in your server's settings (never in code), and check where the old one was kept.");
    else if (code === "API_KEY_EXPIRED") say("This key is past the end of life it was given.", "Make a new key, or ask whoever made it to give it a later end.");
    else if (code === "IP_NOT_ALLOWED") say("The key is valid, but this machine's address is not on its allowlist.", "Run the doctor from your server, or add this address to the key (the allowlist is edited without rotating).");
    else if (code === "NETWORK_ERROR" || code === "TIMEOUT") say("ZimmerStack could not be reached from this machine.", "Check that this machine may make outgoing https requests to api.zimmerstack.com (a proxy or a firewall), then run the doctor again.");
    else report.findings.push(refusalFinding("reach", "The key's hotels", err));
    return done();
  }

  /* is something wrong on ZimmerStack's side: asked before anything about the hotels, because it explains much of what follows */
  try {
    report.findings.push(...statusFindings(await zs.status.get({ signal: options.signal }), now));
  } catch (err) {
    report.findings.push(refusalFinding("status", "ZimmerStack's status", err));
  }

  /* 3 to 6. each hotel: scopes, budgets, sync */
  const company = report.keyKind === "company";
  let chosen = hotels;
  if (company) {
    if (options.propertyId !== undefined) {
      chosen = hotels.filter((h) => h.id === options.propertyId);
      if (chosen.length === 0) {
        report.findings.push({ level: "attention", check: "hotels", message: `This key does not reach a hotel with the id ${options.propertyId}.`, action: "zs.properties.list() names the hotels it reaches. A hotel's owner can end a partner's access at any time." });
      }
    } else {
      const max = Math.max(1, options.maxHotels ?? 5);
      chosen = hotels.slice(0, max);
      if (hotels.length > max) report.findings.push({ level: "info", check: "hotels", message: `The first ${max} of ${hotels.length} hotels were looked at.`, action: "Name another with --property <id>." });
    }
    if (hotels.length === 0) {
      report.findings.push({ level: "info", check: "hotels", message: "This company key reaches no hotel yet.", action: "Add one with zs.properties.create (scope properties:write) or in the partner portal; a test key makes a sandbox." });
      // A company key's own budgets, with no hotel named.
      try {
        const limits = await zs.limits.get({ signal: options.signal });
        const rows = budgetRows(limits);
        report.budgets.push(...rows);
        report.findings.push(...limitFindings(limits, rows, undefined));
      } catch (err) {
        report.findings.push(refusalFinding("limits", "The key's budgets", err));
      }
    }
  }
  report.hotels = chosen;
  for (const hotel of chosen) {
    report.findings.push(...(await hotelFindings(company ? zs.forProperty(hotel.id) : zs, hotel, report.keyKind, now, options.signal, report.budgets)));
  }

  /* one night, when one was named */
  if (options.night) {
    const { roomTypeId, date, ratePlanId } = options.night;
    const hotel = chosen.length === 1 ? chosen[0] : undefined;
    if (!Number.isInteger(roomTypeId) || roomTypeId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      report.findings.push({ level: "attention", check: "night", message: "The night to explain needs a room type's numeric id and a date as YYYY-MM-DD.", action: "npx @zimmerstack/connect doctor --room-type 412 --night 2026-12-31 (zs.roomTypes.list() names the ids)." });
    } else if (!hotel) {
      report.findings.push({ level: "attention", check: "night", message: "The night was not explained: a room type belongs to one hotel, and this key reaches more than one.", action: "Name the hotel too: --property <id>." });
    } else {
      const who = `${hotel.name} (#${hotel.id})`;
      try {
        const night = await (company ? zs.forProperty(hotel.id) : zs).explain.night({ roomTypeId, date, ...(ratePlanId === undefined ? {} : { ratePlanId }) }, { signal: options.signal });
        report.findings.push(...nightFindings(who, night, now, hotel.id));
      } catch (err) {
        report.findings.push(refusalFinding("night", `${who}'s night ${date}`, err, hotel.id));
      }
    }
  }

  /* the last day's refused requests */
  try {
    report.findings.push(...(await requestFindings(zs, now, options.signal)));
  } catch (err) {
    report.findings.push(refusalFinding("requests", "The key's request log", err));
  }

  /* the webhook endpoints */
  report.findings.push(...(await webhookFindings(zs, report.keyKind, now, options.signal)));
  return done();
}

const MARK = { ok: "ok   ", info: "note ", attention: "FIX  " } as const;
const TITLES: Record<DoctorCheck, string> = {
  key: "The key",
  reach: "Does it answer",
  status: "Is it ZimmerStack",
  hotels: "Hotels and scopes",
  limits: "Budgets",
  requests: "Refused requests, last 24 hours",
  webhooks: "Webhook endpoints",
  sync: "Sync and drift",
  night: "This night",
};

/** The report as text for a terminal: one section per check, each finding with what to do. Never contains the key. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [`ZimmerStack doctor · ${report.mode === "test" ? "sandbox key" : report.mode === "live" ? "live key" : "no usable key"}${report.keyKind ? ` · ${report.keyKind} key` : ""} · ${report.checkedAt}`, ""];
  for (const check of Object.keys(TITLES) as DoctorCheck[]) {
    const found = report.findings.filter((f) => f.check === check);
    if (found.length === 0) continue;
    lines.push(TITLES[check]);
    for (const f of found) {
      lines.push(`  ${MARK[f.level]}${f.message}`);
      if (f.action) lines.push(`       → ${f.action}`);
    }
    if (check === "limits" && report.budgets.length > 0) {
      lines.push("       Every budget (used of quota):");
      for (const b of report.budgets) {
        const fill = b.used === null ? "not counted on this route" : `${b.used.toLocaleString("en-US")} of ${b.quota.toLocaleString("en-US")} ${b.unit}${b.percentUsed === null ? "" : ` (${b.percentUsed}%)`}`;
        lines.push(`       ${b.propertyId === null ? "" : `#${b.propertyId} `}${b.scope}: ${fill} · ${b.window}, per ${b.per}`);
      }
    }
    lines.push("");
  }
  const attention = report.findings.filter((f) => f.level === "attention").length;
  lines.push(attention === 0 ? "Nothing needs attention." : `${plural(attention, "thing")} ${attention === 1 ? "needs" : "need"} attention (marked FIX).`);
  return lines.join("\n");
}
