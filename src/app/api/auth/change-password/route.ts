import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, verifyAppPassword, setAppPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  current: z.string().min(1, "Current password is required"),
  next: z.string().min(8, "New password must be at least 8 characters"),
});

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s.loggedIn) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
  }
  const { current, next } = parsed.data;

  if (!(await verifyAppPassword(current))) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }
  if (next === current) {
    return NextResponse.json({ error: "New password must be different from the current one." }, { status: 400 });
  }

  try {
    await setAppPassword(next);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to save password." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
