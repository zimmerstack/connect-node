import { findNotice } from "@zimmerstack/connect";

import { zs } from "@/lib/zimmerstack";

/**
 * The sandbox's pretend channel can fail (https://docs.zimmerstack.com/sandbox#faults): make it refuse a
 * price, and watch your software meet what a live hotel meets on a bad day. Test keys only.
 */
export async function refusedPrice(ratePlanId: number, night: string): Promise<void> {
  // #region refuse-and-watch
  // The next price or stay rule sent is refused, in these words, as the channel manager refuses.
  const fault = await zs().sandbox.faults.set({ kind: "refuse", values: 1, message: "Rate is below the channel's minimum" });
  for (const step of fault.watch) console.log(step); // what to do next, and what you should then see

  // Send a price. It is accepted (it is in the record); the pretend channel then refuses it.
  const [accepted] = await zs().rates.set([{ ratePlanId, dateFrom: night, dateTo: night, rate: "100.00" }]);
  if (!accepted) return;
  const batch = await zs().batches.wait(accepted.batchId);
  console.log(batch.status, batch.parkedCells, batch.lastError); // failed 1 "Rate is below the channel's minimum"

  // The same value again is answered as held: it is not sent a second time.
  const again = await zs().rates.dryRun([{ ratePlanId, dateFrom: night, dateTo: night, rate: "100.00" }]);
  console.log(findNotice(again, "VALUE_HELD")?.message ?? "not held");

  // End the fault. A different price for that night lands, and the night is no longer held.
  await zs().sandbox.faults.clear();
  // #endregion
}
