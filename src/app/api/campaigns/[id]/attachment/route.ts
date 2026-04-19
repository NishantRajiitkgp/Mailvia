import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB — Gmail accepts up to 25MB with headers overhead.

async function auth() {
  const s = await getSession();
  return s.loggedIn === true;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await auth())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (${(file.size / 1_000_000).toFixed(1)}MB). Max 20MB.` }, { status: 400 });
  }

  const db = supabaseAdmin();
  const path = `${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await db.storage
    .from("attachments")
    .upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // if there was a previous attachment, delete it
  const { data: existing } = await db.from("campaigns").select("attachment_path").eq("id", id).maybeSingle();
  if (existing?.attachment_path && existing.attachment_path !== path) {
    await db.storage.from("attachments").remove([existing.attachment_path]);
  }

  const { data, error } = await db
    .from("campaigns")
    .update({ attachment_path: path, attachment_filename: file.name })
    .eq("id", id)
    .select("attachment_path, attachment_filename")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ attachment: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await auth())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = supabaseAdmin();
  const { data: existing } = await db.from("campaigns").select("attachment_path").eq("id", id).maybeSingle();
  if (existing?.attachment_path) {
    await db.storage.from("attachments").remove([existing.attachment_path]);
  }
  await db.from("campaigns").update({ attachment_path: null, attachment_filename: null }).eq("id", id);
  return NextResponse.json({ ok: true });
}
