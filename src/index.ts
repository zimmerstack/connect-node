/**
 * @zimmerstack/connect: the ZimmerStack Connect API from your server.
 *
 * Server only. The key can change a hotel's prices on every channel: it never goes to a browser, a
 * mobile app, a repository or a log line.
 */
export { ZimmerStack } from "./client.ts";
export type { ClientEvent, RatePlanInput, ReadOptions, RequestArgs, RoomTypeInput, StructureSaved, WriteOptions, ZimmerStackOptions } from "./client.ts";
export { ZimmerStackError, ZimmerStackUsageError } from "./errors.ts";
export type { LocalErrorCode } from "./errors.ts";
export { addDays, buildGrid, channelPrice, chunk, eachDate, toRanges } from "./grid.ts";
export type { Grid, GridEdits, ModifierStep, Range, Restrictions } from "./grid.ts";
export { BOOKING_EVENT_TYPES, OTA_BOOKING_EVENT_TYPES, WEBSITE_BOOKING_EVENT_TYPES, isOtaBookingEvent, isWebsiteBookingEvent, verifyWebhook, ZimmerStackWebhookError } from "./webhooks.ts";
export type { BookingEvent, BookingEventType, OtaBookingEvent, OtaBookingEventType, WebhookEvent, WebhookEventType, WebsiteBookingEvent, WebsiteBookingEventType } from "./webhooks.ts";
export { ERROR_CODES, LIMITS, MODIFIER_TAKES_EFFECT, SCOPES, SDK_VERSION } from "./generated.ts";
export type * from "./generated.ts";
