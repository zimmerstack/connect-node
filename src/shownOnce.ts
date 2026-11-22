import type { ConnectLinkCreated, HotelKeyCreated, HotelKeyRotated, WebhookEndpointCreated, WebhookSecretRotated } from "./generated.ts";

/**
 * Values the API shows ONCE: a key it minted or rotated, a connect link's address, a webhook signing
 * secret. Each is in the answer of the call that made it and nowhere else: ZimmerStack keeps a hash,
 * never the value, and no call reads it back.
 *
 * Two things lose one. Printing the answer (a log line, an error report), which leaves the value where
 * it should never be; and a retry: the same request sent again under its idempotency key (the client does
 * this by itself after a lost answer) is answered from a stored copy, and that copy holds null in the
 * value's place. `shownOnce` and `withoutShownOnce` are for those two.
 */
export type ShownOnceAnswer = HotelKeyCreated | HotelKeyRotated | ConnectLinkCreated | WebhookEndpointCreated | WebhookSecretRotated;

/** Which value an answer shows once. */
export type ShownOnceKind = "hotel-key" | "rotated-hotel-key" | "connect-link" | "webhook-secret" | "rotated-webhook-secret";

const FIELD: Record<ShownOnceKind, "key" | "url" | "secret"> = {
  "hotel-key": "key",
  "rotated-hotel-key": "key",
  "connect-link": "url",
  "webhook-secret": "secret",
  "rotated-webhook-secret": "secret",
};

/** What to do when the value is gone, by kind: the way back the API offers. */
const WAY_BACK: Record<ShownOnceKind, string> = {
  "hotel-key": "Rotate the key (zs.hotelKeys.rotate(propertyId, keyId)): the rotation's answer carries a new one, and the old one stops after 24 hours.",
  "rotated-hotel-key": "Revoke the new key (zs.hotelKeys.revoke) and mint one (zs.hotelKeys.create): the key it replaced keeps answering for 24 hours meanwhile.",
  "connect-link": "Make a new link (zs.connectLinks.create with a new idempotency key): it withdraws this one.",
  "webhook-secret": "Rotate the endpoint's secret (zs.webhookEndpoints.rotateSecret(endpoint.id)): the rotation's answer carries a new one.",
  "rotated-webhook-secret": "Rotate the endpoint's secret again (zs.webhookEndpoints.rotateSecret): the old secret keeps signing for 24 hours meanwhile.",
};

function kindOf(answer: unknown): ShownOnceKind | undefined {
  if (answer === null || typeof answer !== "object") return undefined;
  const a = answer as Record<string, unknown>;
  if ("url" in a && "link" in a) return "connect-link";
  if ("key" in a && "retired" in a) return "rotated-hotel-key";
  if ("key" in a && "view" in a) return "hotel-key";
  if ("secret" in a && "endpoint" in a) return "webhook-secret";
  if ("secret" in a && "secretVersion" in a) return "rotated-webhook-secret";
  return undefined;
}

/** The answer carried no value: it is a replay of an earlier request. `nextStep` says what to do; nothing here holds a secret. */
export class ZimmerStackShownOnceError extends Error {
  /** Which value is gone. */
  readonly kind: ShownOnceKind;
  /** The way back, in a sentence that names the call. */
  readonly nextStep: string;
  constructor(kind: ShownOnceKind) {
    super(
      `This answer is a replay of a request ZimmerStack already answered, so it does not carry the ${FIELD[kind]}: that is shown once, and no copy is kept to show again. If you stored it the first time, use that. If the first answer was lost: ${WAY_BACK[kind]}`
    );
    this.name = "ZimmerStackShownOnceError";
    this.kind = kind;
    this.nextStep = WAY_BACK[kind];
  }
}

/**
 * The value an answer shows once: the key of `zs.hotelKeys.create` and `.rotate`, the `url` of
 * `zs.connectLinks.create`, the `secret` of `zs.webhookEndpoints.create` and `.rotateSecret`.
 *
 * It never hands back null or an empty string for you to store by mistake: when the answer is a replay
 * and the value is gone, it throws `ZimmerStackShownOnceError`, whose `nextStep` names the call that
 * gets you a new one. Store what it returns in your server's settings or secret store at once; never in
 * code, a log line, an error report or a chat.
 *
 * @example
 * const minted = await zs.hotelKeys.create(propertyId, { name: "Night audit job", scopes: ["ari:read"] });
 * await secrets.put(`zimmerstack/hotel-${propertyId}`, shownOnce(minted));
 * console.log(withoutShownOnce(minted)); // safe to log: the key is not in it
 */
export function shownOnce(answer: ShownOnceAnswer): string {
  const kind = kindOf(answer);
  if (!kind) throw new TypeError("shownOnce takes the answer of zs.hotelKeys.create, zs.hotelKeys.rotate, zs.connectLinks.create, zs.webhookEndpoints.create or zs.webhookEndpoints.rotateSecret.");
  const value = (answer as unknown as Record<string, unknown>)[FIELD[kind]];
  if (typeof value !== "string" || value === "") throw new ZimmerStackShownOnceError(kind);
  return value;
}

/**
 * A copy of the answer with the shown-once value taken out (null in its place), for a log line, an
 * audit record or an error report. The answer you pass is not changed.
 */
export function withoutShownOnce<T extends ShownOnceAnswer>(answer: T): T {
  const kind = kindOf(answer);
  if (!kind) return answer;
  return { ...answer, [FIELD[kind]]: null };
}
