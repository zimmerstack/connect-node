import { shownOnce } from "@zimmerstack/connect";

import { zs } from "@/lib/zimmerstack";

/**
 * Webhooks by API (https://docs.zimmerstack.com/webhooks#by-api): a software partner's company key with
 * the scope webhooks:manage creates and looks after its own company webhook endpoints. No hotel is named:
 * an endpoint belongs to you. A test key manages the endpoints of your sandboxes.
 */
export async function createEndpoint(url: string, storeSecret: (secret: string) => Promise<void>): Promise<number> {
  // #region create-and-test
  // dataAck: you confirm that guest booking details will be sent to this address.
  const made = await zs().webhookEndpoints.create({ url, dataAck: true });
  const { endpoint } = made;
  // The signing secret is in this answer only. Put it in your server's settings now, never in a log.
  // It is null only on a replay of this same request (the first answer was lost): rotate to get a new one.
  // shownOnce returns the secret or throws; it never hands you an empty one to store.
  await storeSecret(made.secret ?? shownOnce(await zs().webhookEndpoints.rotateSecret(endpoint.id)));

  // A signed sample of any event type, to see your receiver answer. It says mode "test".
  const { deliveryId } = await zs().webhookEndpoints.test(endpoint.id, { eventType: "channel.booking.created" });
  const delivery = await zs().webhookEndpoints.deliveries.get(endpoint.id, deliveryId);
  console.log(endpoint.id, endpoint.status, delivery.status, delivery.attempts_log.at(-1)?.responseStatus ?? "not answered yet");
  // #endregion
  return endpoint.id;
}

/** Around planned downtime: nothing is dropped. */
export async function downtime(endpointId: number, work: () => Promise<void>): Promise<void> {
  // #region pause-and-resume
  await zs().webhookEndpoints.pause(endpointId); // events are held from now
  await work();
  const resumed = await zs().webhookEndpoints.resume(endpointId);
  console.log(resumed.heldEvents, "held events are going out, oldest first");
  // #endregion
}
