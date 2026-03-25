import { NextResponse } from "next/server";
import { buildPublicConfig, loadSettings } from "@/lib/wedding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await loadSettings();
  return NextResponse.json(buildPublicConfig(settings), {
    headers: { "Cache-Control": "no-store" },
  });
}
