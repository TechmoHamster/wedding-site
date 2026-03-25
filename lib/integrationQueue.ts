import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Settings, SubmissionRecord } from "@/lib/types";

type RetryProvider = "googleSheets" | "googleForm";

type RetrySubmission = Pick<SubmissionRecord, "id" | "submittedAt" | "values">;

type RetryItem = {
  id: string;
  provider: RetryProvider;
  submission: RetrySubmission;
  attempts: number;
  createdAt: string;
  nextAttemptAt: string;
  lastError: string;
};

export type RetryQueueViewItem = {
  id: string;
  provider: RetryProvider;
  attempts: number;
  createdAt: string;
  nextAttemptAt: string;
  lastError: string;
  submissionId: string;
  submittedAt: string;
  name: string;
  email: string;
};

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const RETRY_FILE = path.join(DATA_DIR, "integration-retry-queue.json");

const RETRY_MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2 * 60 * 1000;

let retryWriteQueue: Promise<void> = Promise.resolve();

function queueWrite(task: () => Promise<void>): Promise<void> {
  retryWriteQueue = retryWriteQueue.then(task, task);
  return retryWriteQueue;
}

async function ensureRetryFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(RETRY_FILE);
  } catch {
    await fs.writeFile(RETRY_FILE, "[]", "utf8");
  }
}

async function loadRetryQueue(): Promise<RetryItem[]> {
  await ensureRetryFile();
  try {
    const raw = await fs.readFile(RETRY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RetryItem => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return (
        (candidate.provider === "googleSheets" || candidate.provider === "googleForm") &&
        typeof candidate.id === "string" &&
        typeof candidate.attempts === "number" &&
        typeof candidate.createdAt === "string" &&
        typeof candidate.nextAttemptAt === "string" &&
        typeof candidate.lastError === "string" &&
        !!candidate.submission
      );
    });
  } catch {
    return [];
  }
}

async function saveRetryQueue(items: RetryItem[]): Promise<void> {
  await queueWrite(async () => {
    await fs.writeFile(RETRY_FILE, JSON.stringify(items, null, 2), "utf8");
  });
}

function buildSheetsHeaders(settings: Settings): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.integrations.googleSheetsSecret) {
    headers["x-webhook-secret"] = settings.integrations.googleSheetsSecret;
  }
  return headers;
}

async function sendToGoogleSheets(submission: RetrySubmission, settings: Settings): Promise<{ ok: boolean; message: string }> {
  const webhookUrl = settings.integrations.googleSheetsWebhookUrl;
  if (!webhookUrl) return { ok: false, message: "Google Sheets webhook URL is not configured." };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: buildSheetsHeaders(settings),
      body: JSON.stringify({ submittedAt: submission.submittedAt, id: submission.id, values: submission.values }),
    });

    return {
      ok: response.ok,
      message: response.ok ? `Success (${response.status})` : `Failed (${response.status})`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function sendToGoogleForm(submission: RetrySubmission, settings: Settings): Promise<{ ok: boolean; message: string }> {
  const config = settings.integrations;
  if (!config.googleFormEnabled || !config.googleFormActionUrl) {
    return { ok: false, message: "Google Form forwarding is not configured." };
  }

  try {
    const params = new URLSearchParams();
    for (const [fieldId, entryId] of Object.entries(config.googleFormFieldMap || {})) {
      if (!entryId) continue;
      const value = submission.values[fieldId];
      if (value && value.trim()) params.append(entryId, value);
    }

    if (![...params.keys()].length) {
      return { ok: false, message: "Failed: field map is empty or unmatched." };
    }

    const response = await fetch(config.googleFormActionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      redirect: "manual",
    });

    const ok = response.status >= 200 && response.status < 400;
    return {
      ok,
      message: ok ? `Success (${response.status})` : `Failed (${response.status})`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function attemptRetry(item: RetryItem, settings: Settings): Promise<{ ok: boolean; message: string }> {
  if (item.provider === "googleSheets") return sendToGoogleSheets(item.submission, settings);
  return sendToGoogleForm(item.submission, settings);
}

function queueToView(items: RetryItem[], limit = 200): RetryQueueViewItem[] {
  return [...items]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      provider: item.provider,
      attempts: item.attempts,
      createdAt: item.createdAt,
      nextAttemptAt: item.nextAttemptAt,
      lastError: item.lastError,
      submissionId: item.submission.id,
      submittedAt: item.submission.submittedAt,
      name: `${item.submission.values.firstName || ""} ${item.submission.values.lastName || ""}`.trim(),
      email: item.submission.values.email || "",
    }));
}

export async function enqueueFailedIntegrations(
  submission: RetrySubmission,
  integrations: SubmissionRecord["integrations"],
): Promise<void> {
  const queue = await loadRetryQueue();
  const now = new Date().toISOString();

  if (integrations.googleSheets.enabled && integrations.googleSheets.ok === false) {
    queue.push({
      id: randomUUID(),
      provider: "googleSheets",
      submission,
      attempts: 0,
      createdAt: now,
      nextAttemptAt: now,
      lastError: integrations.googleSheets.message,
    });
  }

  if (integrations.googleForm.enabled && integrations.googleForm.ok === false) {
    queue.push({
      id: randomUUID(),
      provider: "googleForm",
      submission,
      attempts: 0,
      createdAt: now,
      nextAttemptAt: now,
      lastError: integrations.googleForm.message,
    });
  }

  await saveRetryQueue(queue);
}

export async function processIntegrationRetryQueue(
  settings: Settings,
  options: number | { maxToProcess?: number; force?: boolean } = 10,
): Promise<{ processed: number; succeeded: number; failed: number; remaining: number }> {
  const queue = await loadRetryQueue();
  const maxToProcess = typeof options === "number" ? options : Math.max(1, options.maxToProcess || 10);
  const force = typeof options === "number" ? false : Boolean(options.force);

  if (queue.length === 0 || maxToProcess <= 0) {
    return { processed: 0, succeeded: 0, failed: 0, remaining: queue.length };
  }

  const now = Date.now();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  const nextQueue: RetryItem[] = [];

  for (const item of queue) {
    const dueAt = new Date(item.nextAttemptAt).getTime();
    const isDue = Number.isFinite(dueAt) ? dueAt <= now : true;

    if ((!isDue && !force) || processed >= maxToProcess) {
      nextQueue.push(item);
      continue;
    }

    processed += 1;
    const result = await attemptRetry(item, settings);

    if (result.ok) {
      succeeded += 1;
      continue;
    }

    failed += 1;
    const attempts = item.attempts + 1;
    if (attempts >= RETRY_MAX_ATTEMPTS) {
      continue;
    }

    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempts - 1));
    nextQueue.push({
      ...item,
      attempts,
      lastError: result.message,
      nextAttemptAt: new Date(Date.now() + delay).toISOString(),
    });
  }

  await saveRetryQueue(nextQueue);
  return {
    processed,
    succeeded,
    failed,
    remaining: nextQueue.length,
  };
}

export async function getIntegrationRetryQueueSummary(): Promise<{
  total: number;
  googleSheets: number;
  googleForm: number;
}> {
  const queue = await loadRetryQueue();
  let googleSheets = 0;
  let googleForm = 0;

  for (const item of queue) {
    if (item.provider === "googleSheets") googleSheets += 1;
    if (item.provider === "googleForm") googleForm += 1;
  }

  return {
    total: queue.length,
    googleSheets,
    googleForm,
  };
}

export async function listIntegrationRetryQueue(limit = 200): Promise<RetryQueueViewItem[]> {
  const queue = await loadRetryQueue();
  return queueToView(queue, limit);
}

export async function checkIntegrationHealth(settings: Settings): Promise<{
  googleSheets: { configured: boolean; reachable: boolean | null; status: string };
  googleForm: { configured: boolean; reachable: boolean | null; status: string };
}> {
  const output = {
    googleSheets: {
      configured: Boolean(settings.integrations.googleSheetsWebhookUrl),
      reachable: null as boolean | null,
      status: "Not configured",
    },
    googleForm: {
      configured: Boolean(settings.integrations.googleFormEnabled && settings.integrations.googleFormActionUrl),
      reachable: null as boolean | null,
      status: "Not configured",
    },
  };

  if (output.googleSheets.configured) {
    try {
      const response = await fetch(settings.integrations.googleSheetsWebhookUrl, { method: "GET" });
      output.googleSheets.reachable = response.ok;
      output.googleSheets.status = `HTTP ${response.status}`;
    } catch (error) {
      output.googleSheets.reachable = false;
      output.googleSheets.status = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  if (output.googleForm.configured) {
    try {
      const response = await fetch(settings.integrations.googleFormActionUrl, { method: "GET", redirect: "manual" });
      output.googleForm.reachable = response.status < 500;
      output.googleForm.status = `HTTP ${response.status}`;
    } catch (error) {
      output.googleForm.reachable = false;
      output.googleForm.status = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  return output;
}
