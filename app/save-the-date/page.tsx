"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import {
  COUNTRY_OPTIONS,
  getCountryCode,
  getStateOptionsForCountry,
  normalizeCountryName,
} from "@/lib/addressOptions";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  formatNationalNumberDisplay,
  getDialCode,
  normalizeNationalNumberInput,
  isValidInternationalPhone,
  parseStoredPhoneToUi,
  toE164FromUi,
} from "@/lib/phone";
import type { CountryCode } from "libphonenumber-js";

type StatusType = "" | "error" | "success";

type SaveDateValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  likelyAttend: string;
  physicalInvite: string;
};

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

const SITE_TITLE = "Zach & Erika's Wedding";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

const INITIAL_VALUES: SaveDateValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  street1: "",
  street2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "United States",
  likelyAttend: "",
  physicalInvite: "",
};

type FieldErrors = Partial<Record<keyof SaveDateValues, string>>;
type TouchedState = Partial<Record<keyof SaveDateValues, boolean>>;

const VALIDATION_ORDER: Array<keyof SaveDateValues> = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "street1",
  "city",
  "state",
  "postalCode",
  "country",
  "likelyAttend",
  "physicalInvite",
];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateField(field: keyof SaveDateValues, values: SaveDateValues): string {
  const value = (values[field] || "").trim();

  if (field === "street2") return "";

  if (field === "phone") {
    if (!value) return "";
    return isValidInternationalPhone(value) ? "" : "Phone Number must be valid.";
  }

  if (!value) {
    switch (field) {
      case "firstName": return "First Name is required.";
      case "lastName": return "Last Name is required.";
      case "email": return "Email is required.";
      case "street1": return "Street Address is required.";
      case "city": return "City is required.";
      case "state": return "State / Province is required.";
      case "postalCode": return "ZIP / Postal Code is required.";
      case "country": return "Country is required.";
      case "likelyAttend": return "Are You Likely to Attend? is required.";
      case "physicalInvite": return "Would You Like a Mailed Invitation? is required.";
      default: return "";
    }
  }

  if (field === "email" && !isValidEmail(value)) {
    return "Email must be valid.";
  }

  return "";
}

function computeErrors(values: SaveDateValues, touched: TouchedState, forceAll = false): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of VALIDATION_ORDER) {
    if (!forceAll && !touched[field]) continue;
    const error = validateField(field, values);
    if (error) errors[field] = error;
  }
  return errors;
}

export default function SaveTheDatePage() {
  const [values, setValues] = useState<SaveDateValues>(INITIAL_VALUES);
  const [touched, setTouched] = useState<TouchedState>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [csrfToken, setCsrfToken] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState<StatusType>("");
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastSubmissionId, setLastSubmissionId] = useState("");
  const [editingSubmissionId, setEditingSubmissionId] = useState("");
  const [lastSubmittedValues, setLastSubmittedValues] = useState<SaveDateValues | null>(null);
  const [googlePlacesReady, setGooglePlacesReady] = useState(false);
  const [addressPredictions, setAddressPredictions] = useState<AddressPrediction[]>([]);
  const [showAddressPredictions, setShowAddressPredictions] = useState(false);
  const [addressVerifyStatus, setAddressVerifyStatus] = useState("");
  const [addressVerifyLoading, setAddressVerifyLoading] = useState(false);
  const [addressSuggestion, setAddressSuggestion] = useState<AddressSuggestion | null>(null);
  const [allowUnverifiedAddress, setAllowUnverifiedAddress] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
  const [phoneNationalNumber, setPhoneNationalNumber] = useState("");

  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const phoneCountryIntentRef = useRef(false);

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

  const trackIntegrationWarning = (warnings: string[]) => {
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "save_date_integration_warning",
        payload: { warnings },
      }),
      keepalive: true,
    }).catch(() => {
      // Ignore telemetry failures.
    });
  };

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
    if (!GOOGLE_MAPS_API_KEY || !googlePlacesReady) return;

    const input = (values.street1 || "").trim();
    if (input.length < 3) {
      setAddressPredictions([]);
      setShowAddressPredictions(false);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const maps = (window as Window & { google?: any }).google?.maps;
      if (!maps?.places?.AutocompleteSuggestion) return;

      const countryCode = getCountryCode(selectedCountry).toLowerCase();
      const baseRequest: Record<string, unknown> = {
        input,
        language: "en",
        sessionToken: new maps.places.AutocompleteSessionToken(),
      };

      const scopedRequest = countryCode
        ? { ...baseRequest, includedRegionCodes: [countryCode] }
        : baseRequest;

      try {
        let response: any;
        try {
          response = await maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(scopedRequest);
        } catch {
          response = await maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(baseRequest);
        }

        if (cancelled) return;

        const suggestions = Array.isArray(response?.suggestions) ? response.suggestions : [];
        const mapped: AddressPrediction[] = suggestions
          .map((item: any, index: number) => {
            const prediction = item?.placePrediction;
            if (!prediction) return null;

            const text = prediction?.text?.toString?.() || prediction?.text?.text || "";
            const mainText = prediction?.structuredFormat?.mainText?.text || text;
            const secondaryText = prediction?.structuredFormat?.secondaryText?.text || "";
            const placeId =
              prediction?.placeId ||
              (typeof prediction?.place === "string" ? prediction.place.split("/").pop() : "") ||
              `${text}-${index}`;

            return {
              placeId,
              description: text,
              mainText,
              secondaryText,
              placePrediction: prediction,
            };
          })
          .filter((item: AddressPrediction | null): item is AddressPrediction => Boolean(item));

        setAddressPredictions(mapped);
      } catch {
        if (!cancelled) {
          setAddressPredictions([]);
          setShowAddressPredictions(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [values.street1, selectedCountry, googlePlacesReady, GOOGLE_MAPS_API_KEY]);

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

  const markTouched = (field: keyof SaveDateValues) => {
    setTouched((prev) => {
      const next = { ...prev, [field]: true };
      setFieldErrors(computeErrors(values, next));
      return next;
    });
  };

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
        next.state = "";
      }
      next.postalCode = parts.postalCode || next.postalCode || "";

      setFieldErrors(computeErrors(next, touched));
      return next;
    });

    setAddressPredictions([]);
    setShowAddressPredictions(false);
    setAddressVerifyStatus("");
    setAddressSuggestion(null);
    setAllowUnverifiedAddress(false);
    setStatusMessage("");
    setStatusType("");
  };

  const selectPrediction = async (placeId: string) => {
    const selected = addressPredictions.find((item) => item.placeId === placeId);
    if (!selected) return;

    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps?.places) {
      setValues((prev) => {
        const next = { ...prev, street1: selected.description || prev.street1 };
        setFieldErrors(computeErrors(next, touched));
        return next;
      });
      setAddressPredictions([]);
      setShowAddressPredictions(false);
      return;
    }

    if (selected.placePrediction?.toPlace) {
      try {
        const place = selected.placePrediction.toPlace();
        await place.fetchFields({ fields: ["addressComponents", "formattedAddress"] });

        const components = (place.addressComponents || []).map((item: any) => ({
          types: item.types,
          longText: item.longText,
          shortText: item.shortText,
        }));

        if (components.length > 0) {
          applyAddressParts(parseAddressComponents(components));
          return;
        }

        if (place.formattedAddress) {
          setValues((prev) => {
            const next = { ...prev, street1: place.formattedAddress };
            setFieldErrors(computeErrors(next, touched));
            return next;
          });
        }
      } catch {
        setValues((prev) => {
          const next = { ...prev, street1: selected.description || prev.street1 };
          setFieldErrors(computeErrors(next, touched));
          return next;
        });
      }
    } else {
      setValues((prev) => {
        const next = { ...prev, street1: selected.description || prev.street1 };
        setFieldErrors(computeErrors(next, touched));
        return next;
      });
    }

    setAddressPredictions([]);
    setShowAddressPredictions(false);
  };

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

      setFieldErrors(computeErrors(next, touched));
      return next;
    });

    if (["street1", "city", "state", "postalCode", "country"].includes(field)) {
      setAddressVerifyStatus("");
      setAddressSuggestion(null);
      setAllowUnverifiedAddress(false);
    }

    if (field === "street1") {
      setShowAddressPredictions(true);
    }

    setStatusMessage("");
    setStatusType("");
  };

  const updatePhoneFromParts = (country: CountryCode, rawNumber: string) => {
    const normalized = toE164FromUi(country, rawNumber);
    setValues((prev) => {
      const next = { ...prev, phone: normalized || "" };
      setFieldErrors(computeErrors(next, touched));
      return next;
    });
  };

  const handlePhoneCountryChange = (nextCountry: string) => {
    const normalizedCountry = (nextCountry || DEFAULT_PHONE_COUNTRY) as CountryCode;
    setPhoneCountry(normalizedCountry);
    updatePhoneFromParts(normalizedCountry, phoneNationalNumber);
    setStatusMessage("");
    setStatusType("");
  };

  const markPhoneCountryIntent = () => {
    phoneCountryIntentRef.current = true;
  };

  const clearPhoneCountryIntent = () => {
    phoneCountryIntentRef.current = false;
  };

  const handlePhoneNationalChange = (rawValue: string) => {
    const normalized = normalizeNationalNumberInput(phoneCountry, rawValue);

    const rawTrimmed = (rawValue || "").trim();
    const digitsOnly = rawTrimmed.replace(/\D/g, "");
    const hasExplicitInternationalPrefix = rawTrimmed.startsWith("+") || rawTrimmed.startsWith("00");
    const looksLikeNanp = digitsOnly.length === 10 || (digitsOnly.length === 11 && digitsOnly.startsWith("1"));

    const nextCountry = (!hasExplicitInternationalPrefix && looksLikeNanp)
      ? DEFAULT_PHONE_COUNTRY
      : normalized.country;

    setPhoneCountry(nextCountry);
    setPhoneNationalNumber(normalized.nationalNumber);
    updatePhoneFromParts(nextCountry, normalized.nationalNumber);

    setStatusMessage("");
    setStatusType("");
  };

  const resetForm = (clearStatus = true) => {
    setValues(INITIAL_VALUES);
    const phoneUi = parseStoredPhoneToUi("", DEFAULT_PHONE_COUNTRY);
    setPhoneCountry(phoneUi.country);
    setPhoneNationalNumber(phoneUi.nationalNumber);
    setTouched({});
    setFieldErrors({});
    setTurnstileToken("");
    setTurnstileError("");
    if (clearStatus) {
      setStatusMessage("");
      setStatusType("");
    }
    setAddressPredictions([]);
    setShowAddressPredictions(false);
    setAddressVerifyStatus("");
    setAddressSuggestion(null);
    setAllowUnverifiedAddress(false);

    const t = (window as Window & { turnstile?: { reset: () => void } }).turnstile;
    if (t && typeof t.reset === "function") t.reset();
  };

  const handleSubmitAnother = () => {
    setShowSuccess(false);
    setStatusMessage("");
    setStatusType("");
    setLastSubmissionId("");
    setEditingSubmissionId("");
    resetForm(false);
  };

  const handleEditLastResponse = () => {
    if (!lastSubmittedValues) return;
    setEditingSubmissionId(lastSubmissionId || "");
    setValues(lastSubmittedValues);
    const phoneUi = parseStoredPhoneToUi(lastSubmittedValues.phone || "", DEFAULT_PHONE_COUNTRY);
    setPhoneCountry(phoneUi.country);
    setPhoneNationalNumber(phoneUi.nationalNumber);
    setTouched({});
    setFieldErrors({});
    setStatusMessage("");
    setStatusType("");
    setShowSuccess(false);
    setAddressPredictions([]);
    setShowAddressPredictions(false);
    setAddressVerifyStatus("");
    setAddressSuggestion(null);
    setAllowUnverifiedAddress(false);
    setTurnstileToken("");
    setTurnstileError("");
    const t = (window as Window & { turnstile?: { reset: () => void } }).turnstile;
    if (t && typeof t.reset === "function") t.reset();
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
        next.state = "";
      }
      next.postalCode = addressSuggestion.postalCode || next.postalCode || "";
      setFieldErrors(computeErrors(next, touched));
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const allTouched: TouchedState = {};
    for (const field of VALIDATION_ORDER) allTouched[field] = true;
    setTouched(allTouched);

    const validationErrors = computeErrors(values, allTouched, true);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setStatusType("error");
      setStatusMessage("Please fix the highlighted fields and try again.");
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
    setAddressPredictions([]);
    setShowAddressPredictions(false);
    setAllowUnverifiedAddress(false);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;

      const response = await fetch("/api/submissions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          formKey: "save_the_date",
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email,
          phone: values.phone,
          street1: values.street1,
          street2: values.street2,
          city: values.city,
          state: values.state,
          postalCode: values.postalCode,
          country: values.country,
          rsvp: values.likelyAttend,
          physicalInvite: values.physicalInvite,
          smsOptIn: "No",
          guests: "1",
          message: "",
          website: "",
          turnstileToken,
          editSubmissionId: editingSubmissionId || "",
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = Array.isArray(payload.details) ? ` ${payload.details.join(" ")}` : "";
        throw new Error(`${payload.error || "Submission failed."}${details}`);
      }

      if (Array.isArray(payload.integrationWarnings) && payload.integrationWarnings.length > 0) {
        trackIntegrationWarning(payload.integrationWarnings);
      }

      let message = "Thanks - your mailing info has been received. We'll send your formal invitation closer to the wedding.";
      if (payload && typeof payload === "object" && payload.updated === true) {
        message = "Your save-the-date response was updated.";
      }

      setStatusType("success");
      setShowSuccess(true);
      setStatusMessage(message);
      setLastSubmissionId(typeof payload.submissionId === "string" ? payload.submissionId : "");
      setEditingSubmissionId("");
      setLastSubmittedValues({ ...values });
      resetForm(false);
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

          <header className="rsvp-stage-nav brand-only">
            <a className="rsvp-brandmark" href="/">{SITE_TITLE}</a>
          </header>

          <div className="rsvp-stage-grid">
            <section className="rsvp-hero-copy save-date-hero-copy">
              <h1 className="rsvp-title">Please Save the Date</h1>
              <p className="rsvp-description">
                Zach and Erika are getting married. Please share your mailing address so we can send your formal
                invitation closer to the wedding.
              </p>
              <div className="save-date-details">
                <p><strong>Zach & Erika&apos;s Wedding</strong></p>
                <p>Monday, October 5, 2026</p>
                <p>The Bungalow</p>
                <p>235 S 100 W St, Pleasant Grove, UT 84062</p>
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
                    <button type="button" className="rsvp-success-reset" onClick={handleSubmitAnother}>
                      Submit Another Response
                    </button>
                    {lastSubmittedValues && (
                      <button type="button" className="rsvp-success-edit" onClick={handleEditLastResponse}>
                        Edit Last Response
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <fieldset className="rsvp-form-fields" disabled={submitting}>
                      <div className="rsvp-field-grid">
                        <label className="rsvp-field">
                          First Name
                          <input
                            value={values.firstName}
                            onChange={(e) => updateValue("firstName", e.target.value)}
                            onBlur={() => markTouched("firstName")}
                            aria-invalid={fieldErrors.firstName ? "true" : "false"}
                            autoComplete="given-name"
                          />
                          {fieldErrors.firstName && <p className="rsvp-field-error">{fieldErrors.firstName}</p>}
                        </label>

                        <label className="rsvp-field">
                          Last Name
                          <input
                            value={values.lastName}
                            onChange={(e) => updateValue("lastName", e.target.value)}
                            onBlur={() => markTouched("lastName")}
                            aria-invalid={fieldErrors.lastName ? "true" : "false"}
                            autoComplete="family-name"
                          />
                          {fieldErrors.lastName && <p className="rsvp-field-error">{fieldErrors.lastName}</p>}
                        </label>

                        <label className="rsvp-field full">
                          Email
                          <input
                            type="email"
                            value={values.email}
                            onChange={(e) => updateValue("email", e.target.value)}
                            onBlur={() => markTouched("email")}
                            aria-invalid={fieldErrors.email ? "true" : "false"}
                            autoComplete="email"
                          />
                          {fieldErrors.email && <p className="rsvp-field-error">{fieldErrors.email}</p>}
                        </label>

                        <div className="rsvp-field full rsvp-phone-field">
                          <div className="rsvp-phone-grid">
                            <label className="rsvp-phone-code">
                              Country Code
                              <select
                                name="phoneCountrySelector"
                                autoComplete="new-password"
                                value={phoneCountry}
                                onPointerDown={markPhoneCountryIntent}
                                onKeyDown={markPhoneCountryIntent}
                                onChange={(e) => {
                                  if (!phoneCountryIntentRef.current) return;
                                  clearPhoneCountryIntent();
                                  handlePhoneCountryChange(e.target.value);
                                }}
                                onBlur={() => {
                                  clearPhoneCountryIntent();
                                  markTouched("phone");
                                }}
                                disabled={submitting}
                              >
                                {phoneCountryOptions.map((option) => (
                                  <option key={option.code} value={option.code}>{option.label}</option>
                                ))}
                              </select>
                            </label>
                            <label className="rsvp-phone-number">
                              Phone Number (optional)
                              <input
                                type="tel"
                                name="phoneNational"
                                value={formatNationalNumberDisplay(phoneCountry, phoneNationalNumber)}
                                onChange={(e) => handlePhoneNationalChange(e.target.value)}
                                onBlur={() => markTouched("phone")}
                                aria-invalid={fieldErrors.phone ? "true" : "false"}
                                autoComplete="tel-national"
                                disabled={submitting}
                              />
                            </label>
                          </div>
                          {fieldErrors.phone && <p className="rsvp-field-error">{fieldErrors.phone}</p>}
                        </div>

                        <div className="rsvp-field full rsvp-address-block">
                          <label className="rsvp-address-label">
                            Street Address
                            <div className="rsvp-address-input-wrap">
                              <input
                                type="text"
                                value={values.street1}
                                onChange={(e) => updateValue("street1", e.target.value)}
                                onFocus={() => {
                                  if (addressPredictions.length > 0) setShowAddressPredictions(true);
                                }}
                                onBlur={() => {
                                  markTouched("street1");
                                  window.setTimeout(() => setShowAddressPredictions(false), 120);
                                }}
                                aria-invalid={fieldErrors.street1 ? "true" : "false"}
                                autoComplete="address-line1"
                              />

                              {showAddressPredictions && addressPredictions.length > 0 && (
                                <div className="rsvp-address-predictions" role="listbox" aria-label="Suggested addresses">
                                  {addressPredictions.map((prediction) => (
                                    <button
                                      key={prediction.placeId}
                                      type="button"
                                      className="rsvp-address-prediction"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => void selectPrediction(prediction.placeId)}
                                      disabled={submitting}
                                    >
                                      <span>{prediction.mainText || prediction.description}</span>
                                      {prediction.secondaryText && <small>{prediction.secondaryText}</small>}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </label>
                          {fieldErrors.street1 && <p className="rsvp-field-error">{fieldErrors.street1}</p>}

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
                                  disabled={addressVerifyLoading || submitting}
                                >
                                  Use Recommended
                                </button>
                                <button
                                  type="button"
                                  className="rsvp-address-keep-btn"
                                  onClick={useEnteredAddress}
                                  disabled={addressVerifyLoading || submitting}
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

                        <label className="rsvp-field full">
                          Apartment, Suite, etc. (optional)
                          <input
                            value={values.street2}
                            onChange={(e) => updateValue("street2", e.target.value)}
                            autoComplete="address-line2"
                          />
                        </label>

                        <label className="rsvp-field">
                          City
                          <input
                            value={values.city}
                            onChange={(e) => updateValue("city", e.target.value)}
                            onBlur={() => markTouched("city")}
                            aria-invalid={fieldErrors.city ? "true" : "false"}
                            autoComplete="address-level2"
                          />
                          {fieldErrors.city && <p className="rsvp-field-error">{fieldErrors.city}</p>}
                        </label>

                        <label className="rsvp-field">
                          State / Province
                          <select
                            value={values.state}
                            onChange={(e) => updateValue("state", e.target.value)}
                            onBlur={() => markTouched("state")}
                            aria-invalid={fieldErrors.state ? "true" : "false"}
                          >
                            <option value="">Select state/province</option>
                            {stateOptions.map((state) => (
                              <option key={state} value={state}>{state}</option>
                            ))}
                          </select>
                          {fieldErrors.state && <p className="rsvp-field-error">{fieldErrors.state}</p>}
                        </label>

                        <label className="rsvp-field">
                          ZIP / Postal Code
                          <input
                            value={values.postalCode}
                            onChange={(e) => updateValue("postalCode", e.target.value)}
                            onBlur={() => markTouched("postalCode")}
                            aria-invalid={fieldErrors.postalCode ? "true" : "false"}
                            autoComplete="postal-code"
                          />
                          {fieldErrors.postalCode && <p className="rsvp-field-error">{fieldErrors.postalCode}</p>}
                        </label>

                        <label className="rsvp-field">
                          Country
                          <select
                            value={values.country}
                            onChange={(e) => updateValue("country", e.target.value)}
                            onBlur={() => markTouched("country")}
                            aria-invalid={fieldErrors.country ? "true" : "false"}
                          >
                            {COUNTRY_OPTIONS.map((country) => (
                              <option key={country} value={country}>{country}</option>
                            ))}
                          </select>
                          {fieldErrors.country && <p className="rsvp-field-error">{fieldErrors.country}</p>}
                        </label>

                        <fieldset className="rsvp-radio-field full">
                          <legend>Are You Likely to Attend?</legend>
                          <div className="rsvp-choice-row">
                            {["Yes", "No", "Maybe"].map((option) => (
                              <label className="rsvp-choice" key={`likely-${option}`}>
                                <input
                                  type="radio"
                                  name="likelyAttend"
                                  value={option}
                                  checked={values.likelyAttend === option}
                                  onChange={(e) => updateValue("likelyAttend", e.target.value)}
                                  onBlur={() => markTouched("likelyAttend")}
                                />
                                <span>{option}</span>
                              </label>
                            ))}
                          </div>
                          {fieldErrors.likelyAttend && <p className="rsvp-field-error">{fieldErrors.likelyAttend}</p>}
                        </fieldset>

                        <fieldset className="rsvp-radio-field full">
                          <legend>Would You Like a Mailed Invitation?</legend>
                          <div className="rsvp-choice-row">
                            {["Yes", "No"].map((option) => (
                              <label className="rsvp-choice" key={`physical-${option}`}>
                                <input
                                  type="radio"
                                  name="physicalInvite"
                                  value={option}
                                  checked={values.physicalInvite === option}
                                  onChange={(e) => updateValue("physicalInvite", e.target.value)}
                                  onBlur={() => markTouched("physicalInvite")}
                                />
                                <span>{option}</span>
                              </label>
                            ))}
                          </div>
                          {fieldErrors.physicalInvite && <p className="rsvp-field-error">{fieldErrors.physicalInvite}</p>}
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
