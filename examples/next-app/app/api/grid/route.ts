import type { GridEdits } from "@zimmerstack/connect";

import { refusal, zs } from "@/lib/zimmerstack";

// Your own sign-in decides who may call these routes: check it first, in both handlers.

/** GET /api/grid?from=2026-12-01&to=2026-12-14: rows are room types with their rate plans, columns are nights. */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return Response.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
  try {
    return Response.json(await zs().grid.load(from, to));
  } catch (err) {
    return refusal(err);
  }
}

/** PUT /api/grid with what the person changed: single nights, only the ones that changed. */
export async function PUT(request: Request): Promise<Response> {
  const edits = (await request.json()) as GridEdits;
  try {
    // Nights are folded into ranges and sent one request per resource. Each answer carries a batchId:
    // the values are in ZimmerStack's record and on their way to the channels.
    const accepted = await zs().grid.save(edits);
    return Response.json({ accepted });
  } catch (err) {
    return refusal(err);
  }
}
