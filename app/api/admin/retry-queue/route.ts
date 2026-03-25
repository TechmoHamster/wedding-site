import { NextResponse } from "next/server";
import { loadSettings, requireAdmin } from "@/lib/wedding";
import {
  getIntegrationRetryQueueSummary,
  listIntegrationRetryQueue,
  processIntegrationRetryQueue,
} from "@/lib/integrationQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!requireAdmin(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || "100") || 100));

  const [summary, items] = await Promise.all([
    getIntegrationRetryQueueSummary(),
    listIntegrationRetryQueue(limit),
  ]);

  return NextResponse.json(
    { ok: true, summary, items },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!requireAdmin(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const force = Boolean(payload && typeof payload === "object" && (payload as { force?: unknown }).force);
  const maxToProcess = Math.max(
    1,
    Math.min(1000, Number(payload && typeof payload === "object" ? (payload as { maxToProcess?: unknown }).maxToProcess : 100) || 100),
  );

  const settings = await loadSettings();
  const processed = await processIntegrationRetryQueue(settings, { maxToProcess, force });
  const [summary, items] = await Promise.all([
    getIntegrationRetryQueueSummary(),
    listIntegrationRetryQueue(100),
  ]);

  return NextResponse.json(
    { ok: true, processed, summary, items },
    { headers: { "Cache-Control": "no-store" } },
  );
}
