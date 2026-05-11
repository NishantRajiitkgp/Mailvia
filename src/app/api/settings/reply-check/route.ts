import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function unauth() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET() {
  const s = await getSession();
  if (!s.loggedIn) return unauth();
  const db = supabaseAdmin();
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "reply_check_enabled")
    .maybeSingle();
  return NextResponse.json({ enabled: data?.value === "true" });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s.loggedIn) return unauth();
  const body = await req.json().catch(() => null);
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "expected { enabled: boolean }" }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { error } = await db
    .from("app_settings")
    .upsert({ key: "reply_check_enabled", value: body.enabled ? "true" : "false" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ enabled: body.enabled });
}
