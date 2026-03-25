import { NextResponse } from "next/server";
import {
  getCountryCode,
  getCountryNameFromCode,
  normalizeCountryName,
  normalizeStateForCountry,
} from "@/lib/addressOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VerifyPayload = {
  street1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

type Suggestion = {
  street1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  formatted: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildFormattedSuggestion(suggestion: Suggestion): string {
  return [suggestion.street1, suggestion.city, suggestion.state, suggestion.postalCode, suggestion.country]
    .filter(Boolean)
    .join(", ");
}

function scoreMatch(submitted: VerifyPayload, suggestion: Suggestion): number {
  const checks: Array<[string, string]> = [
    [clean(submitted.street1), suggestion.street1],
    [clean(submitted.city), suggestion.city],
    [clean(submitted.state), suggestion.state],
    [clean(submitted.postalCode), suggestion.postalCode],
    [normalizeCountryName(clean(submitted.country || "United States")), suggestion.country],
  ];

  let compared = 0;
  let exact = 0;

  for (const [a, b] of checks) {
    if (!a || !b) continue;
    compared += 1;
    if (normalizeCompare(a) === normalizeCompare(b)) exact += 1;
  }

  return compared > 0 ? exact / compared : 0;
}

export async function POST(request: Request) {
  let payload: VerifyPayload;
  try {
    payload = (await request.json()) as VerifyPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const street1 = clean(payload.street1);
  const city = clean(payload.city);
  const state = clean(payload.state);
  const postalCode = clean(payload.postalCode);
  const country = normalizeCountryName(clean(payload.country || "United States"));

  if (!street1) {
    return NextResponse.json({ error: "Street address is required for verification." }, { status: 400 });
  }

  const apiKey = clean(process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        matchType: "unavailable",
        message: "Address validation service is not configured.",
      },
      { status: 200 },
    );
  }

  const regionCode = getCountryCode(country).toUpperCase() || "US";

  try {
    const response = await fetch(`https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address: {
          regionCode,
          locality: city || undefined,
          administrativeArea: state || undefined,
          postalCode: postalCode || undefined,
          addressLines: [street1],
        },
        enableUspsCass: regionCode === "US",
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          matchType: "unavailable",
          message: "Address validation service is temporarily unavailable.",
        },
        { status: 200 },
      );
    }

    const data = (await response.json()) as {
      result?: {
        verdict?: {
          addressComplete?: boolean;
          hasUnconfirmedComponents?: boolean;
        };
        address?: {
          formattedAddress?: string;
          postalAddress?: {
            addressLines?: string[];
            locality?: string;
            administrativeArea?: string;
            postalCode?: string;
            regionCode?: string;
          };
        };
      };
    };

    const postalAddress = data.result?.address?.postalAddress;
    const suggestedCountry = getCountryNameFromCode(postalAddress?.regionCode || regionCode, country);

    const suggestion: Suggestion = {
      street1: clean(postalAddress?.addressLines?.[0] || street1),
      city: clean(postalAddress?.locality || city),
      state: normalizeStateForCountry(clean(postalAddress?.administrativeArea || state), suggestedCountry),
      postalCode: clean(postalAddress?.postalCode || postalCode),
      country: suggestedCountry,
      formatted: clean(data.result?.address?.formattedAddress || ""),
    };

    if (!suggestion.formatted) {
      suggestion.formatted = buildFormattedSuggestion(suggestion);
    }

    const confidence = scoreMatch(payload, suggestion);
    const verdict = data.result?.verdict;
    const likelyConfirmed = Boolean(verdict?.addressComplete) && !verdict?.hasUnconfirmedComponents;

    if (likelyConfirmed || confidence >= 0.85) {
      return NextResponse.json(
        {
          ok: true,
          matchType: "confirmed",
          message: "Address confirmed.",
          suggestion,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        matchType: "suggested",
        message: "We found a recommended standardized address.",
        suggestion,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        matchType: "unavailable",
        message: "Address validation service is temporarily unavailable.",
      },
      { status: 200 },
    );
  }
}
