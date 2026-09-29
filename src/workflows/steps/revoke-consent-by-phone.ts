import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { SMS_CONSENT_MODULE } from "../../modules/sms-consent";
import type SmsConsentModuleService from "../../modules/sms-consent/service";

export type RevokeConsentByPhoneStepInput = {
	phoneNumber: string;
	revocationMethod: string;
};

/**
 * Revokes every active consent record for a phone number (a verified inbound STOP keyword). No
 * compensation — a STOP should stick even if a later step in the same workflow were to fail; this
 * is the one direction where "already applied, can't be automatically undone" is the correct
 * behavior, not a limitation. Safe to run more than once for the same event — `revokeByPhone`
 * only touches records that are still active, so a retried webhook delivery is a no-op the second
 * time.
 * @param {RevokeConsentByPhoneStepInput} input - The phone number and how the revocation was triggered.
 * @returns {Promise<StepResponse>} The consent records that were revoked.
 */
export const revokeConsentByPhoneStep = createStep(
	"revoke-consent-by-phone",
	async (input: RevokeConsentByPhoneStepInput, { container }) => {
		const consentService: SmsConsentModuleService = container.resolve(SMS_CONSENT_MODULE);
		const updated = await consentService.revokeByPhone(input.phoneNumber, input.revocationMethod);
		return new StepResponse(updated);
	},
);
