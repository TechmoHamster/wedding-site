import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type PhoneUiState = {
  country: CountryCode;
  nationalNumber: string;
};

export const DEFAULT_PHONE_COUNTRY: CountryCode = "US";

export const PHONE_COUNTRIES = getCountries() as CountryCode[];

export function getDialCode(country: CountryCode): string {
  return `+${getCountryCallingCode(country)}`;
}

export function parseStoredPhoneToUi(value: string, fallbackCountry: CountryCode = DEFAULT_PHONE_COUNTRY): PhoneUiState {
  const input = (value || "").trim();
  if (!input) return { country: fallbackCountry, nationalNumber: "" };

  const parsed = parsePhoneNumberFromString(input);
  if (parsed) {
    return {
      country: (parsed.country as CountryCode) || fallbackCountry,
      nationalNumber: parsed.nationalNumber || "",
    };
  }

  return { country: fallbackCountry, nationalNumber: input.replace(/^\+/, "") };
}

export function toE164FromUi(country: CountryCode, nationalNumber: string): string {
  const raw = (nationalNumber || "").trim();
  if (!raw) return "";

  const parsed = raw.startsWith("+")
    ? parsePhoneNumberFromString(raw)
    : parsePhoneNumberFromString(raw, country);

  if (!parsed) return "";
  if (!parsed.isPossible()) return "";

  return parsed.number;
}

export function inferCountryAndNational(
  rawInput: string,
  fallbackCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): PhoneUiState {
  const input = (rawInput || "").trim();
  if (!input) return { country: fallbackCountry, nationalNumber: "" };

  if (input.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(input);
    if (parsed) {
      return {
        country: (parsed.country as CountryCode) || fallbackCountry,
        nationalNumber: parsed.nationalNumber || "",
      };
    }
  }

  return { country: fallbackCountry, nationalNumber: input };
}

export function isValidInternationalPhone(value: string, defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY): boolean {
  const input = (value || "").trim();
  if (!input) return false;

  const parsed = input.startsWith("+")
    ? parsePhoneNumberFromString(input)
    : parsePhoneNumberFromString(input, defaultCountry);

  return Boolean(parsed && parsed.isValid());
}
