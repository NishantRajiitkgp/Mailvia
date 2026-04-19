import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyToken } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function process(token: string) {
  const id = verifyToken("u", token);
  if (!id) return { ok: false, status: 400 as const, msg: "invalid_token" };
  const db = supabaseAdmin();
  const { data: r } = await db
    .from("recipients")
    .select("id, email, campaign_id")
    .eq("id", id)
    .maybeSingle();
  if (!r) return { ok: false, status: 404 as const, msg: "not_found" };
  await db
    .from("unsubscribes")
    .upsert({ email: r.email, campaign_id: r.campaign_id }, { onConflict: "email" });
  await db
    .from("recipients")
    .update({ status: "unsubscribed", next_follow_up_at: null })
    .eq("email", r.email);
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({ token: "" }));
  const res = await process(token);
  if (!res.ok) return NextResponse.json({ error: res.msg }, { status: res.status });
  return NextResponse.json({ ok: true });
}

// Gmail/Outlook one-click List-Unsubscribe-Post sends POST with no body — handled above.
// Some clients also do a GET, so redirect them to the page.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const res = await process(token);
  const url = new URL(`/u/${token}`, req.nextUrl.origin);
  return NextResponse.redirect(url, res.ok ? 302 : 303);
}
