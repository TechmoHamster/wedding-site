import { NextResponse } from "next/server";
import { getCountryCode, normalizeCountryName, normalizeStateForCountry } from "@/lib/addressOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VerifyPayload = {
  street1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

type NominatimItem = {
  display_name?: string;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    province?: string;
    postcode?: string;
    country?: string;
  };
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickCity(item: NominatimItem): string {
  return (
    item.address?.city ||
    item.address?.town ||
    item.address?.village ||
    item.address?.municipality ||
    item.address?.county ||
    ""
  ).trim();
}

function pickState(item: NominatimItem): string {
  return (item.address?.state || item.address?.province || "").trim();
}

function buildStreet(item: NominatimItem): string {
  const houseNumber = (item.address?.house_number || "").trim();
  const road = (item.address?.road || "").trim();
  return [houseNumber, road].filter(Boolean).join(" ").trim();
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
  const country = normalizeCountryName(clean(payload.country));

  if (!street1) {
    return NextResponse.json({ error: "Street address is required for verification." }, { status: 400 });
  }

  const query = [street1, city, state, postalCode, country].filter(Boolean).join(", ");
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
  });

  const countryCode = getCountryCode(country);
  if (countryCode) params.set("countrycodes", countryCode);

  let candidate: NominatimItem | null = null;

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "wedding-rsvp-address-check/1.0",
      },
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

    const results = (await response.json()) as NominatimItem[];
    if (Array.isArray(results) && results.length > 0) {
      candidate = results[0];
    }
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

  if (!candidate) {
    return NextResponse.json(
      {
        ok: false,
        matchType: "not_found",
        message: "We could not verify that address. Please review and try again.",
      },
      { status: 200 },
    );
  }

  const suggestion = {
    street1: buildStreet(candidate),
    city: pickCity(candidate),
    state: normalizeStateForCountry(pickState(candidate), country),
    postalCode: (candidate.address?.postcode || "").trim(),
    country: normalizeCountryName(candidate.address?.country || country),
    formatted: clean(candidate.display_name),
  };

  const checks = [
    [street1, suggestion.street1],
    [city, suggestion.city],
    [state, suggestion.state],
    [postalCode, suggestion.postalCode],
    [country, suggestion.country],
  ] as const;

  let compared = 0;
  let exact = 0;

  for (const [submitted, normalized] of checks) {
    if (!submitted || !normalized) continue;
    compared += 1;
    if (normalizeCompare(submitted) === normalizeCompare(normalized)) exact += 1;
  }

  const confidence = compared > 0 ? exact / compared : 0;

  if (confidence >= 0.85) {
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
      message: "We found a suggested standardized address.",
      suggestion,
    },
    { status: 200 },
  );
}
