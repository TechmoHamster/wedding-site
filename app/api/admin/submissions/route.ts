import { NextResponse } from "next/server";
import { clearSubmissions, filterSubmissionsByRange, loadSubmissions, requireAdmin } from "@/lib/wedding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!requireAdmin(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "all";

  const submissions = await loadSubmissions();
  const filtered = filterSubmissionsByRange(submissions, range).sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );

  return NextResponse.json(
    {
      range,
      count: filtered.length,
      items: filtered,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: Request) {
  if (!requireAdmin(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await clearSubmissions();

  return NextResponse.json(
    {
      ok: true,
      count: 0,
      message: "Submission log cleared.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
