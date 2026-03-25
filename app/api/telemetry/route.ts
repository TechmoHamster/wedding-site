import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/security";
import { recordTelemetry } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event =
    payload && typeof payload === "object" && typeof (payload as { event?: unknown }).event === "string"
      ? (payload as { event: string }).event.slice(0, 120)
      : "unknown_event";

  const rawMeta = payload && typeof payload === "object" ? (payload as { payload?: unknown }).payload : undefined;
  const metaPayload = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
    ? (rawMeta as Record<string, unknown>)
    : {};

  try {
    await recordTelemetry({
      timestamp: new Date().toISOString(),
      event,
      payload: metaPayload,
      meta: {
        ip: getClientIp(request.headers),
        userAgent: request.headers.get("user-agent") || "",
      },
    });
  } catch (error) {
    // Telemetry must never block user requests in serverless environments.
    console.error("[telemetry] write failed:", error instanceof Error ? error.message : "Unknown error");
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
