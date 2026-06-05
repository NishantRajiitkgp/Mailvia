import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyCredentials } from "@/lib/mail";
import { getSession } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CreateSchema = z
  .object({
    label: z.string().min(1, "Label is required").max(100),
    email: z.string().email("Invalid email").transform((v) => v.toLowerCase()),
    provider: z.enum(["gmail", "outlook", "microsoft_graph"]).default("gmail"),
    // For gmail/outlook this is the app password; for microsoft_graph it's the OAuth client secret.
    app_password: z.string().transform((v) => v.trim()),
    ms_tenant_id: z.string().trim().optional().nullable(),
    ms_client_id: z.string().trim().optional().nullable(),
    from_name: z.string().max(200).optional().nullable(),
    is_default: z.boolean().optional(),
    warmup_enabled: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.provider === "microsoft_graph") {
      if (!data.ms_tenant_id || !GUID_RE.test(data.ms_tenant_id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ms_tenant_id"], message: "Directory (tenant) ID must be a GUID from the Entra app registration." });
      }
      if (!data.ms_client_id || !GUID_RE.test(data.ms_client_id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ms_client_id"], message: "Application (client) ID must be a GUID from the Entra app registration." });
      }
      if (data.app_password.length < 8) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["app_password"], message: "Client secret looks too short — paste the secret Value (not the Secret ID) from Certificates & secrets." });
      }
      return;
    }

    const pw = data.app_password.replace(/\s+/g, "");
    if (data.provider === "gmail") {
      // Google app passwords are exactly 16 letters.
      if (pw.length !== 16 || !/^[a-z]+$/i.test(pw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["app_password"],
          message:
            "Gmail app password must be exactly 16 letters (no digits/symbols) — not your login password. Generate one at myaccount.google.com/apppasswords.",
        });
      }
    } else {
      // Outlook/Microsoft app passwords vary in format; just sanity-check length.
      if (pw.length < 12) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["app_password"],
          message:
            "Outlook app password looks too short. Create one under your Microsoft account security settings (2-step verification must be on) — not your normal login password.",
        });
      }
    }
  });

async function auth() {
  const s = await getSession();
  return s.loggedIn === true;
}

export async function GET() {
  if (!(await auth())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("senders")
    .select("id, label, email, from_name, is_default, warmup_enabled, warmup_started_at, provider, ms_tenant_id, ms_client_id, created_at")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ senders: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await auth())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { label, email, provider, app_password, ms_tenant_id, ms_client_id, from_name, is_default, warmup_enabled } = parsed.data;

  // For Graph the secret can contain symbols, so don't strip inner spaces.
  const isGraph = provider === "microsoft_graph";
  const secret = isGraph ? app_password : app_password.replace(/\s+/g, "");

  // verify creds before saving: SMTP login (gmail/outlook) or OAuth token (graph)
  const v = await verifyCredentials({
    email,
    appPassword: secret,
    provider,
    msTenantId: ms_tenant_id ?? null,
    msClientId: ms_client_id ?? null,
  });
  if (!v.ok) {
    const prefix = isGraph ? "oauth_verify_failed" : "smtp_verify_failed";
    return NextResponse.json({ error: `${prefix}: ${v.error}` }, { status: 400 });
  }

  const db = supabaseAdmin();
  if (is_default) {
    await db.from("senders").update({ is_default: false }).eq("is_default", true);
  }
  const { data, error } = await db
    .from("senders")
    .insert({
      label,
      email,
      provider,
      app_password: encryptSecret(secret),
      ms_tenant_id: isGraph ? ms_tenant_id : null,
      ms_client_id: isGraph ? ms_client_id : null,
      from_name: from_name ?? null,
      is_default: !!is_default,
      warmup_enabled: !!warmup_enabled,
      warmup_started_at: warmup_enabled ? new Date().toISOString() : null,
    })
    .select("id, label, email, from_name, is_default, warmup_enabled, warmup_started_at, provider, ms_tenant_id, ms_client_id, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sender: data });
}
