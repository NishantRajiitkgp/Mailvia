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

  // Look back 7 days — replies to older sends are edge-case and not worth
  // the extra 60-second budget needed to scan the full 21-day inbox window.
  const since = new Date(Date.now() - 7 * 86400 * 1000);
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

    // Two-step: first get this sender's campaign ids, then match recipients.
    // (The earlier `campaigns!inner(sender_id)` inline filter was silently
    // breaking the follow-up .update(), leading to replies being saved but
    // recipient.status never flipping to 'replied'.)
    const { data: campaignRows } = await db
      .from("campaigns")
      .select("id")
      .eq("sender_id", s.id);
    const campaignIds = (campaignRows ?? []).map((c) => c.id);
    if (campaignIds.length === 0) {
      results.push({ sender: s.email, checked: messages.length, marked_replied: 0, saved: 0 });
      continue;
    }

    const { data: matches } = await db
      .from("recipients")
      .select("id, email, campaign_id, status")
      .in("email", addrs)
      .in("campaign_id", campaignIds);

    const byEmail = new Map<string, { id: string; campaign_id: string; status: string }>();
    for (const m of matches ?? []) {
      if (!byEmail.has(m.email)) byEmail.set(m.email, { id: m.id, campaign_id: m.campaign_id, status: m.status });
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

    // Only flip statuses that aren't already 'replied' / 'unsubscribed' / 'bounced'.
    const flipIds = Array.from(byEmail.values())
      .filter((v) => v.status === "sent" || v.status === "pending")
      .map((v) => v.id);

    let markedReplied = 0;
    if (flipIds.length > 0) {
      const { data: updated, error: upErr } = await db
        .from("recipients")
        .update({
          status: "replied",
          replied_at: new Date().toISOString(),
          next_follow_up_at: null,
        })
        .in("id", flipIds)
        .select("id");
      if (upErr) console.error("[check-replies] update failed:", upErr);
      markedReplied = updated?.length ?? 0;
    }

    results.push({ sender: s.email, checked: messages.length, marked_replied: markedReplied, saved: savedCount });
  }

  return NextResponse.json({ status: "ok", results });
}
