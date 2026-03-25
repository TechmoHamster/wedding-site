"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { FormField, Settings, SubmissionRecord } from "@/lib/types";

const TOKEN_STORAGE_KEY = "wedding_admin_token";

type TabName = "builder" | "integrations" | "submissions";

type RetryQueueItem = {
  id: string;
  provider: "googleSheets" | "googleForm";
  attempts: number;
  createdAt: string;
  nextAttemptAt: string;
  lastError: string;
  submissionId: string;
  submittedAt: string;
  name: string;
  email: string;
};

function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function toCommaList(values?: string[]): string {
  return Array.isArray(values) ? values.join(", ") : "";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [loginStatus, setLoginStatus] = useState<{ type: "" | "error" | "success"; message: string }>({
    type: "",
    message: "",
  });

  const [activeTab, setActiveTab] = useState<TabName>("builder");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [mapText, setMapText] = useState("{}");

  const [builderStatus, setBuilderStatus] = useState<{ type: "" | "error" | "success"; message: string }>({
    type: "",
    message: "",
  });
  const [integrationStatus, setIntegrationStatus] = useState<{ type: "" | "error" | "success"; message: string }>({
    type: "",
    message: "",
  });
  const [integrationHealthStatus, setIntegrationHealthStatus] = useState<{ type: "" | "error" | "success"; message: string }>({
    type: "",
    message: "",
  });
  const [retryQueueStatus, setRetryQueueStatus] = useState<{ type: "" | "error" | "success"; message: string }>({
    type: "",
    message: "",
  });
  const [retryQueueSummary, setRetryQueueSummary] = useState({ total: 0, googleSheets: 0, googleForm: 0 });
  const [retryQueueItems, setRetryQueueItems] = useState<RetryQueueItem[]>([]);
  const [submissionStatus, setSubmissionStatus] = useState<{ type: "" | "error" | "success"; message: string }>({
    type: "",
    message: "",
  });

  const [range, setRange] = useState("all");
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [submissionsCount, setSubmissionsCount] = useState(0);

  const fields = draft?.fields || [];

  const apiRequest = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    if (token) {
      headers.set("x-admin-token", token);
    }
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    return response;
  };

  const loadSettings = async () => {
    const response = await apiRequest("/api/admin/settings");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load settings.");
    }

    const settings = payload as Settings;
    setDraft(settings);
    setMapText(JSON.stringify(settings.integrations.googleFormFieldMap || {}, null, 2));
  };


  const loadRetryQueue = async () => {
    const response = await apiRequest("/api/admin/retry-queue?limit=100");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load retry queue.");
    }

    setRetryQueueSummary(payload.summary || { total: 0, googleSheets: 0, googleForm: 0 });
    setRetryQueueItems(Array.isArray(payload.items) ? payload.items : []);
  };

  const processRetryQueueNow = async () => {
    setRetryQueueStatus({ type: "", message: "" });
    try {
      const response = await apiRequest("/api/admin/retry-queue", {
        method: "POST",
        body: JSON.stringify({ force: true, maxToProcess: 200 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Retry queue processing failed.");
      }

      setRetryQueueSummary(payload.summary || { total: 0, googleSheets: 0, googleForm: 0 });
      setRetryQueueItems(Array.isArray(payload.items) ? payload.items : []);
      const processed = payload.processed?.processed || 0;
      const succeeded = payload.processed?.succeeded || 0;
      const failed = payload.processed?.failed || 0;
      setRetryQueueStatus({
        type: "success",
        message: `Processed ${processed} queued item(s): ${succeeded} succeeded, ${failed} failed.`,
      });
    } catch (error) {
      setRetryQueueStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Retry queue processing failed.",
      });
    }
  };
  const loadSubmissions = async (targetRange = range) => {
    const response = await apiRequest(`/api/admin/submissions?range=${encodeURIComponent(targetRange)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load submissions.");
    }

    setSubmissions(payload.items || []);
    setSubmissionsCount(payload.count || 0);
  };

  useEffect(() => {
    const bootstrap = async () => {
      const savedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
      if (!savedToken) {
        setAuthReady(true);
        return;
      }

      setToken(savedToken);
      try {
        const response = await fetch("/api/admin/session", {
          headers: { "x-admin-token": savedToken },
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Session expired.");
        }

        setIsAuthed(true);
      } catch {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken("");
        setIsAuthed(false);
      } finally {
        setAuthReady(true);
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    loadSettings().catch((error) => {
      setBuilderStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to load settings." });
    });
    loadSubmissions().catch((error) => {
      setSubmissionStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to load submissions." });
    });
    loadRetryQueue().catch((error) => {
      setRetryQueueStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to load retry queue." });
    });
  }, [isAuthed]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginStatus({ type: "", message: "" });

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Login failed.");
      }

      const nextToken = payload.token as string;
      window.localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
      setToken(nextToken);
      setIsAuthed(true);
      setPassword("");

      if (payload.warning) {
        setBuilderStatus({ type: "error", message: payload.warning as string });
      }
    } catch (error) {
      setLoginStatus({ type: "error", message: error instanceof Error ? error.message : "Login failed." });
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest("/api/admin/logout", { method: "POST" });
    } catch {
      // ignore
    }

    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken("");
    setIsAuthed(false);
    setDraft(null);
    setSubmissions([]);
    setSubmissionsCount(0);
  };

  const updateBranding = (key: keyof Settings["branding"], value: string) => {
    setDraft((prev) => (prev ? { ...prev, branding: { ...prev.branding, [key]: value } } : prev));
  };

  const updateIntegration = (key: keyof Settings["integrations"], value: string | boolean) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            integrations: {
              ...prev.integrations,
              [key]: value,
            },
          }
        : prev,
    );
  };

  const updateField = (index: number, patch: Partial<FormField>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextFields = [...prev.fields];
      nextFields[index] = { ...nextFields[index], ...patch };
      return { ...prev, fields: nextFields };
    });
  };

  const moveField = (index: number, direction: "up" | "down") => {
    setDraft((prev) => {
      if (!prev) return prev;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.fields.length) return prev;
      const nextFields = [...prev.fields];
      [nextFields[index], nextFields[targetIndex]] = [nextFields[targetIndex], nextFields[index]];
      return { ...prev, fields: nextFields };
    });
  };

  const removeField = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextFields = prev.fields.filter((_, i) => i !== index);
      return { ...prev, fields: nextFields };
    });
  };

  const addField = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: [
          ...prev.fields,
          {
            id: "newField",
            label: "New Field",
            type: "text",
            required: false,
            width: "half",
            placeholder: "",
            autocomplete: "",
            defaultValue: "",
          },
        ],
      };
    });
  };

  const saveSettings = async (target: "builder" | "integrations") => {
    if (!draft) return;

    let parsedMap: Record<string, string> = {};
    try {
      parsedMap = mapText.trim() ? (JSON.parse(mapText) as Record<string, string>) : {};
    } catch {
      const message = "Google Form map must be valid JSON.";
      if (target === "builder") setBuilderStatus({ type: "error", message });
      if (target === "integrations") setIntegrationStatus({ type: "error", message });
      return;
    }

    const payload: Settings = {
      ...draft,
      integrations: {
        ...draft.integrations,
        googleFormFieldMap: parsedMap,
      },
    };

    const response = await apiRequest("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = result.error || "Could not save settings.";
      if (target === "builder") setBuilderStatus({ type: "error", message });
      if (target === "integrations") setIntegrationStatus({ type: "error", message });
      return;
    }

    const saved = result.settings as Settings;
    setDraft(saved);
    setMapText(JSON.stringify(saved.integrations.googleFormFieldMap || {}, null, 2));

    if (target === "builder") setBuilderStatus({ type: "success", message: "Settings saved." });
    if (target === "integrations") setIntegrationStatus({ type: "success", message: "Settings saved." });
  };


  const runIntegrationHealthCheck = async () => {
    setIntegrationHealthStatus({ type: "", message: "" });
    try {
      const response = await apiRequest("/api/admin/integration-health", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Integration health check failed.");
      }

      const sheets = payload.health?.googleSheets;
      const form = payload.health?.googleForm;
      const queueAfter = payload.retries?.after?.total ?? "?";
      const processed = payload.retries?.processed?.processed ?? 0;
      const retriedSuccess = payload.retries?.processed?.succeeded ?? 0;

      const message = [
        `Sheets: ${sheets?.status || "n/a"}`,
        `Form: ${form?.status || "n/a"}`,
        `Queue: ${queueAfter} pending`,
        `Retried now: ${processed} (${retriedSuccess} succeeded)`,
      ].join(" | ");

      setIntegrationHealthStatus({ type: "success", message });
    } catch (error) {
      setIntegrationHealthStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Integration health check failed.",
      });
    }
  };
  const exportCsv = async () => {
    setSubmissionStatus({ type: "", message: "" });
    try {
      const response = await apiRequest(`/api/admin/export.csv?range=${encodeURIComponent(range)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Export failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `wedding-submissions-${range}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSubmissionStatus({ type: "success", message: "CSV exported." });
    } catch (error) {
      setSubmissionStatus({ type: "error", message: error instanceof Error ? error.message : "Export failed." });
    }
  };

  const clearSubmissionLog = async () => {
    const confirmed = window.confirm("Clear all saved submission log entries? This cannot be undone.");
    if (!confirmed) return;

    setSubmissionStatus({ type: "", message: "" });
    try {
      const response = await apiRequest("/api/admin/submissions", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to clear submission log.");
      }

      setSubmissions([]);
      setSubmissionsCount(0);
      setSubmissionStatus({ type: "success", message: payload.message || "Submission log cleared." });
    } catch (error) {
      setSubmissionStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to clear submission log.",
      });
    }
  };

  const headers = useMemo(() => {
    return ["Submitted At", ...fields.map((field) => field.label), "Warnings"];
  }, [fields]);

  if (!authReady) {
    return <main className="admin-page"><p className="admin-loading">Checking session...</p></main>;
  }

  if (!isAuthed) {
    return (
      <main className="admin-page">
        <section className="admin-login-card">
          <h1>Admin Login</h1>
          <form onSubmit={handleLogin}>
            <label>
              Admin Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            <button type="submit">Sign In</button>
            <p className={`admin-status ${loginStatus.type}`}>{loginStatus.message}</p>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <section className="admin-shell">
        <header className="admin-topbar">
          <h1>Wedding Admin Dashboard</h1>
          <div className="admin-top-actions">
            <a href="/" target="_blank" rel="noreferrer">Open Public Form</a>
            <button type="button" onClick={handleLogout}>Logout</button>
          </div>
        </header>

        <nav className="admin-tabs">
          <button className={activeTab === "builder" ? "active" : ""} onClick={() => setActiveTab("builder")}>Form Builder</button>
          <button className={activeTab === "integrations" ? "active" : ""} onClick={() => setActiveTab("integrations")}>Integrations</button>
          <button className={activeTab === "submissions" ? "active" : ""} onClick={() => setActiveTab("submissions")}>Submissions</button>
        </nav>

        {activeTab === "builder" && draft && (
          <section className="admin-panel">
            <h2>Public Form Content</h2>
            <div className="admin-grid-two">
              <label>
                Eyebrow
                <input value={draft.branding.eyebrow} onChange={(e) => updateBranding("eyebrow", e.target.value)} />
              </label>
              <label>
                Submit Button Label
                <input value={draft.branding.submitLabel} onChange={(e) => updateBranding("submitLabel", e.target.value)} />
              </label>
              <label className="full">
                Title
                <input value={draft.branding.title} onChange={(e) => updateBranding("title", e.target.value)} />
              </label>
              <label className="full">
                Description
                <textarea rows={3} value={draft.branding.description} onChange={(e) => updateBranding("description", e.target.value)} />
              </label>
              <label className="full">
                Success Message
                <textarea rows={2} value={draft.branding.successMessage} onChange={(e) => updateBranding("successMessage", e.target.value)} />
              </label>
            </div>

            <div className="admin-section-row">
              <h3>Fields</h3>
              <button type="button" onClick={addField}>Add Field</button>
            </div>

            <div className="admin-fields-list">
              {draft.fields.map((field, index) => (
                <article className="admin-field-card" key={`${field.id}-${index}`}>
                  <div className="admin-field-top">
                    <strong>Field {index + 1}</strong>
                    <div className="admin-field-actions">
                      <button type="button" onClick={() => moveField(index, "up")}>Up</button>
                      <button type="button" onClick={() => moveField(index, "down")}>Down</button>
                      <button type="button" onClick={() => removeField(index)}>Remove</button>
                    </div>
                  </div>

                  <div className="admin-grid-two">
                    <label>
                      Label
                      <input value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} />
                    </label>
                    <label>
                      Field ID
                      <input value={field.id} onChange={(e) => updateField(index, { id: e.target.value })} />
                    </label>
                    <label>
                      Type
                      <select value={field.type} onChange={(e) => updateField(index, { type: e.target.value as FormField["type"] })}>
                        <option value="text">Text</option>
                        <option value="email">Email</option>
                        <option value="tel">Phone</option>
                        <option value="number">Number</option>
                        <option value="textarea">Textarea</option>
                        <option value="select">Select</option>
                        <option value="radio">Radio</option>
                        <option value="checkbox">Checkbox</option>
                      </select>
                    </label>
                    <label>
                      Width
                      <select value={field.width} onChange={(e) => updateField(index, { width: e.target.value as "half" | "full" })}>
                        <option value="half">Half</option>
                        <option value="full">Full</option>
                      </select>
                    </label>
                    <label>
                      Default Value
                      <input value={field.defaultValue} onChange={(e) => updateField(index, { defaultValue: e.target.value })} />
                    </label>
                    <label>
                      Autocomplete
                      <input value={field.autocomplete} onChange={(e) => updateField(index, { autocomplete: e.target.value })} />
                    </label>
                    <label className="full">
                      Placeholder
                      <input value={field.placeholder} onChange={(e) => updateField(index, { placeholder: e.target.value })} />
                    </label>
                    <label>
                      Show When Field ID
                      <input
                        value={field.showWhen?.fieldId || ""}
                        onChange={(e) =>
                          updateField(index, {
                            showWhen: {
                              fieldId: e.target.value,
                              values: field.showWhen?.values || [],
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      Show When Values (comma)
                      <input
                        value={toCommaList(field.showWhen?.values)}
                        onChange={(e) =>
                          updateField(index, {
                            showWhen: {
                              fieldId: field.showWhen?.fieldId || "",
                              values: parseCommaList(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label className="full">
                      Options (comma for select/radio)
                      <input
                        value={toCommaList(field.options)}
                        onChange={(e) => updateField(index, { options: parseCommaList(e.target.value) })}
                      />
                    </label>
                    <label className="admin-checkbox">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(index, { required: e.target.checked })}
                      />
                      Required
                    </label>
                  </div>
                </article>
              ))}
            </div>

            <div className="admin-actions">
              <button type="button" onClick={() => saveSettings("builder")}>Save Form Settings</button>
            </div>
            <p className={`admin-status ${builderStatus.type}`}>{builderStatus.message}</p>
          </section>
        )}

        {activeTab === "integrations" && draft && (
          <section className="admin-panel">
            <h2>Google Integrations</h2>
            <div className="admin-grid-two">
              <label className="full">
                Google Sheets Webhook URL
                <input
                  value={draft.integrations.googleSheetsWebhookUrl}
                  onChange={(e) => updateIntegration("googleSheetsWebhookUrl", e.target.value)}
                />
              </label>
              <label className="full">
                Optional Webhook Secret
                <input
                  value={draft.integrations.googleSheetsSecret}
                  onChange={(e) => updateIntegration("googleSheetsSecret", e.target.value)}
                />
              </label>
              <label className="admin-checkbox full">
                <input
                  type="checkbox"
                  checked={draft.integrations.googleFormEnabled}
                  onChange={(e) => updateIntegration("googleFormEnabled", e.target.checked)}
                />
                Enable Google Form Forwarding
              </label>
              <label className="full">
                Google Form Action URL (`formResponse`)
                <input
                  value={draft.integrations.googleFormActionUrl}
                  onChange={(e) => updateIntegration("googleFormActionUrl", e.target.value)}
                />
              </label>
              <label className="full">
                Google Form Field Map JSON
                <textarea rows={8} value={mapText} onChange={(e) => setMapText(e.target.value)} spellCheck={false} />
              </label>
            </div>
            <div className="admin-actions">
              <button type="button" onClick={() => saveSettings("integrations")}>Save Integration Settings</button>
              <button type="button" onClick={runIntegrationHealthCheck}>Test Integrations + Retry Queue</button>
            </div>
            <p className={`admin-status ${integrationStatus.type}`}>{integrationStatus.message}</p>
            <p className={`admin-status ${integrationHealthStatus.type}`}>{integrationHealthStatus.message}</p>
          </section>
        )}

        {activeTab === "submissions" && (
          <section className="admin-panel">
            <h2>Submission Viewer</h2>
            <div className="admin-toolbar">
              <label>
                Time Range
                <select value={range} onChange={(e) => setRange(e.target.value)}>
                  <option value="all">All time</option>
                  <option value="6h">Last 6 hours</option>
                  <option value="24h">Last day</option>
                  <option value="7d">Last week</option>
                </select>
              </label>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await loadSubmissions(range);
                    setSubmissionStatus({ type: "", message: "" });
                  } catch (error) {
                    setSubmissionStatus({
                      type: "error",
                      message: error instanceof Error ? error.message : "Failed to load submissions.",
                    });
                  }
                }}
              >
                Refresh
              </button>
              <button type="button" onClick={exportCsv}>Export CSV</button>
              <button type="button" onClick={clearSubmissionLog}>Clear Submission Log</button>
            </div>

            <p className="admin-hint">Showing {submissionsCount} submission(s) for range: {range}</p>

            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    {headers.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {submissions.length === 0 && (
                    <tr>
                      <td colSpan={headers.length}>No submissions in this range.</td>
                    </tr>
                  )}

                  {submissions.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDate(item.submittedAt)}</td>
                      {fields.map((field) => (
                        <td key={`${item.id}-${field.id}`}>{item.values[field.id] || ""}</td>
                      ))}
                      <td>{item.warnings?.join(" | ") || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className={`admin-status ${submissionStatus.type}`}>{submissionStatus.message}</p>
          </section>
        )}
      </section>
    </main>
  );
}
