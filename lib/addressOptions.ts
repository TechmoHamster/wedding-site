export const COUNTRY_OPTIONS = [
  "United States",
  "Canada",
  "Mexico",
  "United Kingdom",
  "Australia",
  "New Zealand",
  "Ireland",
  "France",
  "Germany",
  "Italy",
  "Spain",
  "Portugal",
  "Netherlands",
  "Belgium",
  "Switzerland",
  "Austria",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Poland",
  "Czech Republic",
  "Greece",
  "Turkey",
  "Japan",
  "South Korea",
  "Singapore",
  "India",
  "Philippines",
  "Thailand",
  "Indonesia",
  "Malaysia",
  "China",
  "Hong Kong",
  "Taiwan",
  "Brazil",
  "Argentina",
  "Chile",
  "Colombia",
  "Peru",
  "South Africa",
  "United Arab Emirates",
  "Saudi Arabia",
  "Israel",
  "Qatar",
  "Egypt",
] as const;

export const US_STATES = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "District of Columbia",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
] as const;

export const CANADA_PROVINCES = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon",
] as const;

const COUNTRY_CODE_MAP: Record<string, string> = {
  "United States": "us",
  Canada: "ca",
  Mexico: "mx",
  "United Kingdom": "gb",
  Australia: "au",
  "New Zealand": "nz",
  Ireland: "ie",
  France: "fr",
  Germany: "de",
  Italy: "it",
  Spain: "es",
  Portugal: "pt",
  Netherlands: "nl",
  Belgium: "be",
  Switzerland: "ch",
  Austria: "at",
  Sweden: "se",
  Norway: "no",
  Denmark: "dk",
  Finland: "fi",
  Poland: "pl",
  "Czech Republic": "cz",
  Greece: "gr",
  Turkey: "tr",
  Japan: "jp",
  "South Korea": "kr",
  Singapore: "sg",
  India: "in",
  Philippines: "ph",
  Thailand: "th",
  Indonesia: "id",
  Malaysia: "my",
  China: "cn",
  "Hong Kong": "hk",
  Taiwan: "tw",
  Brazil: "br",
  Argentina: "ar",
  Chile: "cl",
  Colombia: "co",
  Peru: "pe",
  "South Africa": "za",
  "United Arab Emirates": "ae",
  "Saudi Arabia": "sa",
  Israel: "il",
  Qatar: "qa",
  Egypt: "eg",
};

export function normalizeCountryName(country: string): string {
  const value = (country || "").trim();
  if (!value) return "United States";
  const byCase = COUNTRY_OPTIONS.find((item) => item.toLowerCase() === value.toLowerCase());
  return byCase || value;
}

export function getCountryCode(country: string): string {
  const normalized = normalizeCountryName(country);
  return COUNTRY_CODE_MAP[normalized] || "";
}

export function getStateOptionsForCountry(country: string): string[] {
  const normalized = normalizeCountryName(country);
  if (normalized === "Canada") return [...CANADA_PROVINCES];
  if (normalized === "United States") return [...US_STATES];
  return [];
}

export function normalizeStateForCountry(state: string, country: string): string {
  const trimmed = (state || "").trim();
  const options = getStateOptionsForCountry(country);
  if (!options.length) return trimmed;
  if (!trimmed) return "";

  const match = options.find((option) => option.toLowerCase() === trimmed.toLowerCase());
  return match || trimmed;
}
