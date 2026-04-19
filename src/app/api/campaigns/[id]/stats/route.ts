import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.loggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = supabaseAdmin();

  const [
    total,
    sent,
    replied,
    failed,
    pending,
    unsubscribed,
    followUpsSent,
    retriesSent,
    opens,
    clicks,
    uniqueOpeners,
    uniqueClickers,
  ] = await Promise.all([
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).in("status", ["sent", "replied"]),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "replied"),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).in("status", ["failed", "bounced"]),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "pending"),
    db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "unsubscribed"),
    db.from("send_log").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "follow_up"),
    db.from("send_log").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "retry"),
    db.from("tracking_events").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "open"),
    db.from("tracking_events").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("kind", "click"),
    db.from("tracking_events").select("recipient_id").eq("campaign_id", id).eq("kind", "open"),
    db.from("tracking_events").select("recipient_id").eq("campaign_id", id).eq("kind", "click"),
  ]);

  const uniqOpen = new Set((uniqueOpeners.data ?? []).map((r: { recipient_id: string }) => r.recipient_id)).size;
  const uniqClick = new Set((uniqueClickers.data ?? []).map((r: { recipient_id: string }) => r.recipient_id)).size;
  const sentCount = sent.count ?? 0;

  // opens by hour (campaign's timezone, default IST)
  const { data: campTz } = await db.from("campaigns").select("timezone").eq("id", id).maybeSingle();
  const tz = campTz?.timezone || "Asia/Kolkata";
  const { data: openRows } = await db
    .from("tracking_events")
    .select("created_at")
    .eq("campaign_id", id)
    .eq("kind", "open");
  const opensByHour = new Array(24).fill(0);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
  (openRows ?? []).forEach((o: { created_at: string }) => {
    const h = Number(fmt.format(new Date(o.created_at)));
    opensByHour[h === 24 ? 0 : h]++;
  });

  const rate = (num: number, denom: number) => (denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0);

  return NextResponse.json({
    total: total.count ?? 0,
    sent: sentCount,
    replied: replied.count ?? 0,
    failed: failed.count ?? 0,
    pending: pending.count ?? 0,
    unsubscribed: unsubscribed.count ?? 0,
    follow_ups_sent: followUpsSent.count ?? 0,
    retries_sent: retriesSent.count ?? 0,
    opens: opens.count ?? 0,
    unique_opens: uniqOpen,
    clicks: clicks.count ?? 0,
    unique_clicks: uniqClick,
    rates: {
      open_rate: rate(uniqOpen, sentCount),
      click_rate: rate(uniqClick, sentCount),
      reply_rate: rate(replied.count ?? 0, sentCount),
      bounce_rate: rate(failed.count ?? 0, sentCount),
      unsubscribe_rate: rate(unsubscribed.count ?? 0, sentCount),
    },
    opens_by_hour: opensByHour,
    timezone: tz,
  });
}
