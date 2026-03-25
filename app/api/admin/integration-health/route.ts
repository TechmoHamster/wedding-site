import { NextResponse } from "next/server";
import { loadSettings, requireAdmin } from "@/lib/wedding";
import {
  checkIntegrationHealth,
  getIntegrationRetryQueueSummary,
  processIntegrationRetryQueue,
} from "@/lib/integrationQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!requireAdmin(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await loadSettings();
  const [retrySummaryBefore, processed, health] = await Promise.all([
    getIntegrationRetryQueueSummary(),
    processIntegrationRetryQueue(settings, 10),
    checkIntegrationHealth(settings),
  ]);
  const retrySummaryAfter = await getIntegrationRetryQueueSummary();

  return NextResponse.json(
    {
      ok: true,
      health,
      retries: {
        before: retrySummaryBefore,
        after: retrySummaryAfter,
        processed,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
