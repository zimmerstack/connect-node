import { findNotice, noticesOf, type CloseDone, type WriteAccepted } from "@zimmerstack/connect";

import { zs } from "@/lib/zimmerstack";

/*
 * See what a write will do, and read what it did not do (https://docs.zimmerstack.com/dry-run,
 * /notices, /close-and-reopen, /explain). A 202 says a value is in ZimmerStack's record; these say
 * whether it does what you meant.
 */

/** Ask first: what would this stop-sell do? Nothing is written. */
export async function previewStopSell(ratePlanId: number, night: string): Promise<boolean> {
  // #region dry-run
  // The same updates the real write takes. The answer is a preview: dryRun is true and nothing was written.
  const [preview] = await zs().restrictions.dryRun([{ ratePlanId, dateFrom: night, dateTo: night, stopSell: true }]);
  if (!preview) return false;
  console.log(preview.verdict, preview.wouldChangeCells, "would change,", preview.unchangedCells, "already held");

  // The notices say what the write would NOT do. Show them to the person before they press Save.
  for (const notice of noticesOf(preview)) console.log(notice.level, notice.code, notice.message);
  // #endregion
  return preview.verdict === "would-write";
}

/** Save, then read what the save did not do. */
export async function stopSellAndRead(ratePlanId: number, night: string): Promise<WriteAccepted[]> {
  // #region notices
  const accepted = await zs().restrictions.set([{ ratePlanId, dateFrom: night, dateTo: night, stopSell: true }]);

  // Accepted is not "the room is closed". A stop-sell is a switch on ONE rate plan.
  const stillSelling = findNotice(accepted, "ROOM_STILL_ON_SALE");
  if (stillSelling) {
    // The room type is still on sale through its other plans: say so, with what to do about it.
    console.log(stillSelling.message);
    console.log(stillSelling.action, "Other plans:", stillSelling.otherRatePlanIds?.join(", "));
  }
  // Every other notice goes to the person too; a code you do not know is shown like the rest.
  for (const notice of noticesOf(accepted)) if (notice !== stillSelling) console.log(notice.level, notice.code, notice.message);
  // #endregion
  return accepted;
}

/** Close a room type everywhere, and put it back. */
export async function closeThenReopen(roomTypeId: number, dateFrom: string, dateTo: string, roomsFreeNow: number): Promise<CloseDone> {
  // #region close-and-reopen
  // One call: the room type's count goes to 0 AND stop-sell is switched on for every one of its rate plans.
  const closed = await zs().availability.close({ roomTypeId, dateFrom, dateTo });
  console.log(closed.count.changedNights, "nights closed,", closed.ratePlans.length, "rate plans stopped");

  // Read what the close could not reach: a close that reads done can still leave something selling.
  for (const gap of closed.notReached) console.log(gap.what, gap.reason, gap.message);

  // Later: undo exactly that close. Only your software knows how many rooms are free now, so say it.
  const reopened = await zs().availability.reopen({ roomTypeId, dateFrom, dateTo, available: roomsFreeNow });
  console.log(reopened.count.changedNights, "nights reopened,", reopened.skippedNights, "were not closed by a close");
  // #endregion
  return reopened;
}

/** "Why is this night not selling as we sent it?" One read. */
export async function explainNight(roomTypeId: number, night: string): Promise<void> {
  // #region explain
  const answer = await zs().explain.night({ roomTypeId, date: night });

  // The whole story in plain sentences, most important first: show these to the person who asked.
  for (const sentence of answer.summary) console.log(sentence);

  // The same as fields: what you last sent, what our record holds, what the channel manager was last seen holding.
  const { lastSent, record, channelManager, inSync } = answer.count;
  console.log("count: sent", lastSent?.available ?? "not found", "· record", record.available, `(${record.setBy})`, "· channel manager", channelManager.available, "· in sync", inSync);
  // seenAt null means that night was never read back: not known, which is not the same as wrong.
  if (channelManager.seenAt === null) console.log("The channel manager's copy of this night has not been read yet.");
  // #endregion
}
