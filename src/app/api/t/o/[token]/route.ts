import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyToken } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function gifResponse() {
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "content-length": String(PIXEL.length),
      "cache-control": "no-store, private",
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const raw = token.replace(/\.gif$/, "");
  const id = verifyToken("o", raw);
  if (!id) return gifResponse(); // always return a pixel so it doesn't look broken

  try {
    const db = supabaseAdmin();
    const { data: r } = await db
      .from("recipients")
      .select("id, campaign_id")
      .eq("id", id)
      .maybeSingle();
    if (r) {
      await db.from("tracking_events").insert({
        recipient_id: r.id,
        campaign_id: r.campaign_id,
        kind: "open",
        user_agent: req.headers.get("user-agent") ?? null,
      });
    }
  } catch {}
  return gifResponse();
}
