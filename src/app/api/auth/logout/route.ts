import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const s = await getSession();
  s.destroy();
  return NextResponse.json({ ok: true });
}
