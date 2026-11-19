import { ZimmerStackError, addDays } from "@zimmerstack/connect";

import { zs } from "@/lib/zimmerstack";

/** The first calls to make with a new key: which hotel is this, what does it sell, and one price changed. */
export async function firstCalls(): Promise<void> {
  // Which hotel, in which timezone and currency, and what this key may do.
  const property = await zs().property.get();
  console.log(`${property.name}: ${property.currency}, ${property.timezone}, scopes ${property.scopes.join(", ")}`);

  // #region load
  // The grid for the next fortnight: rows are room types with their rate plans, columns are nights.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: property.timezone }).format(new Date()); // YYYY-MM-DD in the hotel's zone
  const grid = await zs().grid.load(today, addDays(today, 13));
  const plan = grid.rows[0]?.plans[0];
  // #endregion
  if (!plan) return console.log("This property has no rate plan yet.");
  console.log(`${plan.ratePlan.name} tonight: ${plan.rate[today] ?? "no price set"}`);

  try {
    // #region save
    // Change one price (major units: 5200 = 5,200.00). Accepted means it is in ZimmerStack's record.
    const [accepted] = await zs().grid.save({ rates: [{ ratePlanId: plan.ratePlan.id, date: addDays(today, 7), rate: 5200 }] });
    if (!accepted) return;
    // #endregion
    // #region landed
    // On its way to the channels: "landed", or still "pending" after five minutes.
    const batch = await zs().batches.wait(accepted.batchId);
    console.log(`${accepted.acceptedCells} night changed, ${batch.status}`);
    // #endregion
  } catch (err) {
    if (!(err instanceof ZimmerStackError)) throw err;
    console.log(`Refused (${err.code}): ${err.message}`); // err.code is stable; err.message is for a person
  }
}
