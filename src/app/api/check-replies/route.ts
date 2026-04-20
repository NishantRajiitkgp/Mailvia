import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchIncomingMessages } from "@/lib/replies";
import { decryptSecret } from "@/lib/crypto";
import { cronBearerOk } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!cronBearerOk(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: senders } = await db.from("senders").select("id, email, app_password");
  if (!senders || senders.length === 0) return NextResponse.json({ status: "no_senders" });

  const since = new Date(Date.now() - 21 * 86400 * 1000);
  const results: Array<{ sender: string; checked: number; marked_replied: number; saved: number }> = [];

  for (const s of senders) {
    let messages;
    try {
      messages = await fetchIncomingMessages(
        { email: s.email, appPassword: decryptSecret(s.app_password) },
        since
      );
    } catch {
      results.push({ sender: s.email, checked: 0, marked_replied: -1, saved: 0 });
      continue;
    }
    if (messages.length === 0) {
      results.push({ sender: s.email, checked: 0, marked_replied: 0, saved: 0 });
      continue;
    }

    const addrs = Array.from(new Set(messages.map((m) => m.from)));

    const { data: matches } = await db
      .from("recipients")
      .select("id, email, campaign_id, campaigns!inner(sender_id)")
      .in("email", addrs)
      .in("status", ["sent", "pending", "replied"])
      .eq("campaigns.sender_id", s.id);

    const byEmail = new Map<string, { id: string; campaign_id: string }>();
    for (const m of matches ?? []) {
      if (!byEmail.has(m.email)) byEmail.set(m.email, { id: m.id, campaign_id: m.campaign_id });
    }

    let savedCount = 0;
    for (const msg of messages) {
      const hit = byEmail.get(msg.from);
      if (!hit) continue;
      const { error } = await db.from("replies").upsert(
        {
          recipient_id: hit.id,
          campaign_id: hit.campaign_id,
          from_email: msg.from,
          subject: msg.subject,
          snippet: msg.snippet,
          received_at: msg.date?.toISOString() ?? null,
        },
        { onConflict: "recipient_id,received_at", ignoreDuplicates: true }
      );
      if (!error) savedCount++;
    }

    const ids = Array.from(byEmail.values()).map((v) => v.id);
    if (ids.length > 0) {
      await db
        .from("recipients")
        .update({
          status: "replied",
          replied_at: new Date().toISOString(),
          next_follow_up_at: null,
        })
        .in("id", ids)
        .in("status", ["sent", "pending"]); // don't overwrite existing 'replied'
    }

    results.push({ sender: s.email, checked: messages.length, marked_replied: ids.length, saved: savedCount });
  }

  return NextResponse.json({ status: "ok", results });
}
