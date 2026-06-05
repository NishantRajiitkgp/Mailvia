import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin, type MailProvider } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { sendMail } from "@/lib/mail";
import { toHtml, toPlain } from "@/lib/template";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ body: z.string().min(1, "Reply body is empty") });

function reSubject(subject: string | null): string {
  const base = subject?.trim() || "your message";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.loggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
  }

  const { id } = await ctx.params;
  const db = supabaseAdmin();

  const { data: reply, error } = await db
    .from("replies")
    .select(`
      id, from_email, subject,
      recipient:recipients(id, message_id),
      campaign:campaigns(id, sender_id, from_name, subject)
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!reply) return NextResponse.json({ error: "reply_not_found" }, { status: 404 });

  const recipient = Array.isArray(reply.recipient) ? reply.recipient[0] : reply.recipient;
  const campaign = Array.isArray(reply.campaign) ? reply.campaign[0] : reply.campaign;

  // Resolve the sender for this campaign (falls back to env Gmail in sendMail).
  let sender:
    | { email: string; appPassword: string; fromName?: string | null; provider?: MailProvider | null; msTenantId?: string | null; msClientId?: string | null }
    | null = null;
  if (campaign?.sender_id) {
    const { data: row } = await db
      .from("senders")
      .select("email, app_password, from_name, provider, ms_tenant_id, ms_client_id")
      .eq("id", campaign.sender_id)
      .maybeSingle();
    if (row) {
      sender = {
        email: row.email,
        appPassword: decryptSecret(row.app_password),
        fromName: row.from_name,
        provider: row.provider as MailProvider,
        msTenantId: row.ms_tenant_id,
        msClientId: row.ms_client_id,
      };
    }
  }

  // Thread into the original conversation so it lands in the same thread.
  const headers: Record<string, string> = {};
  if (recipient?.message_id) {
    const mid = recipient.message_id.startsWith("<") ? recipient.message_id : `<${recipient.message_id}>`;
    headers["In-Reply-To"] = mid;
    headers["References"] = mid;
  }

  try {
    await sendMail({
      to: reply.from_email,
      subject: reSubject(reply.subject ?? campaign?.subject ?? null),
      text: toPlain(parsed.data.body),
      html: toHtml(parsed.data.body),
      sender,
      headers,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `send_failed: ${msg}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
