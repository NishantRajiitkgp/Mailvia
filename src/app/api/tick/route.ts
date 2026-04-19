import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendMail } from "@/lib/mail";
import { render, toHtml, toPlain } from "@/lib/template";
import { inWindow, dayKey } from "@/lib/time";
import { signToken, appUrl } from "@/lib/tokens";
import { downloadAttachment } from "@/lib/attachment";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauth() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  const header = req.headers.get("authorization") ?? "";
  if (header !== `Bearer ${secret}`) return unauth();

  const db = supabaseAdmin();
  const now = new Date();

  const { data: campaign } = await db
    .from("campaigns")
    .select("*")
    .eq("status", "running")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!campaign) return NextResponse.json({ status: "no_running_campaign" });

  const tz = campaign.timezone || "Asia/Kolkata";
  if (!inWindow(now, tz, campaign.schedule, campaign.window_start_hour, campaign.window_end_hour)) {
    return NextResponse.json({ status: "outside_window", tz });
  }

  // honor scheduled start
  if (campaign.start_at && new Date(campaign.start_at) > now) {
    return NextResponse.json({ status: "not_yet_started", start_at: campaign.start_at });
  }

  // resolve sender creds
  let sender: { email: string; appPassword: string; fromName?: string | null } | null = null;
  if (campaign.sender_id) {
    const { data: s } = await db
      .from("senders")
      .select("email, app_password, from_name")
      .eq("id", campaign.sender_id)
      .maybeSingle();
    if (s) sender = { email: s.email, appPassword: decryptSecret(s.app_password), fromName: s.from_name };
  }

  // global gap check
  const { data: last } = await db
    .from("send_log")
    .select("sent_at")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.sent_at) {
    const gapMs = campaign.gap_seconds * 1000;
    if (now.getTime() - new Date(last.sent_at).getTime() < gapMs) {
      return NextResponse.json({ status: "gap_not_elapsed" });
    }
  }

  const today = dayKey(now, tz);
  const { count: todayCount } = await db
    .from("send_log")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("day", today);
  if ((todayCount ?? 0) >= campaign.daily_cap) {
    return NextResponse.json({ status: "daily_cap_reached", sent_today: todayCount });
  }

  // ----- pick next thing to send: follow-up > retry > fresh -----
  const nowIso = now.toISOString();
  let kind: "initial" | "follow_up" | "retry" = "initial";
  let recipient: any = null;
  let step: any = null;

  if (campaign.follow_ups_enabled) {
    const { data: due } = await db
      .from("recipients")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "sent")
      .not("next_follow_up_at", "is", null)
      .lte("next_follow_up_at", nowIso)
      .order("next_follow_up_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (due) {
      recipient = due;
      kind = "follow_up";
      const { data: s } = await db
        .from("follow_up_steps")
        .select("*")
        .eq("campaign_id", campaign.id)
        .eq("step_number", due.follow_up_count + 1)
        .maybeSingle();
      if (!s) {
        // no step defined → clear schedule, move on
        await db.from("recipients").update({ next_follow_up_at: null }).eq("id", due.id);
        return NextResponse.json({ status: "follow_up_step_missing", recipient: due.email });
      }
      step = s;
    }
  }

  if (!recipient) {
    const { data: retryR } = await db
      .from("recipients")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .gt("retry_count", 0)
      .not("next_retry_at", "is", null)
      .lte("next_retry_at", nowIso)
      .order("next_retry_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (retryR) { recipient = retryR; kind = "retry"; }
  }

  if (!recipient) {
    // Per-domain throttling: don't hit the same company MX twice within 10 min.
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const { data: recentLog } = await db
      .from("send_log")
      .select("recipients!inner(domain)")
      .gt("sent_at", tenMinAgo);
    const hotDomains = new Set(
      (recentLog ?? [])
        .map((r: { recipients: { domain: string | null } | { domain: string | null }[] }) => {
          const rec = Array.isArray(r.recipients) ? r.recipients[0] : r.recipients;
          return rec?.domain;
        })
        .filter((d): d is string => Boolean(d))
    );

    const { data: candidates } = await db
      .from("recipients")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .eq("retry_count", 0)
      .order("row_index", { ascending: true })
      .limit(20);

    const fresh = (candidates ?? []).find((c) => !c.domain || !hotDomains.has(c.domain)) ?? null;
    if (fresh) { recipient = fresh; kind = "initial"; }
    else if ((candidates ?? []).length > 0) {
      return NextResponse.json({
        status: "domain_cooldown",
        blocked_domains: Array.from(hotDomains),
      });
    }
  }

  if (!recipient) {
    // Check if any follow-ups are still pending in the future — if so, keep running
    const { count: upcoming } = await db
      .from("recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("status", "sent")
      .not("next_follow_up_at", "is", null);
    const { count: pendingRetries } = await db
      .from("recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("status", "pending");
    if ((upcoming ?? 0) === 0 && (pendingRetries ?? 0) === 0) {
      await db.from("campaigns").update({ status: "done" }).eq("id", campaign.id);
      return NextResponse.json({ status: "campaign_finished", campaign: campaign.name });
    }
    return NextResponse.json({ status: "waiting", upcoming_follow_ups: upcoming ?? 0 });
  }

  // skip if globally unsubscribed
  const { data: unsub } = await db
    .from("unsubscribes")
    .select("email")
    .eq("email", recipient.email)
    .maybeSingle();
  if (unsub) {
    await db.from("recipients").update({ status: "unsubscribed", next_follow_up_at: null }).eq("id", recipient.id);
    return NextResponse.json({ status: "skipped_unsubscribed", to: recipient.email });
  }

  // ---- render ----
  const vars = { ...(recipient.vars ?? {}), Name: recipient.name, Company: recipient.company };
  const rawSubject = kind === "follow_up" && step.subject ? step.subject : campaign.subject;
  const subject = kind === "follow_up" && recipient.message_id && !/^re:/i.test(rawSubject)
    ? `Re: ${rawSubject}`
    : rawSubject;
  const templateSrc = kind === "follow_up" ? step.template : campaign.template;
  const body = render(templateSrc, vars);

  const base = appUrl();
  const unsubUrl = campaign.unsubscribe_enabled ? `${base}/u/${signToken("u", recipient.id)}` : undefined;
  const openPixelUrl = campaign.tracking_enabled
    ? `${base}/api/t/o/${signToken("o", recipient.id)}.gif`
    : undefined;
  const wrapUrl = campaign.tracking_enabled
    ? (url: string) => `${base}/api/t/c/${signToken("c", recipient.id)}?u=${encodeURIComponent(url)}`
    : undefined;

  const html = toHtml(body, { wrapUrl, openPixelUrl, unsubscribeUrl: unsubUrl });
  const text = toPlain(body, { unsubscribeUrl: unsubUrl });

  // ---- attachment ----
  let attachments: { filename: string; content: Buffer }[] | undefined;
  if (campaign.attachment_path && campaign.attachment_filename) {
    const att = await downloadAttachment(db, campaign.attachment_path, campaign.attachment_filename);
    if (att) attachments = [att];
  }

  // ---- headers ----
  const headers: Record<string, string> = {};
  if (unsubUrl) {
    headers["List-Unsubscribe"] = `<${unsubUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  // Thread follow-ups as replies to the initial message so Gmail groups them.
  if (kind === "follow_up" && recipient.message_id) {
    headers["In-Reply-To"] = recipient.message_id;
    headers["References"] = recipient.message_id;
  }

  // ---- send ----
  let sentMessageId: string | null = null;
  try {
    sentMessageId = await sendMail({ to: recipient.email, subject, text, html, sender, attachments, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // retry logic (applies to initial + retry kinds; follow-up failures just log and move on)
    if (kind !== "follow_up" && campaign.retry_enabled && recipient.retry_count < campaign.max_retries) {
      const nextRetry = new Date(now.getTime() + 30 * 60 * 1000 * (recipient.retry_count + 1));
      await db
        .from("recipients")
        .update({
          retry_count: recipient.retry_count + 1,
          next_retry_at: nextRetry.toISOString(),
          error: msg,
        })
        .eq("id", recipient.id);
      return NextResponse.json({
        status: "send_failed_will_retry",
        to: recipient.email,
        retry_count: recipient.retry_count + 1,
        next_retry_at: nextRetry.toISOString(),
      }, { status: 200 });
    }
    // no retry — mark failed
    await db
      .from("recipients")
      .update({
        status: kind === "follow_up" ? recipient.status : "failed",
        next_follow_up_at: kind === "follow_up" ? null : recipient.next_follow_up_at,
        error: msg,
      })
      .eq("id", recipient.id);
    return NextResponse.json({ status: "send_failed", to: recipient.email, kind, error: msg }, { status: 200 });
  }

  // ---- success updates ----
  if (kind === "initial" || kind === "retry") {
    const update: Record<string, unknown> = {
      status: "sent",
      sent_at: nowIso,
      last_sent_at: nowIso,
      error: null,
      next_retry_at: null,
    };
    // Capture Message-ID so follow-ups can thread to it
    if (sentMessageId && !recipient.message_id) update.message_id = sentMessageId;
    // schedule first follow-up if enabled
    if (campaign.follow_ups_enabled) {
      const { data: firstStep } = await db
        .from("follow_up_steps")
        .select("delay_days")
        .eq("campaign_id", campaign.id)
        .eq("step_number", 1)
        .maybeSingle();
      if (firstStep) {
        const next = new Date(now.getTime() + firstStep.delay_days * 86400 * 1000);
        update.next_follow_up_at = next.toISOString();
      }
    }
    await db.from("recipients").update(update).eq("id", recipient.id);
  } else if (kind === "follow_up") {
    const nextStepNumber = recipient.follow_up_count + 2; // already sent this one, look for the next
    const { data: nextStep } = await db
      .from("follow_up_steps")
      .select("delay_days")
      .eq("campaign_id", campaign.id)
      .eq("step_number", nextStepNumber)
      .maybeSingle();
    const nextTs = nextStep ? new Date(now.getTime() + nextStep.delay_days * 86400 * 1000).toISOString() : null;
    await db
      .from("recipients")
      .update({
        follow_up_count: recipient.follow_up_count + 1,
        last_sent_at: nowIso,
        next_follow_up_at: nextTs,
        error: null,
      })
      .eq("id", recipient.id);
  }

  await db.from("send_log").insert({
    campaign_id: campaign.id,
    recipient_id: recipient.id,
    kind,
    step_number: kind === "follow_up" ? step.step_number : null,
    sent_at: nowIso,
    day: today,
  });

  return NextResponse.json({
    status: "sent",
    kind,
    to: recipient.email,
    campaign: campaign.name,
    sent_today: (todayCount ?? 0) + 1,
  });
}
