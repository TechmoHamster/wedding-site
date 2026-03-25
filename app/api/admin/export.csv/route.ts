import { NextResponse } from "next/server";
import { buildCsv, filterSubmissionsByRange, loadSettings, loadSubmissions, requireAdmin } from "@/lib/wedding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!requireAdmin(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "all";

  const [settings, submissions] = await Promise.all([loadSettings(), loadSubmissions()]);
  const filtered = filterSubmissionsByRange(submissions, range).sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );

  const csv = buildCsv(filtered, settings);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="wedding-submissions-${range}.csv"`,
    },
  });
}
