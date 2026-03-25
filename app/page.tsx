"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Script from "next/script";
import type { FormConfig, FormField } from "@/lib/types";
import { COUNTRY_OPTIONS, getStateOptionsForCountry, normalizeCountryName } from "@/lib/addressOptions";

type StatusType = "" | "error" | "success";

type AddressSuggestion = {
  street1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  formatted: string;
};

type AddressVerifyResponse = {
  ok: boolean;
  matchType: "confirmed" | "suggested" | "not_found" | "unavailable";
  message: string;
  suggestion?: AddressSuggestion;
};

const EMPTY_OPTION_VALUE = "";

const FALLBACK_BRANDING = {
  eyebrow: "",
  title: "Share Your Address and RSVP",
  description:
    "Please share your mailing address and RSVP by September 12, 2026 so we can send your invitation and finalize headcount.",
  submitLabel: "Submit RSVP",
};
const SITE_TITLE = "Zach & Erika's Wedding";
const SHOW_TOP_NAV_LINKS = false;
const SHOW_ADMIN_BUTTON = false;
const CENTER_BRAND_ONLY = !SHOW_TOP_NAV_LINKS && !SHOW_ADMIN_BUTTON;
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

function getDefaultValue(field: FormField): string {
  if (field.defaultValue) return field.defaultValue;
  if ((field.type === "select" || field.type === "radio") && field.options?.length) {
    return field.type === "select" ? field.options[0] : "";
  }
  return "";
}

function isVisibleField(field: FormField, values: Record<string, string>): boolean {
  if (!field.showWhen?.fieldId || !field.showWhen.values?.length) return true;
  return field.showWhen.values.includes(values[field.showWhen.fieldId] || "");
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return true;
  return digits.length === 11 && digits.startsWith("1");
}

function validateField(field: FormField, values: Record<string, string>): string {
  if (!isVisibleField(field, values)) return "";

  const value = (values[field.id] || "").trim();

  if (field.required && !value) {
    return `${field.label} is required.`;
  }

  if (
    value &&
    (field.type === "select" || field.type === "radio") &&
    Array.isArray(field.options) &&
    field.options.length > 0 &&
    !field.options.includes(value)
  ) {
    return `${field.label} has an invalid option.`;
  }

  if (value && field.type === "email" && !isValidEmail(value)) {
    return `${field.label} must be a valid email address.`;
  }

  if (value && field.type === "tel" && !isValidPhone(value)) {
    return `${field.label} must be a valid phone number.`;
  }

  return "";
}

function computeErrors(
  fields: FormField[],
  values: Record<string, string>,
  touched: Record<string, boolean>,
  forceAll = false,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    if (!isVisibleField(field, values)) continue;
    if (!forceAll && !touched[field.id]) continue;

    const error = validateField(field, values);
    if (error) errors[field.id] = error;
  }

  return errors;
}

export default function RsvpPage() {
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState<StatusType>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);

  const [csrfToken, setCsrfToken] = useState("");
  const [hasTrackedStart, setHasTrackedStart] = useState(false);
  const [lastSubmissionId, setLastSubmissionId] = useState("");
  const [lastSubmittedValues, setLastSubmittedValues] = useState<Record<string, string> | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState("");
  const [addressVerifyStatus, setAddressVerifyStatus] = useState("");
  const [addressVerifyLoading, setAddressVerifyLoading] = useState(false);
  const [addressSuggestion, setAddressSuggestion] = useState<AddressSuggestion | null>(null);

  const captchaRequired = Boolean(TURNSTILE_SITE_KEY);
  const isTurnstileVerified = !captchaRequired || Boolean(turnstileToken);
  const selectedCountry = normalizeCountryName(values.country || "United States");
  const stateOptions = useMemo(() => getStateOptionsForCountry(selectedCountry), [selectedCountry]);

  const trackEvent = (event: string, payload: Record<string, unknown> = {}) => {
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, payload }),
      keepalive: true,
    }).catch(() => {
      // ignore telemetry failures
    });
  };

  useEffect(() => {
    const onError = (errorEvent: ErrorEvent) => {
      trackEvent("client_error", {
        message: errorEvent.message,
        source: errorEvent.filename,
        line: errorEvent.lineno,
      });
    };

    const onUnhandled = (event: PromiseRejectionEvent) => {
      trackEvent("client_unhandled_rejection", {
        reason: String(event.reason || "unknown"),
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      setLoading(true);
      try {
        const [configResponse, csrfResponse] = await Promise.all([
          fetch("/api/form-config", { cache: "no-store" }),
          fetch("/api/csrf", { cache: "no-store" }),
        ]);

        const payload = await configResponse.json();
        if (!configResponse.ok) {
          throw new Error(payload.error || "Failed to load form config");
        }

        if (csrfResponse.ok) {
          const csrfPayload = await csrfResponse.json().catch(() => ({}));
          if (csrfPayload?.token && typeof csrfPayload.token === "string") {
            setCsrfToken(csrfPayload.token);
          }
        }

        const nextConfig = payload as FormConfig;
        const initialValues: Record<string, string> = {};
        for (const field of nextConfig.fields) {
          initialValues[field.id] = getDefaultValue(field);
        }

        const initialCountry = normalizeCountryName(initialValues.country || "United States");
        initialValues.country = initialCountry;

        const initialStateOptions = getStateOptionsForCountry(initialCountry);
        if (initialStateOptions.length > 0 && !initialStateOptions.includes(initialValues.state || "")) {
          initialValues.state = EMPTY_OPTION_VALUE;
        }

        setConfig(nextConfig);
        setValues(initialValues);
      } catch (error) {
        setStatusType("error");
        setStatusMessage(error instanceof Error ? error.message : "Failed to load form");
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);


  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;

    const handleSuccess = (token: string) => {
      setTurnstileToken(token || "");
      setTurnstileError("");
    };

    const handleExpire = () => {
      setTurnstileToken("");
    };

    const w = window as Window & {
      __weddingTurnstileDone?: (token: string) => void;
      __weddingTurnstileExpired?: () => void;
    };

    w.__weddingTurnstileDone = handleSuccess;
    w.__weddingTurnstileExpired = handleExpire;

    return () => {
      delete w.__weddingTurnstileDone;
      delete w.__weddingTurnstileExpired;
    };
  }, []);

  const branding = useMemo(
    () => ({ ...FALLBACK_BRANDING, ...(config?.branding || {}) }),
    [config],
  );

  const updateFieldValue = (fieldId: string, nextValue: string) => {
    if (!hasTrackedStart) {
      setHasTrackedStart(true);
      trackEvent("form_started");
    }

    setValues((prev) => {
      const next = { ...prev, [fieldId]: nextValue };

      if (fieldId === "country") {
        next.country = normalizeCountryName(nextValue || "United States");
        const options = getStateOptionsForCountry(next.country);
        if (options.length > 0 && !options.includes(next.state || "")) {
          next.state = EMPTY_OPTION_VALUE;
        }
      }

      if (config) {
        for (const field of config.fields) {
          const visible = isVisibleField(field, next);
          if (!visible) {
            next[field.id] = "";
            continue;
          }

          if (!next[field.id]) {
            if (field.type === "select") next[field.id] = getDefaultValue(field);
            if (field.type === "checkbox") next[field.id] = field.defaultValue || "No";
          }
        }

        setFieldErrors(computeErrors(config.fields, next, touched));
      }

      return next;
    });

    if (["street1", "city", "state", "postalCode", "country"].includes(fieldId)) {
      setAddressVerifyStatus("");
      setAddressSuggestion(null);
    }

    setStatusMessage("");
    setStatusType("");
  };

  const markTouched = (fieldId: string) => {
    setTouched((prev) => {
      const next = { ...prev, [fieldId]: true };
      if (config) {
        setFieldErrors(computeErrors(config.fields, values, next));
      }
      return next;
    });
  };

  const resetToDefaults = () => {
    if (!config) return;
    const nextValues: Record<string, string> = {};
    for (const field of config.fields) {
      nextValues[field.id] = getDefaultValue(field);
    }

    const resetCountry = normalizeCountryName(nextValues.country || "United States");
    nextValues.country = resetCountry;
    if (getStateOptionsForCountry(resetCountry).length > 0 && !nextValues.state) {
      nextValues.state = EMPTY_OPTION_VALUE;
    }

    setValues(nextValues);
    setTouched({});
    setFieldErrors({});
    setAddressVerifyStatus("");
    setAddressSuggestion(null);
  };

  const handleSubmitAnother = () => {
    setShowSuccessAnimation(false);
    setStatusMessage("");
    setStatusType("");
    setLastSubmissionId("");
    setTurnstileToken("");
    setTurnstileError("");
    const t = (window as Window & { turnstile?: { reset: () => void } }).turnstile;
    if (t && typeof t.reset === "function") t.reset();
    resetToDefaults();
  };

  const handleEditLastResponse = () => {
    if (!lastSubmittedValues || !config) return;
    setValues(lastSubmittedValues);
    setTouched({});
    setFieldErrors({});
    setStatusMessage("");
    setStatusType("");
    setShowSuccessAnimation(false);
  };

  const handleAddressVerify = async () => {
    const street1 = (values.street1 || "").trim();
    if (!street1) {
      setAddressVerifyStatus("Enter a street address first.");
      setAddressSuggestion(null);
      return;
    }

    setAddressVerifyLoading(true);
    setAddressVerifyStatus("");
    setAddressSuggestion(null);

    try {
      const response = await fetch("/api/address/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          street1: values.street1 || "",
          city: values.city || "",
          state: values.state || "",
          postalCode: values.postalCode || "",
          country: values.country || "United States",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<AddressVerifyResponse>;

      if (!response.ok) {
        throw new Error(typeof payload.message === "string" ? payload.message : "Unable to verify address right now.");
      }

      if (payload.matchType === "confirmed") {
        setAddressVerifyStatus(payload.message || "Address confirmed.");
        if (payload.suggestion) setAddressSuggestion(payload.suggestion);
        return;
      }

      if (payload.matchType === "suggested" && payload.suggestion) {
        setAddressVerifyStatus(payload.message || "We found a suggested address.");
        setAddressSuggestion(payload.suggestion);
        return;
      }

      setAddressVerifyStatus(payload.message || "We could not verify the address.");
    } catch (error) {
      setAddressVerifyStatus(error instanceof Error ? error.message : "Unable to verify address right now.");
    } finally {
      setAddressVerifyLoading(false);
    }
  };

  const useSuggestedAddress = () => {
    if (!addressSuggestion) return;
    setValues((prev) => {
      const next = { ...prev };
      next.street1 = addressSuggestion.street1 || next.street1 || "";
      next.city = addressSuggestion.city || next.city || "";
      next.country = normalizeCountryName(addressSuggestion.country || next.country || "United States");
      const options = getStateOptionsForCountry(next.country);
      next.state = addressSuggestion.state || next.state || "";
      if (options.length > 0 && !options.includes(next.state)) {
        next.state = EMPTY_OPTION_VALUE;
      }
      next.postalCode = addressSuggestion.postalCode || next.postalCode || "";

      if (config) {
        setFieldErrors(computeErrors(config.fields, next, touched));
      }

      return next;
    });

    setAddressVerifyStatus("Suggested address applied.");
    setAddressSuggestion(null);
  };


  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!config || submitting) return;

    const allTouched: Record<string, boolean> = {};
    for (const field of config.fields) {
      if (isVisibleField(field, values)) allTouched[field.id] = true;
    }

    const validationErrors = computeErrors(config.fields, values, allTouched, true);
    setTouched(allTouched);
    setFieldErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      setStatusType("error");
      setStatusMessage("Please fix the highlighted fields and try again.");
      trackEvent("form_submit_failed", { reason: "client_validation" });
      return;
    }

    if (captchaRequired && !turnstileToken) {
      setTurnstileError("Please complete the CAPTCHA challenge.");
      setStatusType("error");
      setStatusMessage("Please complete the CAPTCHA challenge.");
      return;
    }

    setSubmitting(true);
    setStatusMessage("");
    setStatusType("");
    setShowSuccessAnimation(false);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;

      const response = await fetch("/api/submissions", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...values, website: "", turnstileToken }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = Array.isArray(payload.details) ? ` ${payload.details.join(" ")}` : "";
        throw new Error(`${payload.error || "Submission failed."}${details}`);
      }

      let message = payload.message || "Submission saved.";
      if (Array.isArray(payload.integrationWarnings) && payload.integrationWarnings.length > 0) {
        message += ` Integration warnings: ${payload.integrationWarnings.join(" ")}`;
        setStatusType("error");
        setShowSuccessAnimation(false);
        trackEvent("form_submit_failed", { reason: "integration_warning", warnings: payload.integrationWarnings });
      } else {
        setStatusType("success");
        setShowSuccessAnimation(true);
        setLastSubmissionId(typeof payload.submissionId === "string" ? payload.submissionId : "");
        setLastSubmittedValues({ ...values });
        trackEvent("form_submit_success", {
          submissionId: typeof payload.submissionId === "string" ? payload.submissionId : "",
        });
      }

      setStatusMessage(message);
      resetToDefaults();
    } catch (error) {
      setStatusType("error");
      setStatusMessage(error instanceof Error ? error.message : "Submission failed");
      setShowSuccessAnimation(false);
      trackEvent("form_submit_failed", {
        reason: "request_error",
        message: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="rsvp-page">
      {captchaRequired && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      )}
      <section className="rsvp-stage-wrap">
        <section className="rsvp-hero-stage">
          <div className="rsvp-landscape" aria-hidden="true">
            <div className="rsvp-photo-layer rsvp-photo-base" />
          </div>

          <header className={`rsvp-stage-nav ${CENTER_BRAND_ONLY ? "brand-only" : ""}`.trim()}>
            <a className="rsvp-brandmark" href="/">{SITE_TITLE}</a>
            {SHOW_TOP_NAV_LINKS && (
              <nav className="rsvp-nav-links" aria-label="Primary navigation">
                <a href="#invite">RSVP</a>
                <a href="#invite">Address</a>
                <a href="#invite">Details</a>
              </nav>
            )}
            {SHOW_ADMIN_BUTTON && <a className="rsvp-admin-link" href="/admin">Admin</a>}
          </header>

          <div className="rsvp-stage-grid">
            <section className="rsvp-hero-copy">
              <h1 className="rsvp-title">{branding.title}</h1>
              <p className="rsvp-description">{branding.description}</p>
            </section>

            <section className={`rsvp-form-card ${showSuccessAnimation ? "success-mode" : ""}`} id="invite" aria-label="RSVP form">
              <form onSubmit={handleSubmit} noValidate>
                {showSuccessAnimation ? (
                  <div className="rsvp-success-screen" role="status" aria-live="polite" aria-label="Submission successful">
                    <div className="rsvp-success-animation">
                      <svg viewBox="0 0 52 52" aria-hidden="true">
                        <circle className="rsvp-success-circle" cx="26" cy="26" r="24" />
                        <path className="rsvp-success-check" d="M14 27.5 22.5 36 38 19.5" />
                      </svg>
                    </div>
                    <p className="rsvp-success-title">Sent Successfully</p>
                    <p className="rsvp-success-text">{statusMessage}</p>
                    {lastSubmissionId && <p className="rsvp-success-id">Confirmation ID: {lastSubmissionId}</p>}
                    <div className="rsvp-success-actions">
                      <button type="button" className="rsvp-success-reset" onClick={handleSubmitAnother}>
                        Submit Another Response
                      </button>
                      {lastSubmittedValues && (
                        <button type="button" className="rsvp-success-edit" onClick={handleEditLastResponse}>
                          Edit Last Response
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <fieldset className="rsvp-form-fields" disabled={submitting || loading}>
                      <div className="rsvp-field-grid">
                        {loading && <p className="rsvp-loading-text">Loading form...</p>}

                        {!loading && config?.fields.map((field) => {
                          const visible = isVisibleField(field, values);
                          const fieldClass = `rsvp-field ${field.width === "full" ? "full" : ""} ${visible ? "" : "hidden"}`.trim();
                          const error = fieldErrors[field.id] || "";
                          const describedBy = error ? `${field.id}-error` : undefined;
                          const isCountryField = field.id === "country";
                          const isStateField = field.id === "state";
                          const selectOptions = isCountryField
                            ? [...COUNTRY_OPTIONS]
                            : isStateField
                              ? stateOptions
                              : (field.options || []);
                          const isSelectLikeField = field.type === "select" || isCountryField || (isStateField && stateOptions.length > 0);

                          if (field.type === "radio") {
                            return (
                              <fieldset
                                key={field.id}
                                className={`rsvp-radio-field ${fieldClass}`}
                                aria-invalid={error ? "true" : "false"}
                                aria-describedby={describedBy}
                              >
                                <legend>{field.label}</legend>
                                <div className="rsvp-choice-row">
                                  {(field.options || []).map((option) => (
                                    <label className="rsvp-choice" key={`${field.id}-${option}`}>
                                      <input
                                        type="radio"
                                        name={field.id}
                                        value={option}
                                        checked={(values[field.id] || "") === option}
                                        onChange={(e) => updateFieldValue(field.id, e.target.value)}
                                        onBlur={() => markTouched(field.id)}
                                        required={visible && field.required}
                                        disabled={!visible || submitting || loading}
                                      />
                                      <span>{option}</span>
                                    </label>
                                  ))}
                                </div>
                                {error && <p id={`${field.id}-error`} className="rsvp-field-error" aria-live="polite">{error}</p>}
                              </fieldset>
                            );
                          }

                          if (field.type === "textarea") {
                            return (
                              <label key={field.id} className={fieldClass}>
                                {field.label}
                                <textarea
                                  rows={3}
                                  name={field.id}
                                  value={values[field.id] || ""}
                                  onChange={(e) => updateFieldValue(field.id, e.target.value)}
                                  onBlur={() => markTouched(field.id)}
                                  placeholder={field.placeholder || undefined}
                                  autoComplete={field.autocomplete || undefined}
                                  aria-invalid={error ? "true" : "false"}
                                  aria-describedby={describedBy}
                                  required={visible && field.required}
                                  disabled={!visible || submitting || loading}
                                />
                                {error && <p id={`${field.id}-error`} className="rsvp-field-error" aria-live="polite">{error}</p>}
                              </label>
                            );
                          }

                          if (field.type === "checkbox") {
                            return (
                              <label key={field.id} className={`${fieldClass} rsvp-checkbox-field`}>
                                <input
                                  type="checkbox"
                                  name={field.id}
                                  checked={(values[field.id] || "") === "Yes"}
                                  onChange={(e) => updateFieldValue(field.id, e.target.checked ? "Yes" : "No")}
                                  onBlur={() => markTouched(field.id)}
                                  aria-invalid={error ? "true" : "false"}
                                  aria-describedby={describedBy}
                                  disabled={!visible || submitting || loading}
                                />
                                <span>{field.label}</span>
                                {error && <p id={`${field.id}-error`} className="rsvp-field-error" aria-live="polite">{error}</p>}
                              </label>
                            );
                          }

                          if (isSelectLikeField) {
                            const value = values[field.id] || (isCountryField ? "United States" : getDefaultValue(field));
                            const placeholderText = isCountryField
                              ? "Select country"
                              : isStateField
                                ? (stateOptions.length > 0 ? "Select state/province" : "Not required")
                                : "Select an option";

                            return (
                              <label key={field.id} className={fieldClass}>
                                {field.label}
                                <select
                                  name={field.id}
                                  value={value}
                                  onChange={(e) => updateFieldValue(field.id, e.target.value)}
                                  onBlur={() => markTouched(field.id)}
                                  aria-invalid={error ? "true" : "false"}
                                  aria-describedby={describedBy}
                                  required={visible && field.required}
                                  disabled={!visible || submitting || loading}
                                >
                                  {(!isCountryField && !isStateField) && (
                                    <option value={EMPTY_OPTION_VALUE}>{placeholderText}</option>
                                  )}
                                  {isStateField && (
                                    <option value={EMPTY_OPTION_VALUE}>{placeholderText}</option>
                                  )}
                                  {selectOptions.map((option) => (
                                    <option key={`${field.id}-${option}`} value={option}>{option}</option>
                                  ))}
                                </select>
                                {error && <p id={`${field.id}-error`} className="rsvp-field-error" aria-live="polite">{error}</p>}
                              </label>
                            );
                          }

                          if (field.id === "street1") {
                            return (
                              <div key={field.id} className={`${fieldClass} rsvp-address-block`.trim()}>
                                <label>
                                  {field.label}
                                  <input
                                    type={field.type}
                                    name={field.id}
                                    value={values[field.id] || ""}
                                    onChange={(e) => updateFieldValue(field.id, e.target.value)}
                                    onBlur={() => markTouched(field.id)}
                                    placeholder={field.placeholder || undefined}
                                    autoComplete={field.autocomplete || undefined}
                                    aria-invalid={error ? "true" : "false"}
                                    aria-describedby={describedBy}
                                    required={visible && field.required}
                                    disabled={!visible || submitting || loading}
                                  />
                                </label>
                                {error && <p id={`${field.id}-error`} className="rsvp-field-error" aria-live="polite">{error}</p>}

                                {visible && (
                                  <div className="rsvp-address-verify-wrap">
                                    <button
                                      type="button"
                                      className="rsvp-address-verify-btn"
                                      onClick={handleAddressVerify}
                                      disabled={addressVerifyLoading || submitting || loading}
                                    >
                                      {addressVerifyLoading ? "Checking Address..." : "Verify Address"}
                                    </button>
                                    {addressVerifyStatus && <p className="rsvp-address-verify-status">{addressVerifyStatus}</p>}
                                    {addressSuggestion && (
                                      <div className="rsvp-address-suggestion">
                                        <p>Suggested: {addressSuggestion.formatted || `${addressSuggestion.street1}, ${addressSuggestion.city}`}</p>
                                        <button
                                          type="button"
                                          className="rsvp-address-use-btn"
                                          onClick={useSuggestedAddress}
                                          disabled={addressVerifyLoading || submitting || loading}
                                        >
                                          Use Suggested Address
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return (
                            <label key={field.id} className={fieldClass}>
                              {field.label}
                              <input
                                type={field.type}
                                name={field.id}
                                value={values[field.id] || ""}
                                onChange={(e) => updateFieldValue(field.id, e.target.value)}
                                onBlur={() => markTouched(field.id)}
                                placeholder={field.placeholder || undefined}
                                autoComplete={field.autocomplete || undefined}
                                aria-invalid={error ? "true" : "false"}
                                aria-describedby={describedBy}
                                required={visible && field.required}
                                disabled={!visible || submitting || loading}
                              />
                              {error && <p id={`${field.id}-error`} className="rsvp-field-error" aria-live="polite">{error}</p>}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>

                    <input className="rsvp-honeypot" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />

                    {captchaRequired && (
                      <div className="rsvp-captcha-block">
                        <div
                          className="cf-turnstile"
                          data-sitekey={TURNSTILE_SITE_KEY}
                          data-theme="light"
                          data-callback="__weddingTurnstileDone"
                          data-expired-callback="__weddingTurnstileExpired"
                        />
                        {!turnstileToken && !turnstileError && (
                          <p className="rsvp-field-hint">Please verify you are human to enable submit.</p>
                        )}
                        {turnstileError && <p className="rsvp-field-error" aria-live="polite">{turnstileError}</p>}
                      </div>
                    )}

                    <button type="submit" disabled={submitting || loading || !isTurnstileVerified}>
                      {submitting ? "Submitting..." : branding.submitLabel}
                    </button>
                    {submitting && <p className="rsvp-saving-note">Saving your RSVP...</p>}
                    <p className={`rsvp-status ${statusType}`} role="status" aria-live="polite">{statusMessage}</p>
                  </>
                )}
              </form>
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}
