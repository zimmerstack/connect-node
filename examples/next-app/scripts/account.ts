import { zs } from "@/lib/zimmerstack";

/*
 * What a software partner used to ask ZimmerStack for, read by its own software with its company key:
 * its bills, a support ticket, and whether something is wrong on ZimmerStack's side
 * (https://docs.zimmerstack.com/billing, /support, /status).
 */

/** What is owed, how many hotels you may still add, and what was passed on at cost. Read only. */
export async function readBilling(): Promise<void> {
  // #region billing
  const bill = await zs().billing.get();
  // Amounts are decimal strings in major units, in the invoice's currency. Never add two currencies.
  console.log("owed:", bill.outstanding.amount, bill.currency, "on", bill.outstanding.openInvoices, "invoices");
  console.log("hotels:", bill.quota.properties.used, "of", bill.quota.properties.allowed, "·", bill.quota.properties.free, "free");

  // What the channel manager charged above the room types and rate plans a hotel includes, at cost.
  // RECORDED means it is on no invoice yet: show it as recorded, never as billed.
  for (const item of bill.atCost.items) console.log(item.month, item.property.name, item.what, item.amount, bill.atCost.currency, item.status);

  // What the next monthly invoice is made of, hotel by hotel, read today.
  const next = await zs().billing.nextInvoice();
  for (const line of next.lines) console.log(line.hotel, line.rooms, "rooms", line.band, line.unitPrice, "→", line.amount, next.currency);
  // #endregion
}

/** Open a ticket for a problem across hotels. Call it from a person's action, or from one alert: never in a loop. */
export async function openTicket(propertyIds: number[], whatWeSee: string): Promise<number> {
  // #region support-ticket
  // The level follows from the hotels you name: two or more is many_hotels, exactly one is one_hotel.
  // Never put a key, a secret or a guest's details in the message: ZimmerStack attaches what its own records show.
  const ticket = await zs().supportTickets.create({
    severity: propertyIds.length >= 2 ? "many_hotels" : propertyIds.length === 1 ? "one_hotel" : "question",
    subject: "Prices are not going out",
    message: whatWeSee,
    propertyIds,
  });
  console.log(ticket.id, ticket.status, ticket.firstReply.target, ticket.firstReply.dueAt ?? "");

  // What ZimmerStack attached when it opened: ids, counts, states and times.
  console.log(ticket.diagnostic?.requests?.refused ?? 0, "of your requests were refused in the last", ticket.diagnostic?.windowHours, "hours");
  // #endregion
  return ticket.id;
}

/** Read the thread, answer, and close it when it is solved. */
export async function followTicket(ticketId: number, reply?: string): Promise<void> {
  // #region follow-ticket
  const ticket = await zs().supportTickets.get(ticketId);
  for (const message of ticket.messages) console.log(message.createdAt, message.author, message.body);

  // ANSWERED means ZimmerStack replied and waits for you. A reply of yours sets it back to OPEN.
  if (ticket.status === "ANSWERED" && reply) await zs().supportTickets.reply(ticketId, reply);
  else if (ticket.status === "ANSWERED") await zs().supportTickets.close(ticketId);
  // #endregion
}

/** "Is it you or is it me?" The incidents that touch your hotels. */
export async function isItZimmerStack(): Promise<boolean> {
  // #region status
  const status = await zs().status.get();
  console.log(status.overall);

  for (const incident of status.incidents.open) {
    // properties names YOUR hotels it touches; updates is what ZimmerStack said, newest first.
    console.log(incident.componentName, incident.severity, incident.status, incident.properties.all ? "every hotel" : incident.properties.ids.join(", "));
    console.log(incident.updates[0]?.message);
  }
  // During an incident, keep what your people changed and send it when it is resolved. Do not resend everything.
  // #endregion
  return status.incidents.open.length > 0;
}
