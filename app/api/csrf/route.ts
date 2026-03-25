import { NextResponse } from "next/server";
import { createCsrfToken, CSRF_COOKIE_NAME } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = createCsrfToken();
  const response = NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });

  response.cookies.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });

  return response;
}
