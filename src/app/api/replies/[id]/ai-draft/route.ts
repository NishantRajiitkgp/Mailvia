import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { aiConfigured, chat } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.loggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Set AI_API_KEY (and optionally AI_BASE_URL / AI_MODEL) in your environment." },
      { status: 400 }
    );
  }

  const { id } = await ctx.params;
  const db = supabaseAdmin();

  const { data: reply, error } = await db
    .from("replies")
    .select(`
      id, from_email, subject, body_text, snippet,
      recipient:recipients(id, name, company, email),
      campaign:campaigns(id, name, subject, template, from_name)
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!reply) return NextResponse.json({ error: "reply_not_found" }, { status: 404 });

  // supabase types these joins as arrays; normalize to single objects.
  const recipient = Array.isArray(reply.recipient) ? reply.recipient[0] : reply.recipient;
  const campaign = Array.isArray(reply.campaign) ? reply.campaign[0] : reply.campaign;

  const theirReply = (reply.body_text || reply.snippet || "").slice(0, 4000);
  const senderName = campaign?.from_name || "me";
  const recipientName = recipient?.name || reply.from_email;

  // Optional steering from the request body (tone / extra instructions).
  let instructions = "";
  try {
    const body = (await req.json().catch(() => ({}))) as { instructions?: string };
    if (typeof body.instructions === "string") instructions = body.instructions.trim().slice(0, 1000);
  } catch {
    // no body
  }

  const system = [
    "You write concise, professional replies to inbound emails on behalf of a salesperson doing cold outreach.",
    "Write only the email body — no subject line, no 'Subject:' prefix, no quoted original text, no signature block beyond a simple sign-off.",
    "Match a warm, human, succinct tone. Keep it short (usually 2-5 sentences). Do not invent facts, prices, or commitments.",
    "If the person is not interested or asks to stop, reply politely and respectfully without pushing.",
    `Sign off as ${senderName}.`,
  ].join(" ");

  const user = [
    `You sent this outreach (campaign "${campaign?.name ?? "outreach"}", subject "${campaign?.subject ?? ""}"):`,
    "---",
    (campaign?.template ?? "").slice(0, 2000),
    "---",
    `${recipientName}${recipient?.company ? ` from ${recipient.company}` : ""} replied:`,
    "---",
    theirReply || "(no readable body — reply briefly and ask how you can help)",
    "---",
    instructions ? `Extra instructions for your reply: ${instructions}` : "",
    "Write the reply body now.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const draft = await chat({ system, user, temperature: 0.5, maxTokens: 600 });
    return NextResponse.json({ draft });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
