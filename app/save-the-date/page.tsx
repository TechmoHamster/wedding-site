"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import {
  COUNTRY_OPTIONS,
  getCountryCode,
  getStateOptionsForCountry,
  normalizeCountryName,
} from "@/lib/addressOptions";

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
  const [googlePlacesReady, setGooglePlacesReady] = useState(false);
  const [addressPredictions, setAddressPredictions] = useState<AddressPrediction[]>([]);
  const [showAddressPredictions, setShowAddressPredictions] = useState(false);

  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);

  const captchaRequired = Boolean(TURNSTILE_SITE_KEY);
  const isTurnstileVerified = !captchaRequired || Boolean(turnstileToken);

  const selectedCountry = normalizeCountryName(values.country || "United States");
  const stateOptions = useMemo(
    () => getStateOptionsForCountry(selectedCountry),
    [selectedCountry],
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
    if (!GOOGLE_MAPS_API_KEY || !googlePlacesReady) return;

    const input = (values.street1 || "").trim();
    if (input.length < 3) {
      setAddressPredictions([]);
      setShowAddressPredictions(false);
      return;
    }

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
        setShowAddressPredictions(mapped.length > 0);
      } catch {
        setAddressPredictions([]);
        setShowAddressPredictions(false);
      }
    }, 220);

    return () => {
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
      return next;
    });

    setAddressPredictions([]);
    setShowAddressPredictions(false);
    setStatusMessage("");
    setStatusType("");
  };

  const selectPrediction = async (placeId: string) => {
    const selected = addressPredictions.find((item) => item.placeId === placeId);
    if (!selected) return;

    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps?.places) {
      setValues((prev) => ({ ...prev, street1: selected.description || prev.street1 }));
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
          setValues((prev) => ({ ...prev, street1: place.formattedAddress }));
        }
      } catch {
        setValues((prev) => ({ ...prev, street1: selected.description || prev.street1 }));
      }
    } else {
      setValues((prev) => ({ ...prev, street1: selected.description || prev.street1 }));
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
      return next;
    });

    if (field === "street1") {
      setShowAddressPredictions(true);
    }

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
    if (!values.likelyAttend.trim()) errors.push("Are You Likely to Attend? is required.");
    if (!values.physicalInvite.trim()) errors.push("Would You Like a Mailed Invitation? is required.");

    return errors;
  };

  const resetForm = () => {
    setValues(INITIAL_VALUES);
    setTurnstileToken("");
    setTurnstileError("");
    setStatusMessage("");
    setStatusType("");
    setAddressPredictions([]);
    setShowAddressPredictions(false);

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
          formKey: "save_the_date",
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
        "Thanks - your mailing info has been received. We'll send your formal invitation closer to the wedding.",
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
                Zach and Erika are getting married. Please save the date and share your mailing address so we can send
                your formal invitation closer to the wedding.
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
                                  window.setTimeout(() => setShowAddressPredictions(false), 120);
                                }}
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
                        </div>

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
                                />
                                <span>{option}</span>
                              </label>
                            ))}
                          </div>
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
