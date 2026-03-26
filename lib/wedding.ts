import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FormConfig, FormField, Settings, SubmissionRecord } from "@/lib/types";
import { isValidInternationalPhone } from "@/lib/phone";

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const SUBMISSIONS_FILE = path.join(DATA_DIR, "submissions.json");

const DEFAULT_ADMIN_PASSWORD = "change-me-now";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const REQUIRE_ADMIN_PASSWORD_IN_PROD = process.env.NODE_ENV === "production";
const DUPLICATE_WINDOW_MS = (() => {
  const parsed = Number(process.env.DUPLICATE_WINDOW_MS || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000 * 60 * 60 * 6;
})();

const ALLOWED_FIELD_TYPES = new Set(["text", "email", "textarea", "select", "radio", "number", "tel", "checkbox"]);

type SessionInfo = { createdAt: number; expiresAt: number };

const sessions = new Map<string, SessionInfo>();
let settingsCache: Settings | null = null;
let submissionsCache: SubmissionRecord[] | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export const DEFAULT_SETTINGS: Settings = {
  branding: {
    eyebrow: "Wedding Invite Details",
    title: "Share Your Address and RSVP",
    description:
      "Please send your mailing address and RSVP so we can mail invitations and keep our guest list up to date.",
    submitLabel: "Submit RSVP",
    successMessage: "Thanks. Your RSVP and address were saved successfully.",
  },
  fields: [
    { id: "firstName", label: "First Name", type: "text", required: true, width: "half", placeholder: "", autocomplete: "given-name", defaultValue: "" },
    { id: "lastName", label: "Last Name", type: "text", required: true, width: "half", placeholder: "", autocomplete: "family-name", defaultValue: "" },
    { id: "email", label: "Email", type: "email", required: true, width: "full", placeholder: "", autocomplete: "email", defaultValue: "" },
    { id: "phone", label: "Phone Number", type: "tel", required: false, width: "full", placeholder: "", autocomplete: "tel", defaultValue: "" },
    { id: "smsOptIn", label: "Can this number receive text messages?", type: "radio", required: true, width: "full", placeholder: "", autocomplete: "", defaultValue: "", options: ["Yes", "No"] },
    { id: "street1", label: "Street Address", type: "text", required: true, width: "full", placeholder: "", autocomplete: "address-line1", defaultValue: "" },
    { id: "street2", label: "Apartment, Suite, etc. (optional)", type: "text", required: false, width: "full", placeholder: "", autocomplete: "address-line2", defaultValue: "" },
    { id: "city", label: "City", type: "text", required: true, width: "half", placeholder: "", autocomplete: "address-level2", defaultValue: "" },
    { id: "state", label: "State / Province", type: "text", required: true, width: "half", placeholder: "", autocomplete: "address-level1", defaultValue: "" },
    { id: "postalCode", label: "ZIP / Postal Code", type: "text", required: true, width: "half", placeholder: "", autocomplete: "postal-code", defaultValue: "" },
    { id: "country", label: "Country", type: "text", required: true, width: "half", placeholder: "", autocomplete: "country-name", defaultValue: "United States" },
    { id: "rsvp", label: "Will you attend?", type: "radio", required: true, width: "full", placeholder: "", autocomplete: "", defaultValue: "", options: ["Yes", "No", "Maybe"] },
    {
      id: "guests",
      label: "Number of Guests",
      type: "select",
      required: true,
      width: "half",
      placeholder: "",
      autocomplete: "",
      defaultValue: "1",
      options: ["1", "2", "3", "4", "5+"],
      showWhen: { fieldId: "rsvp", values: ["Yes"] },
    },
    { id: "message", label: "Message for the Couple (optional)", type: "textarea", required: false, width: "full", placeholder: "", autocomplete: "", defaultValue: "" },
  ],
  integrations: {
    googleSheetsWebhookUrl: "",
    googleSheetsSecret: "",
    googleFormEnabled: false,
    googleFormActionUrl: "",
    googleFormFieldMap: {},
  },
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeString(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}


function isValidEmail(value: string): boolean {
  // Practical email pattern for RSVP intake.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeId(value: unknown): string {
  return sanitizeString(value, 120)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .replace(/^(\d)/, "f_$1");
}

function normalizeOptions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeString(String(item), 100)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => sanitizeString(item, 100)).filter(Boolean);
  }
  return [];
}

function sanitizeShowWhen(raw: unknown): FormField["showWhen"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const maybeRaw = raw as { fieldId?: unknown; values?: unknown };
  const fieldId = normalizeId(maybeRaw.fieldId);
  const values = normalizeOptions(maybeRaw.values);
  if (!fieldId || values.length === 0) return undefined;
  return { fieldId, values };
}

function sanitizeField(rawField: unknown, index: number, existingIds: Set<string>): FormField | null {
  if (!rawField || typeof rawField !== "object") return null;
  const field = rawField as Record<string, unknown>;
  const fallbackId = `field_${index + 1}`;
  const normalizedLabel = sanitizeString(field.label, 120);
  const id = normalizeId(field.id || normalizedLabel || fallbackId);
  if (!id || existingIds.has(id)) return null;

  const rawType = sanitizeString(field.type, 30);
  const type = (ALLOWED_FIELD_TYPES.has(rawType) ? rawType : "text") as FormField["type"];

  const sanitized: FormField = {
    id,
    label: normalizedLabel || id,
    type,
    required: Boolean(field.required),
    width: field.width === "full" ? "full" : "half",
    placeholder: sanitizeString(field.placeholder, 200),
    autocomplete: sanitizeString(field.autocomplete, 100),
    defaultValue: sanitizeString(field.defaultValue, 300),
  };

  if (type === "select" || type === "radio") {
    const options = normalizeOptions(field.options);
    sanitized.options = options.length > 0 ? options : ["Option 1"];
    if (!sanitized.defaultValue && sanitized.options[0]) {
      sanitized.defaultValue = type === "select" ? sanitized.options[0] : "";
    }
  }

  const showWhen = sanitizeShowWhen(field.showWhen);
  if (showWhen) sanitized.showWhen = showWhen;

  existingIds.add(id);
  return sanitized;
}

export function sanitizeSettings(rawSettings: unknown): Settings {
  const base = deepClone(DEFAULT_SETTINGS);
  if (!rawSettings || typeof rawSettings !== "object") return base;

  const source = rawSettings as Record<string, unknown>;

  if (source.branding && typeof source.branding === "object") {
    const branding = source.branding as Record<string, unknown>;
    // Allow intentionally blank eyebrow text.
    base.branding.eyebrow = sanitizeString(branding.eyebrow, 120);
    base.branding.title = sanitizeString(branding.title, 180) || base.branding.title;
    base.branding.description = sanitizeString(branding.description, 600) || base.branding.description;
    base.branding.submitLabel = sanitizeString(branding.submitLabel, 80) || base.branding.submitLabel;
    base.branding.successMessage = sanitizeString(branding.successMessage, 220) || base.branding.successMessage;
  }

  if (Array.isArray(source.fields)) {
    const existingIds = new Set<string>();
    const fields = source.fields
      .map((field, index) => sanitizeField(field, index, existingIds))
      .filter((field): field is FormField => field !== null);
    if (fields.length > 0) base.fields = fields;
  }

  if (source.integrations && typeof source.integrations === "object") {
    const integrations = source.integrations as Record<string, unknown>;
    base.integrations.googleSheetsWebhookUrl = sanitizeString(integrations.googleSheetsWebhookUrl, 400);
    base.integrations.googleSheetsSecret = sanitizeString(integrations.googleSheetsSecret, 120);
    base.integrations.googleFormEnabled = Boolean(integrations.googleFormEnabled);
    base.integrations.googleFormActionUrl = sanitizeString(integrations.googleFormActionUrl, 400);

    if (integrations.googleFormFieldMap && typeof integrations.googleFormFieldMap === "object" && !Array.isArray(integrations.googleFormFieldMap)) {
      const map: Record<string, string> = {};
      for (const [key, value] of Object.entries(integrations.googleFormFieldMap as Record<string, unknown>)) {
        const fieldId = normalizeId(key);
        const entryId = sanitizeString(value, 120);
        if (fieldId && entryId) map[fieldId] = entryId;
      }
      base.integrations.googleFormFieldMap = map;
    }
  }

  return base;
}

function queueWrite(task: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function ensureDataFiles(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(SETTINGS_FILE);
  } catch {
    await writeJson(SETTINGS_FILE, DEFAULT_SETTINGS);
  }

  try {
    await fs.access(SUBMISSIONS_FILE);
  } catch {
    await writeJson(SUBMISSIONS_FILE, []);
  }
}

export async function loadSettings(force = false): Promise<Settings> {
  await ensureDataFiles();
  const raw = await readJson<Settings>(SETTINGS_FILE, DEFAULT_SETTINGS);
  const sanitized = sanitizeSettings(raw);
  settingsCache = sanitized;

  if (JSON.stringify(raw) !== JSON.stringify(sanitized)) {
    await queueWrite(async () => writeJson(SETTINGS_FILE, sanitized));
  }

  return sanitized;
}

export async function saveSettings(nextSettings: unknown): Promise<Settings> {
  const sanitized = sanitizeSettings(nextSettings);
  settingsCache = sanitized;
  await queueWrite(async () => writeJson(SETTINGS_FILE, sanitized));
  return sanitized;
}

export async function loadSubmissions(force = false): Promise<SubmissionRecord[]> {
  await ensureDataFiles();
  if (!force && submissionsCache) return submissionsCache;
  const raw = await readJson<SubmissionRecord[]>(SUBMISSIONS_FILE, []);
  submissionsCache = Array.isArray(raw) ? raw : [];
  return submissionsCache;
}

export async function appendSubmission(submission: SubmissionRecord): Promise<void> {
  const items = await loadSubmissions();
  items.push(submission);
  submissionsCache = items;
  await queueWrite(async () => writeJson(SUBMISSIONS_FILE, items));
}

export async function upsertSubmission(submission: SubmissionRecord): Promise<void> {
  const items = await loadSubmissions();
  const index = items.findIndex((item) => item.id === submission.id);
  if (index >= 0) {
    items[index] = submission;
  } else {
    items.push(submission);
  }

  submissionsCache = items;
  await queueWrite(async () => writeJson(SUBMISSIONS_FILE, items));
}

export async function clearSubmissions(): Promise<void> {
  await ensureDataFiles();
  submissionsCache = [];
  await queueWrite(async () => writeJson(SUBMISSIONS_FILE, []));
}

export function isVisibleField(field: FormField, values: Record<string, string>): boolean {
  if (!field.showWhen || !field.showWhen.fieldId || !Array.isArray(field.showWhen.values)) {
    return true;
  }
  const controller = values[field.showWhen.fieldId];
  return field.showWhen.values.includes(String(controller || ""));
}

export function normalizeSubmission(input: unknown, settings: Settings): Record<string, string> {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const values: Record<string, string> = {};

  for (const field of settings.fields) {
    const raw = source[field.id];
    if (raw === undefined || raw === null) {
      values[field.id] = "";
      continue;
    }

    const parsed = typeof raw === "string" ? raw.trim() : String(raw);
    if (field.type === "number") {
      if (!parsed) {
        values[field.id] = "";
        continue;
      }
      const num = Number(parsed);
      values[field.id] = Number.isFinite(num) ? String(num) : "";
      continue;
    }

    values[field.id] = parsed;
  }

  return values;
}

export function validateSubmission(values: Record<string, string>, settings: Settings): string[] {
  const errors: string[] = [];

  for (const field of settings.fields) {
    if (!isVisibleField(field, values)) continue;
    const value = values[field.id] || "";

    if (field.required && !value) {
      errors.push(`${field.label} is required.`);
      continue;
    }

    if (
      value &&
      (field.type === "select" || field.type === "radio") &&
      Array.isArray(field.options) &&
      field.options.length > 0 &&
      !field.options.includes(value)
    ) {
      errors.push(`${field.label} must match one of the configured options.`);
      continue;
    }

    if (value && field.type === "email" && !isValidEmail(value)) {
      errors.push(`${field.label} must be a valid email address.`);
      continue;
    }

    if (value && field.type === "tel" && !isValidInternationalPhone(value)) {
      errors.push(`${field.label} must be a valid phone number.`);
    }
  }

  return errors;
}

export function findRecentDuplicateSubmission(
  values: Record<string, string>,
  submissions: SubmissionRecord[],
  windowMs = DUPLICATE_WINDOW_MS,
): Pick<SubmissionRecord, "id" | "submittedAt"> | null {
  const first = (values.firstName || "").trim().toLowerCase();
  const last = (values.lastName || "").trim().toLowerCase();
  const email = (values.email || "").trim().toLowerCase();

  if (!first || !last || !email) return null;

  const now = Date.now();
  for (let i = submissions.length - 1; i >= 0; i -= 1) {
    const item = submissions[i];
    const submittedAt = new Date(item.submittedAt).getTime();
    if (!Number.isFinite(submittedAt)) continue;
    if (now - submittedAt > windowMs) break;

    const itemFirst = (item.values?.firstName || "").trim().toLowerCase();
    const itemLast = (item.values?.lastName || "").trim().toLowerCase();
    const itemEmail = (item.values?.email || "").trim().toLowerCase();

    if (itemFirst === first && itemLast === last && itemEmail === email) {
      return { id: item.id, submittedAt: item.submittedAt };
    }
  }

  return null;
}


export async function checkDuplicateInGoogleSheets(
  values: Record<string, string>,
  settings: Settings,
): Promise<{ checked: boolean; duplicate: boolean; message: string }> {
  const webhookUrl = (settings.integrations.googleSheetsWebhookUrl || "").trim();
  if (!webhookUrl) {
    return { checked: false, duplicate: false, message: "Google Sheets webhook is not configured." };
  }

  const lookup = {
    firstName: (values.firstName || "").trim(),
    lastName: (values.lastName || "").trim(),
    email: (values.email || "").trim().toLowerCase(),
  };

  if (!lookup.firstName || !lookup.lastName || !lookup.email) {
    return { checked: false, duplicate: false, message: "Missing duplicate check fields." };
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.integrations.googleSheetsSecret) {
      headers["x-webhook-secret"] = settings.integrations.googleSheetsSecret;
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "duplicate_check",
        lookup,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        checked: false,
        duplicate: false,
        message: `Duplicate check endpoint failed (${response.status}).`,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      duplicate?: unknown;
      exists?: unknown;
      mode?: unknown;
    };

    const duplicate =
      typeof payload.duplicate === "boolean"
        ? payload.duplicate
        : typeof payload.exists === "boolean"
          ? payload.exists
          : null;

    if (duplicate === null) {
      return {
        checked: false,
        duplicate: false,
        message: "Duplicate check response did not include duplicate/exists boolean.",
      };
    }

    return {
      checked: true,
      duplicate,
      message: duplicate ? "Duplicate found in spreadsheet." : "No duplicate found in spreadsheet.",
    };
  } catch (error) {
    return {
      checked: false,
      duplicate: false,
      message: error instanceof Error ? error.message : "Duplicate check request failed.",
    };
  }
}

function getRangeCutoff(range: string): number | null {
  const now = Date.now();
  switch (range) {
    case "6h":
      return now - 6 * 60 * 60 * 1000;
    case "24h":
    case "1d":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
    case "1w":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "all":
    default:
      return null;
  }
}

export function filterSubmissionsByRange(submissions: SubmissionRecord[], range: string): SubmissionRecord[] {
  const cutoff = getRangeCutoff(range);
  if (!cutoff) return [...submissions];

  return submissions.filter((submission) => {
    const dateValue = new Date(submission.submittedAt).getTime();
    return Number.isFinite(dateValue) && dateValue >= cutoff;
  });
}

function csvEscape(value: unknown): string {
  const stringValue = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(stringValue)) return `"${stringValue.replace(/"/g, '""')}"`;
  return stringValue;
}

export function buildCsv(submissions: SubmissionRecord[], settings: Settings): string {
  const fieldIds = settings.fields.map((field) => field.id);
  const headers = ["id", "submittedAt", ...fieldIds, "googleSheetsStatus", "googleFormStatus", "warnings"];
  const lines = [headers.map(csvEscape).join(",")];

  for (const submission of submissions) {
    const row = [
      submission.id || "",
      submission.submittedAt || "",
      ...fieldIds.map((id) => submission.values?.[id] || ""),
      submission.integrations?.googleSheets?.message || "",
      submission.integrations?.googleForm?.message || "",
      (submission.warnings || []).join(" | "),
    ];
    lines.push(row.map(csvEscape).join(","));
  }

  return lines.join("\n");
}

export async function forwardToIntegrations(
  submission: Pick<SubmissionRecord, "id" | "submittedAt" | "values"> & {
    mode?: "append_submission" | "upsert_submission";
  },
  settings: Settings,
): Promise<SubmissionRecord["integrations"]> {
  const config = settings.integrations;

  const result: SubmissionRecord["integrations"] = {
    googleSheets: {
      enabled: Boolean(config.googleSheetsWebhookUrl),
      ok: null,
      message: config.googleSheetsWebhookUrl ? "Pending" : "Not configured",
    },
    googleForm: {
      enabled: Boolean(config.googleFormEnabled && config.googleFormActionUrl),
      ok: null,
      message: config.googleFormEnabled && config.googleFormActionUrl ? "Pending" : "Not configured",
    },
  };

  if (config.googleSheetsWebhookUrl) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.googleSheetsSecret) headers["x-webhook-secret"] = config.googleSheetsSecret;

      const response = await fetch(config.googleSheetsWebhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: submission.mode || "append_submission",
          submittedAt: submission.submittedAt,
          id: submission.id,
          values: submission.values,
        }),
      });

      result.googleSheets.ok = response.ok;
      result.googleSheets.message = response.ok ? `Success (${response.status})` : `Failed (${response.status})`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      result.googleSheets.ok = false;
      result.googleSheets.message = `Error: ${message}`;
    }
  }

  if (config.googleFormEnabled && config.googleFormActionUrl) {
    try {
      const params = new URLSearchParams();
      for (const [fieldId, entryId] of Object.entries(config.googleFormFieldMap || {})) {
        if (!entryId) continue;
        const value = submission.values[fieldId];
        if (value && value.trim()) params.append(entryId, value);
      }

      if (![...params.keys()].length) {
        result.googleForm.ok = false;
        result.googleForm.message = "Failed: field map is empty or unmatched.";
      } else {
        const response = await fetch(config.googleFormActionUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
          redirect: "manual",
        });

        const ok = response.status >= 200 && response.status < 400;
        result.googleForm.ok = ok;
        result.googleForm.message = ok ? `Success (${response.status})` : `Failed (${response.status})`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      result.googleForm.ok = false;
      result.googleForm.message = `Error: ${message}`;
    }
  }

  return result;
}

export function buildPublicConfig(settings: Settings): FormConfig {
  return {
    branding: settings.branding,
    fields: settings.fields,
  };
}

export function getAdminPasswordStatus(): { ok: boolean; message: string } {
  if (REQUIRE_ADMIN_PASSWORD_IN_PROD && !process.env.ADMIN_PASSWORD) {
    return {
      ok: false,
      message: "ADMIN_PASSWORD is required in production before admin login can be used.",
    };
  }

  return {
    ok: true,
    message:
      ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD
        ? `Set ADMIN_PASSWORD before production use. Current default: ${DEFAULT_ADMIN_PASSWORD}`
        : "",
  };
}

export function createAdminSession(password: string): { token: string; warning: string } | null {
  const status = getAdminPasswordStatus();
  if (!status.ok) return null;
  if (password !== ADMIN_PASSWORD) return null;

  const token = randomUUID();
  sessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });

  return {
    token,
    warning: status.message,
  };
}

function cleanupSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

export function extractAdminToken(headers: Headers): string {
  const direct = headers.get("x-admin-token");
  if (direct?.trim()) return direct.trim();

  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();

  return "";
}

export function requireAdmin(headers: Headers): boolean {
  cleanupSessions();
  const token = extractAdminToken(headers);
  if (!token) return false;

  const session = sessions.get(token);
  if (!session) return false;

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

export function clearAdminSession(headers: Headers): void {
  const token = extractAdminToken(headers);
  if (token) sessions.delete(token);
}
