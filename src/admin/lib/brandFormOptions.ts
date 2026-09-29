/**
 * 10DLC brand form constants, matching the Signal House Shopify app's brand onboarding form —
 * the same brand form, the same `/brand` API.
 * Framework-agnostic plain data so it can be imported from the admin bundle with no Node-only deps.
 */

export const US_STATES = [
	"AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
	"HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
	"MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
	"NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
	"SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
	"DC",
];

// Only Private/For-Profit and Non-Profit are offered. PUBLIC_PROFIT and GOVERNMENT were removed
// because they hard-fail V2 /brand registration: PUBLIC_PROFIT requires a stockSymbol/stockExchange
// this form does not collect, and GOVERNMENT requires a US address. Either selection 400s the brand
// step. Do NOT re-add PUBLIC_PROFIT without also collecting + requiring stockSymbol and stockExchange.
export const ENTITY_TYPE_OPTIONS: { value: "PRIVATE_PROFIT" | "NON_PROFIT"; label: string }[] = [
	{ value: "PRIVATE_PROFIT", label: "Private / For Profit" },
	{ value: "NON_PROFIT", label: "Non-Profit" },
];

export const VERTICAL_OPTIONS = [
	{ value: "RETAIL", label: "Retail / E-Commerce" },
	{ value: "PROFESSIONAL", label: "Professional Services" },
	{ value: "REAL_ESTATE", label: "Real Estate" },
	{ value: "HEALTHCARE", label: "Healthcare" },
	{ value: "HUMAN_RESOURCES", label: "Human Resources" },
	{ value: "ENERGY", label: "Energy" },
	{ value: "ENTERTAINMENT", label: "Entertainment" },
	{ value: "TRANSPORTATION", label: "Transportation" },
	{ value: "AGRICULTURE", label: "Agriculture" },
	{ value: "INSURANCE", label: "Insurance" },
	{ value: "POSTAL", label: "Postal" },
	{ value: "EDUCATION", label: "Education" },
	{ value: "HOSPITALITY", label: "Hospitality" },
	{ value: "FINANCIAL", label: "Financial Services" },
	{ value: "POLITICAL", label: "Political" },
	{ value: "GAMBLING", label: "Gambling" },
	{ value: "LEGAL", label: "Legal" },
	{ value: "CONSTRUCTION", label: "Construction" },
	{ value: "NGO", label: "NGO" },
	{ value: "MANUFACTURING", label: "Manufacturing" },
	{ value: "GOVERNMENT", label: "Government" },
	{ value: "TECHNOLOGY", label: "Technology" },
	{ value: "COMMUNICATION", label: "Communication" },
];

export const COUNTRY_OPTIONS = [
	{ value: "US", label: "United States" },
	{ value: "CA", label: "Canada" },
];

export const DEFAULT_ENTITY_TYPE = "PRIVATE_PROFIT";
export const DEFAULT_VERTICAL = "RETAIL";
export const DEFAULT_COUNTRY = "US";

/**
 * Formats digits as they're typed into an EIN field, for display only: `12-3456789`. The submitted
 * value is stripped back to bare digits before it reaches `/brand` (`utils/brandPayload.ts`'s
 * `digitsOnly`) — this formatting never leaves the browser.
 * @param {string} value - The field's current raw input.
 * @returns {string} The formatted display value.
 */
export function formatEinInput(value: string): string {
	const digits = value.replace(/\D/g, "").slice(0, 9);
	if (digits.length <= 2) return digits;
	return `${digits.slice(0, 2)}-${digits.slice(2, 9)}`;
}

/**
 * Formats digits as they're typed into a US phone field, for display only: `(415) 555-0182`. The
 * submitted value is stripped back to bare digits before it reaches `/brand` (`utils/brandPayload.ts`'s
 * `digitsOnly`) — this formatting never leaves the browser.
 * @param {string} value - The field's current raw input.
 * @returns {string} The formatted display value.
 */
export function formatUsPhoneInput(value: string): string {
	let digits = value.replace(/\D/g, "").slice(0, 11);
	if (digits.length === 11 && digits.startsWith("1")) {
		digits = digits.slice(1);
	}
	digits = digits.slice(0, 10);
	if (digits.length <= 3) return digits;
	if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
	return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}
