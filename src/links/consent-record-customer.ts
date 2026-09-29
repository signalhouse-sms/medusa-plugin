import CustomerModule from "@medusajs/medusa/customer";
import { defineLink } from "@medusajs/framework/utils";
import SmsConsentModule from "../modules/sms-consent";

// isList: a customer has one consent record per purpose (up to four) plus a new row per
// grant/revoke cycle — the default cardinality is one-to-one and would fail on the unique
// constraint the first time a customer gets a second record.
export default defineLink(CustomerModule.linkable.customer, {
	linkable: SmsConsentModule.linkable.consentRecord,
	isList: true,
});
