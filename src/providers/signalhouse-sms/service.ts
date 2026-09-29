import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils";
import { Logger, NotificationTypes } from "@medusajs/framework/types";
import { SignalHouseSDK } from "@signalhousellc/sdk";
import { normalizeForSignalHouseSend } from "../../utils/phoneNumber";

type InjectedDependencies = {
	logger: Logger;
};

type SignalHouseSmsProviderOptions = {
	apiKey: string;
	senderPhoneNumber: string;
	baseUrl?: string;
};

/**
 * Sends notifications on the "sms" channel through the Signal House SMS API, so a Medusa
 * store can use Signal House as an `sms` provider on the core Notification module exactly like
 * `@medusajs/notification-sendgrid` does for `email`.
 */
export class SignalHouseSmsNotificationService extends AbstractNotificationProviderService {
	static identifier = "signalhouse-sms";

	protected logger_: Logger;
	protected sdk_: SignalHouseSDK;
	protected senderPhoneNumber_: string;

	/**
	 * @param {InjectedDependencies} dependencies - Services injected by the Medusa container.
	 * @param {Logger} dependencies.logger - The Medusa logger.
	 * @param {SignalHouseSmsProviderOptions} options - Provider options from `medusa-config.ts`.
	 * @param {string} options.apiKey - The Signal House API key for the store's group.
	 * @param {string} options.senderPhoneNumber - The Signal House number (or short code) to send from.
	 * @param {string} [options.baseUrl] - Signal House API base URL. Defaults to production.
	 */
	constructor({ logger }: InjectedDependencies, options: SignalHouseSmsProviderOptions) {
		super();

		if (!options?.apiKey) {
			throw new MedusaError(MedusaError.Types.INVALID_DATA, "signalhouse-sms provider requires an `apiKey` option");
		}
		if (!options?.senderPhoneNumber) {
			throw new MedusaError(MedusaError.Types.INVALID_DATA, "signalhouse-sms provider requires a `senderPhoneNumber` option");
		}

		this.logger_ = logger;
		this.senderPhoneNumber_ = options.senderPhoneNumber;
		this.sdk_ = new SignalHouseSDK({
			apiKey: options.apiKey,
			baseUrl: options.baseUrl || "https://v2.signalhouse.io",
		});
	}

	/**
	 * Sends one SMS notification via the Signal House API.
	 * @async
	 * @param {NotificationTypes.ProviderSendNotificationDTO} notification - The notification to send.
	 * @returns {Promise<NotificationTypes.ProviderSendNotificationResultsDTO>} The Signal House message id.
	 */
	async send(
		notification: NotificationTypes.ProviderSendNotificationDTO,
	): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
		const messageBody = notification.content?.text ?? (notification.data?.message as string | undefined);

		if (!messageBody) {
			throw new MedusaError(MedusaError.Types.INVALID_DATA, "signalhouse-sms notification requires content.text or data.message");
		}

		// The API's queueSendSMSSchema strips a leading "+" then requires ^\d+$ — a checkout-typed
		// "(555) 123-4567" or "+1 555 123 4567" fails that regex and the send 400s, even though the
		// same number already passed consent's own normalized lookup. `normalizeForSignalHouseSend`
		// fixes exactly that (punctuation failing `^\d+$`) without narrowing to NANP-only — an
		// earlier version of this fix used the NANP-only `normalizeNanpPhone` here and rejected every
		// valid international recipient the API itself accepts (ai-review finding, PR #1326).
		const normalizedTo = normalizeForSignalHouseSend(notification.to);
		if (!normalizedTo) {
			throw new MedusaError(MedusaError.Types.INVALID_DATA, `signalhouse-sms: "${notification.to}" does not contain at least 10 digits`);
		}

		const response = await this.sdk_.messages.sendSMS({
			senderPhoneNumber: notification.from || this.senderPhoneNumber_,
			// The API requires an array even for a single recipient (validated by the Signal
			// House API's send-SMS request schema) — a bare
			// string fails validation before send. `notification.to` is always a single string
			// per Medusa's ProviderSendNotificationDTO.
			recipientPhoneNumbers: [normalizedTo],
			messageBody,
		});

		if (!response?.success) {
			throw new MedusaError(
				MedusaError.Types.UNEXPECTED_STATE,
				`signalhouse-sms: send to ${notification.to} failed: ${JSON.stringify(response?.error)}`,
			);
		}

		// A 2xx here is NOT "delivered" or even "accepted" — landline/inactive filtering,
		// moderation blocks, and campaign opt-out/DNC suppression all resolve as 201s whose only
		// signal is the body's outcome counts (the send response's per-outcome counts). Only
		// enqueuedCount tells us a message was
		// actually accepted for delivery.
		const enqueuedCount = response.data?.enqueuedCount ?? 0;
		const insertedMessage = response.data?.insertedMessages?.[0];
		const messageId = insertedMessage?._id;

		if (enqueuedCount < 1 || !messageId) {
			throw new MedusaError(
				MedusaError.Types.UNEXPECTED_STATE,
				`signalhouse-sms: send to ${notification.to} was not enqueued (blocked, opted out, or suppressed) — ` +
					`status: ${insertedMessage?.status ?? "unknown"}`,
			);
		}

		this.logger_.info(`signalhouse-sms: sent to ${notification.to}, message id ${messageId}`);

		return { id: messageId };
	}
}
