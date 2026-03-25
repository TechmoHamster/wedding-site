"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Script from "next/script";
import type { FormConfig, FormField } from "@/lib/types";
import { COUNTRY_OPTIONS, getCountryCode, getStateOptionsForCountry, normalizeCountryName } from "@/lib/addressOptions";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  getDialCode,
  inferCountryAndNational,
  isValidInternationalPhone,
  parseStoredPhoneToUi,
  toE164FromUi,
} from "@/lib/phone";
import type { CountryCode } from "libphonenumber-js";

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

type AddressPrediction = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  placePrediction?: any;
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
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

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

  if (value && field.type === "tel" && !isValidInternationalPhone(value)) {
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
  const [allowUnverifiedAddress, setAllowUnverifiedAddress] = useState(false);
  const [googlePlacesReady, setGooglePlacesReady] = useState(false);
  const [addressPredictions, setAddressPredictions] = useState<AddressPrediction[]>([]);
  const [showAddressPredictions, setShowAddressPredictions] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [phoneNationalNumber, setPhoneNationalNumber] = useState("");

  const captchaRequired = Boolean(TURNSTILE_SITE_KEY);
  const isTurnstileVerified = !captchaRequired || Boolean(turnstileToken);
  const selectedCountry = normalizeCountryName(values.country || "United States");
  const stateOptions = useMemo(() => getStateOptionsForCountry(selectedCountry), [selectedCountry]);
  const phoneCountryOptions = useMemo(() => {
    const displayNames = typeof Intl !== "undefined" && "DisplayNames" in Intl
      ? new Intl.DisplayNames(["en"], { type: "region" })
      : null;

    return PHONE_COUNTRIES.map((code) => {
      const name = displayNames?.of(code) || code;
      return {
        code,
        label: `${name} (${getDialCode(code)})`,
      };
    });
  }, []);

  const enteredAddressDisplay = useMemo(
    () => [values.street1, values.city, values.state, values.postalCode, values.country].filter(Boolean).join(", "),
    [values.street1, values.city, values.state, values.postalCode, values.country],
  );

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

        const phoneUi = parseStoredPhoneToUi(initialValues.phone || "", DEFAULT_PHONE_COUNTRY);
        setPhoneCountry(phoneUi.country);
        setPhoneNationalNumber(phoneUi.nationalNumber);
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

  const parseAddressComponents = (
    components: Array<{ long_name?: string; short_name?: string; longText?: string; shortText?: string; types?: string[] }> = [],
  ) => {
    const find = (type: string, key: "long" | "short" = "long") => {
      const component = components.find((c) => Array.isArray(c.types) && c.types.includes(type));
      if (!component) return "";

      if (key === "short") {
        return component.shortText || component.short_name || "";
      }
      return component.longText || component.long_name || "";
    };

    const streetNumber = find("street_number");
    const route = find("route");
    const locality = find("locality") || find("postal_town") || find("sublocality") || find("administrative_area_level_2");
    const adminLevel1 = find("administrative_area_level_1", "long");
    const postalCode = find("postal_code");
    const countryLong = find("country", "long");

    return {
      street1: [streetNumber, route].filter(Boolean).join(" ").trim(),
      city: locality,
      state: adminLevel1,
      postalCode,
      country: normalizeCountryName(countryLong || selectedCountry),
    };
  };

  const applyAddressParts = (parts: { street1: string; city: string; state: string; postalCode: string; country: string }) => {
    setValues((prev) => {
      const next = { ...prev };
      next.street1 = parts.street1 || next.street1 || "";
      next.city = parts.city || next.city || "";
      next.country = normalizeCountryName(parts.country || next.country || "United States");
      const options = getStateOptionsForCountry(next.country);
      next.state = parts.state || next.state || "";
      if (options.length > 0 && !options.includes(next.state)) {
        next.state = EMPTY_OPTION_VALUE;
      }
      next.postalCode = parts.postalCode || next.postalCode || "";

      if (config) {
        setFieldErrors(computeErrors(config.fields, next, touched));
      }

      return next;
    });

    setShowAddressPredictions(false);
    setAddressPredictions([]);
    setAddressVerifyStatus("");
    setAddressSuggestion(null);
    setAllowUnverifiedAddress(false);
  };

  const selectPrediction = async (placeId: string) => {
    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps?.places) return;

    const selected = addressPredictions.find((item) => item.placeId === placeId);
    if (selected?.placePrediction?.toPlace) {
      try {
        const place = selected.placePrediction.toPlace();
        await place.fetchFields({ fields: ["addressComponents"] });
        const parts = parseAddressComponents(((place as any).addressComponents || []) as any[]);
        applyAddressParts(parts);
        return;
      } catch {
        // fallback below
      }
    }

    const service = new maps.places.PlacesService(document.createElement("div"));
    service.getDetails(
      {
        placeId,
        fields: ["address_components"],
      },
      (place: any, status: any) => {
        if (status !== maps.places.PlacesServiceStatus.OK || !place?.address_components) return;
        const parts = parseAddressComponents(place.address_components);
        applyAddressParts(parts);
      },
    );
  };

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !googlePlacesReady) return;

    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps?.places?.AutocompleteSuggestion) return;

    const input = (values.street1 || "").trim();
    if (input.length < 3) {
      setAddressPredictions([]);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const countryCode = getCountryCode(selectedCountry).toUpperCase();
        const baseRequest: any = { input };

        let result: any;
        try {
          const scopedRequest = countryCode
            ? { ...baseRequest, includedRegionCodes: [countryCode] }
            : baseRequest;
          result = await maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(scopedRequest);
        } catch {
          result = await maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(baseRequest);
        }

        if (cancelled) return;

        const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
        const nextPredictions: AddressPrediction[] = suggestions
          .slice(0, 5)
          .map((suggestion: any) => {
            const prediction = suggestion?.placePrediction;
            const text = String(prediction?.text?.text || "");
            return {
              placeId: String(prediction?.placeId || suggestion?.placeId || ""),
              description: text,
              mainText: String(prediction?.mainText?.text || text),
              secondaryText: String(prediction?.secondaryText?.text || ""),
              placePrediction: prediction,
            };
          })
          .filter((item: AddressPrediction) => item.placeId);

        setAddressPredictions(nextPredictions);
      } catch {
        if (!cancelled) setAddressPredictions([]);
      }
    }, 170);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [values.street1, selectedCountry, googlePlacesReady, GOOGLE_MAPS_API_KEY]);

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
      setAllowUnverifiedAddress(false);
    }

    if (fieldId === "street1") {
      setShowAddressPredictions(true);
    }

    setStatusMessage("");
    setStatusType("");
  };

  const updatePhoneFromParts = (country: CountryCode, rawNumber: string) => {
    const normalized = toE164FromUi(country, rawNumber);
    setValues((prev) => ({ ...prev, phone: normalized || "" }));
  };

  const handlePhoneCountryChange = (nextCountry: string) => {
    const normalizedCountry = (nextCountry || DEFAULT_PHONE_COUNTRY) as CountryCode;
    setPhoneCountry(normalizedCountry);
    updatePhoneFromParts(normalizedCountry, phoneNationalNumber);
    setStatusMessage("");
    setStatusType("");
  };

  const handlePhoneNationalChange = (rawValue: string) => {
    if (rawValue.startsWith("+")) {
      const inferred = inferCountryAndNational(rawValue, phoneCountry);
      setPhoneCountry(inferred.country);
      setPhoneNationalNumber(inferred.nationalNumber);
      updatePhoneFromParts(inferred.country, inferred.nationalNumber);
    } else {
      setPhoneNationalNumber(rawValue);
      updatePhoneFromParts(phoneCountry, rawValue);
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
    const phoneUi = parseStoredPhoneToUi(nextValues.phone || "", DEFAULT_PHONE_COUNTRY);
    setPhoneCountry(phoneUi.country);
    setPhoneNationalNumber(phoneUi.nationalNumber);
    setTouched({});
    setFieldErrors({});
    setAddressVerifyStatus("");
    setAddressSuggestion(null);
    setAddressPredictions([]);
    setShowAddressPredictions(false);
    setAllowUnverifiedAddress(false);
  };

  const handleSubmitAnother = () => {
    setShowSuccessAnimation(false);
    setStatusMessage("");
    setStatusType("");
    setLastSubmissionId("");
    setTurnstileToken("");
    setTurnstileError("");
    setAddressPredictions([]);
    setShowAddressPredictions(false);
    setAllowUnverifiedAddress(false);
    const t = (window as Window & { turnstile?: { reset: () => void } }).turnstile;
    if (t && typeof t.reset === "function") t.reset();
    resetToDefaults();
  };

  const handleEditLastResponse = () => {
    if (!lastSubmittedValues || !config) return;
    setValues(lastSubmittedValues);
    const phoneUi = parseStoredPhoneToUi(lastSubmittedValues.phone || "", DEFAULT_PHONE_COUNTRY);
    setPhoneCountry(phoneUi.country);
    setPhoneNationalNumber(phoneUi.nationalNumber);
    setTouched({});
    setFieldErrors({});
    setStatusMessage("");
    setStatusType("");
    setShowSuccessAnimation(false);
    setAddressPredictions([]);
    setShowAddressPredictions(false);
    setAllowUnverifiedAddress(false);
  };

  const verifyAddress = async (): Promise<Partial<AddressVerifyResponse> | null> => {
    const street1 = (values.street1 || "").trim();
    if (!street1) return null;

    setAddressVerifyLoading(true);

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

      return payload;
    } catch (error) {
      setAddressVerifyStatus(error instanceof Error ? error.message : "Unable to verify address right now.");
      return null;
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

    setAddressVerifyStatus("");
    setAddressSuggestion(null);
    setAllowUnverifiedAddress(false);
  };

  const useEnteredAddress = () => {
    setAddressVerifyStatus("");
    setAllowUnverifiedAddress(true);
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

    if (!allowUnverifiedAddress && (values.street1 || "").trim()) {
      const verification = await verifyAddress();
      if (verification?.matchType === "suggested" && verification.suggestion) {
        setAddressSuggestion(verification.suggestion);
        setAddressVerifyStatus("Review and choose one address option.");
        setStatusType("error");
        setStatusMessage("Please choose recommended address or keep your entered address before submitting.");
        return;
      }

      if (verification?.matchType === "confirmed") {
        setAddressVerifyStatus("");
      }
    }

    setSubmitting(true);
    setStatusMessage("");
    setStatusType("");
    setShowSuccessAnimation(false);
    setAddressPredictions([]);
    setShowAddressPredictions(false);
    setAllowUnverifiedAddress(false);

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
      {GOOGLE_MAPS_API_KEY && (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&loading=async`}
          strategy="afterInteractive"
          onLoad={() => setGooglePlacesReady(true)}
        />
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

                          if (field.id === "phone") {
                            return (
                              <div key={field.id} className={`${fieldClass} rsvp-phone-field`.trim()}>
                                <span>{field.label}</span>
                                <div className="rsvp-phone-grid">
                                  <label className="rsvp-phone-code">
                                    Country Code
                                    <select
                                      name="phoneCountry"
                                      value={phoneCountry}
                                      onChange={(e) => handlePhoneCountryChange(e.target.value)}
                                      onBlur={() => markTouched(field.id)}
                                      disabled={!visible || submitting || loading}
                                    >
                                      {phoneCountryOptions.map((option) => (
                                        <option key={option.code} value={option.code}>{option.label}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="rsvp-phone-number">
                                    Phone Number
                                    <input
                                      type="tel"
                                      name="phoneNational"
                                      value={phoneNationalNumber}
                                      onChange={(e) => handlePhoneNationalChange(e.target.value)}
                                      onBlur={() => markTouched(field.id)}
                                      placeholder="Phone number"
                                      autoComplete={field.autocomplete || "tel-national"}
                                      aria-invalid={error ? "true" : "false"}
                                      aria-describedby={describedBy}
                                      required={visible && field.required}
                                      disabled={!visible || submitting || loading}
                                    />
                                  </label>
                                </div>
                                <p className="rsvp-phone-preview">Stored as: {values.phone || `${getDialCode(phoneCountry)} ...`}</p>
                                {error && <p id={`${field.id}-error`} className="rsvp-field-error" aria-live="polite">{error}</p>}
                              </div>
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
                                <label className="rsvp-address-label">
                                  {field.label}
                                  <div className="rsvp-address-input-wrap">
                                    <input
                                      type={field.type}
                                      name={field.id}
                                      value={values[field.id] || ""}
                                      onChange={(e) => updateFieldValue(field.id, e.target.value)}
                                      onBlur={() => {
                                        markTouched(field.id);
                                        window.setTimeout(() => setShowAddressPredictions(false), 150);
                                      }}
                                      onFocus={() => setShowAddressPredictions(true)}
                                      placeholder={field.placeholder || undefined}
                                      autoComplete={field.autocomplete || undefined}
                                      aria-invalid={error ? "true" : "false"}
                                      aria-describedby={describedBy}
                                      required={visible && field.required}
                                      disabled={!visible || submitting || loading}
                                    />

                                    {showAddressPredictions && addressPredictions.length > 0 && (
                                      <div className="rsvp-address-predictions" role="listbox" aria-label="Suggested addresses">
                                        {addressPredictions.map((prediction) => (
                                          <button
                                            type="button"
                                            key={prediction.placeId}
                                            className="rsvp-address-prediction"
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => selectPrediction(prediction.placeId)}
                                          >
                                            <span>{prediction.mainText}</span>
                                            {prediction.secondaryText && <small>{prediction.secondaryText}</small>}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </label>
                                {error && <p id={`${field.id}-error`} className="rsvp-field-error" aria-live="polite">{error}</p>}

                                {addressSuggestion && (
                                  <div className="rsvp-address-review">
                                    <p className="rsvp-address-review-title">We found a cleaner address format.</p>
                                    <div className="rsvp-address-review-grid">
                                      <div>
                                        <small>You Entered</small>
                                        <p>{enteredAddressDisplay || "(No address entered)"}</p>
                                      </div>
                                      <div>
                                        <small>Recommended</small>
                                        <p>{addressSuggestion.formatted || `${addressSuggestion.street1}, ${addressSuggestion.city}`}</p>
                                      </div>
                                    </div>
                                    <div className="rsvp-address-actions">
                                      <button
                                        type="button"
                                        className="rsvp-address-use-btn"
                                        onClick={useSuggestedAddress}
                                        disabled={addressVerifyLoading || submitting || loading}
                                      >
                                        Use Recommended
                                      </button>
                                      <button
                                        type="button"
                                        className="rsvp-address-keep-btn"
                                        onClick={useEnteredAddress}
                                        disabled={addressVerifyLoading || submitting || loading}
                                      >
                                        Keep Mine
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {!addressSuggestion && addressVerifyStatus && (
                                  <p className="rsvp-address-verify-status">{addressVerifyStatus}</p>
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
