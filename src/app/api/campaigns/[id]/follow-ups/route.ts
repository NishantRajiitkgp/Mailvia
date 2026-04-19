import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StepSchema = z.object({
  step_number: z.number().int().min(1).max(10),
  delay_days: z.number().min(0.5).max(60),
  subject: z.string().max(500).nullable().optional(),
  template: z.string().min(1),
});

const ReplaceSchema = z.object({
  steps: z.array(StepSchema).max(10),
});

async function auth() {
  const s = await getSession();
  return s.loggedIn === true;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await auth())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("follow_up_steps")
    .select("*")
    .eq("campaign_id", id)
    .order("step_number", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ steps: data ?? [] });
}

// Replace all steps for the campaign (simpler than per-step CRUD)
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await auth())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = ReplaceSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const db = supabaseAdmin();
  await db.from("follow_up_steps").delete().eq("campaign_id", id);
  if (parsed.data.steps.length === 0) return NextResponse.json({ steps: [] });
  const rows = parsed.data.steps.map((s) => ({ ...s, campaign_id: id, subject: s.subject ?? null }));
  const { data, error } = await db.from("follow_up_steps").insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ steps: data ?? [] });
}
