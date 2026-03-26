"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { COUNTRY_OPTIONS, getStateOptionsForCountry, normalizeCountryName } from "@/lib/addressOptions";

type StatusType = "" | "error" | "success";

type SaveDateValues = {
  firstName: string;
  lastName: string;
  email: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  likelyAttend: string;
  physicalInvite: string;
};

const SITE_TITLE = "Zach & Erika's Wedding";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

const INITIAL_VALUES: SaveDateValues = {
  firstName: "",
  lastName: "",
  email: "",
  street1: "",
  street2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "United States",
  likelyAttend: "",
  physicalInvite: "",
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function SaveTheDatePage() {
  const [values, setValues] = useState<SaveDateValues>(INITIAL_VALUES);
  const [csrfToken, setCsrfToken] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState<StatusType>("");
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);

  const captchaRequired = Boolean(TURNSTILE_SITE_KEY);
  const isTurnstileVerified = !captchaRequired || Boolean(turnstileToken);

  const stateOptions = useMemo(
    () => getStateOptionsForCountry(normalizeCountryName(values.country || "United States")),
    [values.country],
  );

  useEffect(() => {
    const loadCsrf = async () => {
      try {
        const response = await fetch("/api/csrf", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({}));
        if (typeof payload?.token === "string") {
          setCsrfToken(payload.token);
        }
      } catch {
        // no-op
      }
    };

    loadCsrf();
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || showSuccess) return;

    const renderWidget = () => {
      const api = (window as Window & {
        turnstile?: {
          render: (container: HTMLElement, options: Record<string, unknown>) => unknown;
        };
      }).turnstile;

      const container = turnstileContainerRef.current;
      if (!api || !container) return false;
      if (container.querySelector("iframe")) return true;

      container.innerHTML = "";
      api.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "light",
        size: "flexible",
        callback: (token: string) => {
          setTurnstileToken(token || "");
          setTurnstileError("");
        },
        "expired-callback": () => {
          setTurnstileToken("");
        },
        "error-callback": () => {
          setTurnstileToken("");
          setTurnstileError("CAPTCHA failed. Please try again.");
        },
      });

      return true;
    };

    if (renderWidget()) return;

    const intervalId = window.setInterval(() => {
      if (renderWidget()) {
        window.clearInterval(intervalId);
      }
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [TURNSTILE_SITE_KEY, showSuccess]);

  const updateValue = (field: keyof SaveDateValues, nextValue: string) => {
    setValues((prev) => {
      const next = { ...prev, [field]: nextValue };
      if (field === "country") {
        const normalized = normalizeCountryName(nextValue || "United States");
        next.country = normalized;
        const options = getStateOptionsForCountry(normalized);
        if (options.length > 0 && !options.includes(next.state)) {
          next.state = "";
        }
      }
      return next;
    });

    setStatusMessage("");
    setStatusType("");
  };

  const validate = (): string[] => {
    const errors: string[] = [];

    if (!values.firstName.trim()) errors.push("First Name is required.");
    if (!values.lastName.trim()) errors.push("Last Name is required.");
    if (!values.email.trim()) {
      errors.push("Email is required.");
    } else if (!isValidEmail(values.email.trim())) {
      errors.push("Email must be valid.");
    }

    if (!values.street1.trim()) errors.push("Street Address is required.");
    if (!values.city.trim()) errors.push("City is required.");
    if (!values.state.trim()) errors.push("State / Province is required.");
    if (!values.postalCode.trim()) errors.push("ZIP / Postal Code is required.");
    if (!values.country.trim()) errors.push("Country is required.");
    if (!values.likelyAttend.trim()) errors.push("Likely Able to Attend? is required.");
    if (!values.physicalInvite.trim()) errors.push("Would you like a physical invite? is required.");

    return errors;
  };

  const resetForm = () => {
    setValues(INITIAL_VALUES);
    setTurnstileToken("");
    setTurnstileError("");
    setStatusMessage("");
    setStatusType("");
    const t = (window as Window & { turnstile?: { reset: () => void } }).turnstile;
    if (t && typeof t.reset === "function") t.reset();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const errors = validate();
    if (errors.length > 0) {
      setStatusType("error");
      setStatusMessage(errors[0]);
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

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;

      const response = await fetch("/api/submissions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email,
          street1: values.street1,
          street2: values.street2,
          city: values.city,
          state: values.state,
          postalCode: values.postalCode,
          country: values.country,
          rsvp: values.likelyAttend,
          physicalInvite: values.physicalInvite,
          phone: "",
          smsOptIn: "No",
          guests: "1",
          message: "",
          website: "",
          turnstileToken,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = Array.isArray(payload.details) ? ` ${payload.details.join(" ")}` : "";
        throw new Error(`${payload.error || "Submission failed."}${details}`);
      }

      setStatusType("success");
      setShowSuccess(true);
      setStatusMessage(
        "Thanks! We received your details. Formal invitations and more wedding updates will be shared closer to the date.",
      );
      resetForm();
    } catch (error) {
      setStatusType("error");
      setStatusMessage(error instanceof Error ? error.message : "Submission failed.");
      setShowSuccess(false);
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

          <header className="rsvp-stage-nav brand-only">
            <a className="rsvp-brandmark" href="/">{SITE_TITLE}</a>
          </header>

          <div className="rsvp-stage-grid">
            <section className="rsvp-hero-copy">
              <h1 className="rsvp-title">Please Save the Date</h1>
              <p className="rsvp-description">
                Zach and Erika are getting married. Please save the date and share your mailing information so we can
                send your formal invitation later.
              </p>
              <div className="save-date-details">
                <p><strong>Zach & Erika&apos;s Wedding</strong></p>
                <p>Monday, October 5, 2026</p>
                <p>The Bungalow</p>
                <p>235 S 100 W St, Pleasant Grove, UT 84062</p>
                <p className="save-date-note">Formal invitations will be sent closer to the wedding.</p>
              </div>
            </section>

            <section className={`rsvp-form-card ${showSuccess ? "success-mode" : ""}`} id="save-the-date" aria-label="Save the date form">
              <form onSubmit={submit} noValidate>
                {showSuccess ? (
                  <div className="rsvp-success-screen" role="status" aria-live="polite" aria-label="Submission successful">
                    <div className="rsvp-success-animation">
                      <svg viewBox="0 0 52 52" aria-hidden="true">
                        <circle className="rsvp-success-circle" cx="26" cy="26" r="24" />
                        <path className="rsvp-success-check" d="M14 27.5 22.5 36 38 19.5" />
                      </svg>
                    </div>
                    <p className="rsvp-success-title">Info Received</p>
                    <p className="rsvp-success-text">{statusMessage}</p>
                    <button
                      type="button"
                      className="rsvp-success-reset"
                      onClick={() => {
                        setShowSuccess(false);
                        resetForm();
                      }}
                    >
                      Submit Another Response
                    </button>
                  </div>
                ) : (
                  <>
                    <fieldset className="rsvp-form-fields" disabled={submitting}>
                      <div className="rsvp-field-grid">
                        <label className="rsvp-field">
                          First Name
                          <input value={values.firstName} onChange={(e) => updateValue("firstName", e.target.value)} autoComplete="given-name" />
                        </label>

                        <label className="rsvp-field">
                          Last Name
                          <input value={values.lastName} onChange={(e) => updateValue("lastName", e.target.value)} autoComplete="family-name" />
                        </label>

                        <label className="rsvp-field full">
                          Email
                          <input type="email" value={values.email} onChange={(e) => updateValue("email", e.target.value)} autoComplete="email" />
                        </label>

                        <label className="rsvp-field full">
                          Street Address
                          <input value={values.street1} onChange={(e) => updateValue("street1", e.target.value)} autoComplete="address-line1" />
                        </label>

                        <label className="rsvp-field full">
                          Apartment, Suite, etc. (optional)
                          <input value={values.street2} onChange={(e) => updateValue("street2", e.target.value)} autoComplete="address-line2" />
                        </label>

                        <label className="rsvp-field">
                          City
                          <input value={values.city} onChange={(e) => updateValue("city", e.target.value)} autoComplete="address-level2" />
                        </label>

                        <label className="rsvp-field">
                          State / Province
                          <select value={values.state} onChange={(e) => updateValue("state", e.target.value)}>
                            <option value="">Select state/province</option>
                            {stateOptions.map((state) => (
                              <option key={state} value={state}>{state}</option>
                            ))}
                          </select>
                        </label>

                        <label className="rsvp-field">
                          ZIP / Postal Code
                          <input value={values.postalCode} onChange={(e) => updateValue("postalCode", e.target.value)} autoComplete="postal-code" />
                        </label>

                        <label className="rsvp-field">
                          Country
                          <select value={values.country} onChange={(e) => updateValue("country", e.target.value)}>
                            {COUNTRY_OPTIONS.map((country) => (
                              <option key={country} value={country}>{country}</option>
                            ))}
                          </select>
                        </label>

                        <fieldset className="rsvp-radio-field full">
                          <legend>Likely Able to Attend?</legend>
                          <div className="rsvp-choice-row">
                            {["Yes", "No", "Maybe"].map((option) => (
                              <label className="rsvp-choice" key={`likely-${option}`}>
                                <input
                                  type="radio"
                                  name="likelyAttend"
                                  value={option}
                                  checked={values.likelyAttend === option}
                                  onChange={(e) => updateValue("likelyAttend", e.target.value)}
                                />
                                <span>{option}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        <fieldset className="rsvp-radio-field full">
                          <legend>Would you like a physical invitation mailed to you?</legend>
                          <div className="rsvp-choice-row">
                            {["Yes", "No"].map((option) => (
                              <label className="rsvp-choice" key={`physical-${option}`}>
                                <input
                                  type="radio"
                                  name="physicalInvite"
                                  value={option}
                                  checked={values.physicalInvite === option}
                                  onChange={(e) => updateValue("physicalInvite", e.target.value)}
                                />
                                <span>{option}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      </div>
                    </fieldset>

                    <input className="rsvp-honeypot" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />

                    {captchaRequired && (
                      <div className="rsvp-captcha-block">
                        <div ref={turnstileContainerRef} className="cf-turnstile" />
                        {!turnstileToken && !turnstileError && (
                          <p className="rsvp-field-hint">Please verify you are human to enable submit.</p>
                        )}
                        {turnstileError && <p className="rsvp-field-error" aria-live="polite">{turnstileError}</p>}
                      </div>
                    )}

                    <button type="submit" disabled={submitting || !isTurnstileVerified}>
                      {submitting ? "Submitting..." : "Send Mailing Info"}
                    </button>
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
