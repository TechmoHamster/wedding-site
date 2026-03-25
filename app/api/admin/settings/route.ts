import { NextResponse } from "next/server";
import { loadSettings, requireAdmin, saveSettings } from "@/lib/wedding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!requireAdmin(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await loadSettings();
  return NextResponse.json(settings, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!requireAdmin(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const settings = await saveSettings(payload);
  return NextResponse.json({ ok: true, settings }, { headers: { "Cache-Control": "no-store" } });
}
