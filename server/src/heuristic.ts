// Deterministic form filling — no model, no API key. Maps standard fields to
// the user's profile by the HTML autocomplete token first (high confidence),
// then by name/label keywords. This covers the bulk of real-world forms (name,
// email, phone, address, company) for free; the model only handles leftovers,
// and only if a key is configured.

import type { FormField, Profile, FillItem } from "./types.js";

// autocomplete token -> profile keys to try, in order
const AUTOCOMPLETE: Record<string, string[]> = {
  email: ["email"],
  tel: ["phone"],
  "tel-national": ["phone"],
  name: ["fullName", "name"],
  "given-name": ["firstName", "givenName"],
  "additional-name": ["middleName"],
  "family-name": ["lastName", "surname", "familyName"],
  "street-address": ["addressLine1", "streetAddress", "address"],
  "address-line1": ["addressLine1", "address"],
  "address-line2": ["addressLine2"],
  "address-level2": ["city"],
  "address-level1": ["state", "province"],
  "postal-code": ["zip", "postalCode", "postcode"],
  country: ["country"],
  "country-name": ["country"],
  organization: ["company", "organization", "organisation"],
  "organization-title": ["jobTitle", "title", "role"],
  url: ["website", "url"],
  bday: ["birthday", "dob", "dateOfBirth"],
};

// name/label keyword -> profile keys (fallback when there's no autocomplete)
const KEYWORD: { test: RegExp; keys: string[] }[] = [
  { test: /e-?mail/i, keys: ["email"] },
  { test: /phone|mobile|\btel\b|telephone/i, keys: ["phone"] },
  { test: /full.?name|your.?name|^\s*name\s*$/i, keys: ["fullName", "name"] },
  { test: /first.?name|given.?name|\bfname\b/i, keys: ["firstName", "givenName"] },
  { test: /last.?name|surname|family.?name|\blname\b/i, keys: ["lastName", "surname", "familyName"] },
  { test: /address.?line.?1|street.?address|^\s*address\s*$/i, keys: ["addressLine1", "address", "streetAddress"] },
  { test: /address.?line.?2|apartment|\bapt\b|suite|unit\b/i, keys: ["addressLine2"] },
  { test: /\bcity\b|town|address.?level.?2/i, keys: ["city"] },
  { test: /\bstate\b|province|region|address.?level.?1/i, keys: ["state", "province"] },
  { test: /\bzip\b|postal|postcode|post.?code/i, keys: ["zip", "postalCode", "postcode"] },
  { test: /\bcountry\b/i, keys: ["country"] },
  { test: /company|organi[sz]ation|employer|business.?name/i, keys: ["company", "organization"] },
  { test: /job.?title|position|occupation|\brole\b/i, keys: ["jobTitle", "title", "role"] },
  { test: /website|\burl\b|home.?page/i, keys: ["website", "url"] },
  { test: /linkedin/i, keys: ["linkedin"] },
];

function pick(profile: Profile, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = profile[k];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return undefined;
}

/** Fill what we can deterministically. Sensitive fields are never touched. */
export function heuristicFill(fields: FormField[], profile: Profile): FillItem[] {
  const fills: FillItem[] = [];
  for (const f of fields) {
    if (f.sensitive) continue;
    let value: string | undefined;

    const acToken = (f.autocomplete || "").toLowerCase().trim().split(/\s+/).pop();
    if (acToken && AUTOCOMPLETE[acToken]) value = pick(profile, AUTOCOMPLETE[acToken]);

    if (value === undefined) {
      const hay = [f.name, f.label].filter(Boolean).join(" ");
      for (const rule of KEYWORD) {
        if (rule.test.test(hay)) {
          value = pick(profile, rule.keys);
          if (value !== undefined) break;
        }
      }
    }

    if (value === undefined) continue;
    if (f.options?.length && !f.options.includes(value)) continue; // must be a real option
    fills.push({ fieldId: f.id, value });
  }
  return fills;
}
