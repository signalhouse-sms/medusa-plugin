import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import { withStopFooter } from "../../utils/sms";

export const JOIN_PROMPT_TEMPLATE = "join-prompt";

export type SendJoinPromptStepInput = {
	phoneNumber: string;
};

/**
 * Sends a "Reply JOIN to confirm" prompt SMS. Grants no consent itself — see
 * `../../api/store/sms-consent/join-prompt/route.ts` for why this route can only cause an SMS to
 * be sent, never mark a number as consented.
 *
 * This is very often the first message the store has ever sent this number (the recipient hasn't
 * replied JOIN yet, so no confirmation has gone out either) — it must carry the CTIA opt-out
 * disclosure exactly like every other send site, via the shared `withStopFooter` (an earlier
 * version of this step sent a bare body with no disclosure and no history check).
 * @param {SendJoinPromptStepInput} input - The phone number to prompt.
 * @returns {Promise<StepResponse>} The created notification.
 */
export const sendJoinPromptStep = createStep("send-join-prompt", async (input: SendJoinPromptStepInput, { container }) => {
	const notificationModuleService = container.resolve(Modules.NOTIFICATION);

	const body = await withStopFooter(container, input.phoneNumber, "Reply JOIN to confirm you'd like text updates. Msg&data rates may apply.");

	const notification = await notificationModuleService.createNotifications({
		to: input.phoneNumber,
		channel: "sms",
		template: JOIN_PROMPT_TEMPLATE,
		content: { text: body },
	});

	return new StepResponse(notification);
});
