import { MODIFIER_TAKES_EFFECT, channelPrice } from "@zimmerstack/connect";

import { zs } from "@/lib/zimmerstack";

/** Prices per channel (https://docs.zimmerstack.com/per-ota): read a channel's modifier and set it. */
export async function sellHigherOnBookingCom(): Promise<void> {
  // #region three-calls
  // 1. Which channels, and what each one holds.
  const { channels } = await zs().channels.list();
  const booking = channels.find((channel) => channel.kind === "BookingCom");
  if (!booking) return;

  // 2. Booking.com is sent 18 % more, then 200 less: the whole list of steps, in order.
  //    Needs the scope channel-modifiers:write. Call it when a person saved the setting, never from a loop.
  const result = await zs().channels.setModifier(booking.channelId, [
    { action: "increase", type: "percent", value: 18 },
    { action: "decrease", type: "fixed", value: 200 },
  ]);
  console.log(`4,500 goes to Booking.com as ${channelPrice(4500, result.modifier)}`); // 5110
  console.log(MODIFIER_TAKES_EFFECT); // the sentence to show where the person saves it

  // 3. Nothing else: the channel manager now sends Booking.com every date again, so prices already
  //    on sale there move to the new rule within minutes. No re-send is needed.
  // #endregion
}
