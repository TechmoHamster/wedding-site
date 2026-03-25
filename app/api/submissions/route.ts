import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  appendSubmission,
  checkDuplicateInGoogleSheets,
  findRecentDuplicateSubmission,
  forwardToIntegrations,
  loadSettings,
  loadSubmissions,
  normalizeSubmission,
  validateSubmission,
} from "@/lib/wedding";
import { consumeRateLimit, getClientIp, isHoneypotFilled, verifyCsrf, verifyTurnstileToken } from "@/lib/security";
import { enqueueFailedIntegrations, processIntegrationRetryQueue } from "@/lib/integrationQueue";
import type { SubmissionRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_WINDOW = 20;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  const rate = consumeRateLimit(`submit:${ip}`, RATE_LIMIT_PER_WINDOW, RATE_LIMIT_WINDOW_MS);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many submissions. Please wait and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rate.retryAfterSec),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  // Enforce CSRF protection strictly in production.
  const csrf = verifyCsrf(request.headers);
  if (!csrf.ok && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: csrf.reason }, { status: 403 });
  }

  const settings = await loadSettings();
  try {
    await processIntegrationRetryQueue(settings, 2);
  } catch (error) {
    console.error("[submissions] retry queue processing failed:", toErrorMessage(error));
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Quietly reject bot-like honeypot submissions.
  if (isHoneypotFilled(payload)) {
    return NextResponse.json({ ok: true, message: settings.branding.successMessage }, { status: 201 });
  }

  const turnstileToken =
    payload && typeof payload === "object" && typeof (payload as { turnstileToken?: unknown }).turnstileToken === "string"
      ? (payload as { turnstileToken: string }).turnstileToken
      : "";

  const captcha = await verifyTurnstileToken(turnstileToken, ip);
  if (!captcha.ok) {
    return NextResponse.json({ error: captcha.reason }, { status: 400 });
  }

  const values = normalizeSubmission(payload, settings);
  const errors = validateSubmission(values, settings);
  if (errors.length > 0) {
    return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
  }

  let existing: SubmissionRecord[] = [];
  try {
    existing = await loadSubmissions();
  } catch (error) {
    console.error("[submissions] local submissions cache unavailable:", toErrorMessage(error));
  }

  const duplicate = findRecentDuplicateSubmission(values, existing);
  if (duplicate) {
    const sheetCheck = await checkDuplicateInGoogleSheets(values, settings);
    if (sheetCheck.checked && sheetCheck.duplicate) {
      return NextResponse.json(
        {
          error: "A recent submission with the same name and email already exists in the spreadsheet.",
          duplicateId: duplicate.id,
          duplicateSubmittedAt: duplicate.submittedAt,
        },
        { status: 409 },
      );
    }
  }

  const submission: SubmissionRecord = {
    id: randomUUID(),
    submittedAt: new Date().toISOString(),
    values,
    meta: {
      ip,
      userAgent: request.headers.get("user-agent") || "",
    },
    integrations: {
      googleSheets: { enabled: false, ok: null, message: "Not configured" },
      googleForm: { enabled: false, ok: null, message: "Not configured" },
    },
    warnings: [],
  };

  submission.integrations = await forwardToIntegrations(submission, settings);
  if (submission.integrations.googleSheets.enabled && submission.integrations.googleSheets.ok === false) {
    submission.warnings.push(`Google Sheets: ${submission.integrations.googleSheets.message}`);
  }
  if (submission.integrations.googleForm.enabled && submission.integrations.googleForm.ok === false) {
    submission.warnings.push(`Google Form: ${submission.integrations.googleForm.message}`);
  }

  try {
    await enqueueFailedIntegrations(
      { id: submission.id, submittedAt: submission.submittedAt, values: submission.values },
      submission.integrations,
    );
  } catch (error) {
    const message = toErrorMessage(error);
    submission.warnings.push("Retry queue storage unavailable; failed integration retries may not be saved.");
    console.error("[submissions] enqueue retry failed:", message);
  }

  try {
    await appendSubmission(submission);
  } catch (error) {
    const message = toErrorMessage(error);
    submission.warnings.push("Submission archive unavailable; response was forwarded to integrations.");
    console.error("[submissions] append submission failed:", message);
  }

  return NextResponse.json(
    {
      ok: true,
      submissionId: submission.id,
      message: settings.branding.successMessage,
      integrationWarnings: submission.warnings,
    },
    {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
