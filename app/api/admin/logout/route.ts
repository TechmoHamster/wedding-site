import { NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/wedding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  clearAdminSession(request.headers);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
