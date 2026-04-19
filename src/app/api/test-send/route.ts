import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { sendMail } from "@/lib/mail";
import { render, toHtml, toPlain } from "@/lib/template";
import { getSession } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  template: z.string().min(1),
  sender_id: z.string().uuid().nullable().optional(),
  vars: z.record(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s.loggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const db = supabaseAdmin();
  let sender: { email: string; appPassword: string; fromName?: string | null } | null = null;
  if (parsed.data.sender_id) {
    const { data: row } = await db
      .from("senders")
      .select("email, app_password, from_name")
      .eq("id", parsed.data.sender_id)
      .maybeSingle();
    if (row) sender = { email: row.email, appPassword: decryptSecret(row.app_password), fromName: row.from_name };
  }

  const vars = parsed.data.vars ?? { Name: "Test", Company: "Your Company" };
  const subject = `[TEST] ${render(parsed.data.subject, vars)}`;
  const rendered = render(parsed.data.template, vars);
  const html = toHtml(rendered);
  const text = toPlain(rendered);

  try {
    const messageId = await sendMail({
      to: parsed.data.to,
      subject,
      text,
      html,
      sender,
    });
    return NextResponse.json({ ok: true, messageId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
