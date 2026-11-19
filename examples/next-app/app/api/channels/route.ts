import { MODIFIER_TAKES_EFFECT, channelPrice, type ModifierStep } from "@zimmerstack/connect";

import { refusal, zs } from "@/lib/zimmerstack";

/** GET /api/channels: each connected channel, the steps it holds, and what a price of 4,500 becomes there. */
export async function GET(): Promise<Response> {
  try {
    const { channels, asOf } = await zs().channels.list();
    return Response.json({
      asOf,
      // Show this sentence where the person saves a modifier.
      takesEffect: MODIFIER_TAKES_EFFECT,
      channels: channels.map((channel) => ({
        channelId: channel.channelId,
        name: channel.title ?? channel.kind,
        // [] = prices go as they are; null = a rule set by hand that this API cannot express.
        modifier: channel.modifier,
        example: channel.modifier ? channelPrice(4500, channel.modifier) : null,
      })),
    });
  } catch (err) {
    return refusal(err);
  }
}

/**
 * PUT /api/channels { channelId, steps }: the person saved a channel's modifier.
 * One call moves every price sent to that channel from then on: call it from that Save button only.
 */
export async function PUT(request: Request): Promise<Response> {
  const { channelId, steps } = (await request.json()) as { channelId: string; steps: ModifierStep[] };
  try {
    return Response.json(await zs().channels.setModifier(channelId, steps));
  } catch (err) {
    return refusal(err);
  }
}

/**
 * POST /api/channels: the "Apply to nights already on sale" button. Prices already on a channel keep the
 * old modifier until they are sent again; this sends them again, unchanged. A few times a day per hotel.
 */
export async function POST(): Promise<Response> {
  try {
    return Response.json(await zs().rates.resend(), { status: 202 });
  } catch (err) {
    return refusal(err);
  }
}
