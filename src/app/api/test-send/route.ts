import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { sendMail } from "@/lib/mail";
import { render, toHtml, toPlain } from "@/lib/template";
import { getSession } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { downloadAttachment } from "@/lib/attachment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  template: z.string().min(1),
  sender_id: z.string().uuid().nullable().optional(),
  vars: z.record(z.string()).optional(),
  campaign_id: z.string().uuid().nullable().optional(),
});

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB per file

type Attachment = { filename: string; content: Buffer };

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s.loggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  const isMultipart = contentType.includes("multipart/form-data");

  let raw: Record<string, unknown>;
  const pendingFiles: File[] = [];

  if (isMultipart) {
    const form = await req.formData();
    const varsStr = form.get("vars");
    raw = {
      to: form.get("to"),
      subject: form.get("subject"),
      template: form.get("template"),
      sender_id: form.get("sender_id") || null,
      campaign_id: form.get("campaign_id") || null,
      vars: typeof varsStr === "string" && varsStr ? JSON.parse(varsStr) : undefined,
    };
    for (const entry of form.getAll("file")) {
      if (entry instanceof File && entry.size > 0) pendingFiles.push(entry);
    }
  } else {
    raw = await req.json().catch(() => ({}));
  }

  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const db = supabaseAdmin();

  // resolve sender
  let sender: { email: string; appPassword: string; fromName?: string | null } | null = null;
  if (parsed.data.sender_id) {
    const { data: row } = await db
      .from("senders")
      .select("email, app_password, from_name")
      .eq("id", parsed.data.sender_id)
      .maybeSingle();
    if (row) sender = { email: row.email, appPassword: decryptSecret(row.app_password), fromName: row.from_name };
  }

  // collect attachments: pending files from form + existing from campaign (if given)
  const attachments: Attachment[] = [];

  for (const f of pendingFiles) {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: `"${f.name}" exceeds 20MB limit.` }, { status: 413 });
    }
    const ab = await f.arrayBuffer();
    attachments.push({ filename: f.name, content: Buffer.from(ab) });
    if (attachments.length >= MAX_ATTACHMENTS) break;
  }

  if (parsed.data.campaign_id && attachments.length < MAX_ATTACHMENTS) {
    const { data: camp } = await db
      .from("campaigns")
      .select("attachment_paths, attachment_filenames, attachment_path, attachment_filename")
      .eq("id", parsed.data.campaign_id)
      .maybeSingle();
    if (camp) {
      const paths: string[] = camp.attachment_paths ?? [];
      const names: string[] = camp.attachment_filenames ?? [];
      if (paths.length > 0) {
        const loaded = await Promise.all(
          paths.map((p, i) => downloadAttachment(db, p, names[i] ?? "attachment"))
        );
        for (const a of loaded) {
          if (a && attachments.length < MAX_ATTACHMENTS) attachments.push(a);
        }
      } else if (camp.attachment_path && camp.attachment_filename) {
        const a = await downloadAttachment(db, camp.attachment_path, camp.attachment_filename);
        if (a && attachments.length < MAX_ATTACHMENTS) attachments.push(a);
      }
    }
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
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    return NextResponse.json({ ok: true, messageId, attached: attachments.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
