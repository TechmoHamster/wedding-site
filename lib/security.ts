import { randomUUID } from "node:crypto";

export const CSRF_COOKIE_NAME = "wedding_csrf";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimits = new Map<string, RateLimitEntry>();

function parseCookies(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;

  for (const pair of raw.split(";")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const value = decodeURIComponent(pair.slice(index + 1).trim());
    if (key) out[key] = value;
  }

  return out;
}

export function createCsrfToken(): string {
  return randomUUID();
}

export function readCsrfCookie(headers: Headers): string {
  const cookies = parseCookies(headers.get("cookie") || "");
  return cookies[CSRF_COOKIE_NAME] || "";
}

export function verifyCsrf(headers: Headers): { ok: true } | { ok: false; reason: string } {
  const cookieToken = readCsrfCookie(headers);
  const headerToken = (headers.get("x-csrf-token") || "").trim();

  if (!cookieToken || !headerToken) {
    return { ok: false, reason: "Missing CSRF token." };
  }

  if (cookieToken !== headerToken) {
    return { ok: false, reason: "Invalid CSRF token." };
  }

  return { ok: true };
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  if (first) return first;

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

export function consumeRateLimit(key: string, limit: number, windowMs: number): {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
} {
  const now = Date.now();
  const existing = rateLimits.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, limit - 1), retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  rateLimits.set(key, existing);
  return {
    ok: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

export function isHoneypotFilled(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const source = payload as Record<string, unknown>;
  const trap = source.website;
  return typeof trap === "string" && trap.trim().length > 0;
}


export async function verifyTurnstileToken(token: string, ip = ""): Promise<{ ok: boolean; reason: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY || "";
  if (!secret) {
    return { ok: true, reason: "Turnstile not configured." };
  }

  if (!token || !token.trim()) {
    return { ok: false, reason: "Missing CAPTCHA token." };
  }

  try {
    const params = new URLSearchParams();
    params.set("secret", secret);
    params.set("response", token.trim());
    if (ip && ip !== "unknown") params.set("remoteip", ip);

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, reason: `CAPTCHA verify failed (${response.status}).` };
    }

    const parsed = payload as { success?: unknown; [key: string]: unknown };
    const success = Boolean(parsed && parsed.success);
    if (!success) {
      const errorCodes = parsed["error-codes"];
      const codes = Array.isArray(errorCodes) ? errorCodes.map((item) => String(item)).join(", ") : "invalid-captcha";
      return { ok: false, reason: `CAPTCHA rejected: ${codes}` };
    }

    return { ok: true, reason: "ok" };
  } catch (error) {
    return {
      ok: false,
      reason: `CAPTCHA request error: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}
