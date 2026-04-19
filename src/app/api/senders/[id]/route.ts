import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  from_name: z.string().max(200).optional().nullable(),
  is_default: z.boolean().optional(),
});

async function auth() {
  const s = await getSession();
  return s.loggedIn === true;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await auth())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });

  const db = supabaseAdmin();
  if (parsed.data.is_default) {
    await db.from("senders").update({ is_default: false }).eq("is_default", true);
  }
  const { data, error } = await db
    .from("senders")
    .update(parsed.data)
    .eq("id", id)
    .select("id, label, email, from_name, is_default, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sender: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await auth())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = supabaseAdmin();
  const { error } = await db.from("senders").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
