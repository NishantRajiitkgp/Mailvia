import { NextRequest, NextResponse } from "next/server";
import { checkPassword, getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !checkPassword(password)) {
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }
  const s = await getSession();
  s.loggedIn = true;
  await s.save();
  return NextResponse.json({ ok: true });
}
