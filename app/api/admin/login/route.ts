import { NextResponse } from "next/server";
import { createAdminSession, getAdminPasswordStatus } from "@/lib/wedding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const password =
    payload && typeof payload === "object" && "password" in payload && typeof (payload as { password?: unknown }).password === "string"
      ? (payload as { password: string }).password
      : "";

  const passwordStatus = getAdminPasswordStatus();
  if (!passwordStatus.ok) {
    return NextResponse.json({ error: passwordStatus.message }, { status: 503 });
  }

  const session = createAdminSession(password);
  if (!session) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  return NextResponse.json(
    {
      token: session.token,
      warning: session.warning,
      expiresInHours: 12,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
