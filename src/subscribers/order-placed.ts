import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { randomUUID } from "node:crypto";
import { SMS_CONSENT_MODULE } from "../modules/sms-consent";
import type SmsConsentModuleService from "../modules/sms-consent/service";
import { MESSAGE_LOG_MODULE } from "../modules/message-log";
import type MessageLogModuleService from "../modules/message-log/service";
import { withStopFooter } from "../utils/sms";
import { hasSucceededNotification } from "../utils/notificationIdempotency";

const RESOURCE_TYPE = "order";
const TEMPLATE = "order-placed";

/**
 * Sends a transactional order-confirmation SMS, gated by the customer having an active
 * "transactional" consent grant (`../modules/sms-consent`). No consent record means no send —
 * there is no unconditional path, since Signal House's own system never treats transactional
 * messages as consent-exempt.
 * @async
 * @param {SubscriberArgs<{id: string}>} args - The order.placed event, carrying the order id.
 */
export default async function orderPlacedHandler({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
	const query = container.resolve(ContainerRegistrationKeys.QUERY);
	const notificationModuleService = container.resolve(Modules.NOTIFICATION);
	const consentService: SmsConsentModuleService = container.resolve(SMS_CONSENT_MODULE);
	const messageLogService: MessageLogModuleService = container.resolve(MESSAGE_LOG_MODULE);
	const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

	const {
		data: [order],
	} = await query.graph({
		entity: "order",
		fields: ["id", "display_id", "customer.id", "customer.phone"],
		filters: { id: data.id },
	});

	const customer = order?.customer;
	if (!customer?.phone) {
		logger.info(`signalhouse-sms: order ${data.id} has no customer phone, skipping confirmation`);
		return;
	}

	const eligibility = await consentService.checkEligibility(customer.id, customer.phone, "transactional");
	if (!eligibility.eligible) {
		logger.info(`signalhouse-sms: order ${data.id} customer ${customer.id} not eligible (${eligibility.reason}), skipping`);
		return;
	}

	// A redelivered `order.placed` event whose prior attempt already succeeded must not resend —
	// checked against this plugin's own resource-scoped record, not Medusa's idempotency_key (see
	// hasSucceededNotification's JSDoc for why the latter crashes on a retried FAILURE-status key).
	if (await hasSucceededNotification(notificationModuleService, data.id, RESOURCE_TYPE, TEMPLATE)) {
		logger.info(`signalhouse-sms: order ${data.id} confirmation already sent, skipping redelivered event`);
		return;
	}

	const body = await withStopFooter(container, customer.phone, `Thanks for your order #${order.display_id}! We'll text you when it ships.`);

	const notification = await notificationModuleService.createNotifications({
		to: customer.phone,
		channel: "sms",
		template: TEMPLATE,
		content: { text: body },
		resource_id: data.id,
		resource_type: RESOURCE_TYPE,
		// Random per attempt, not a fixed per-order key: the hasSucceededNotification check above is
		// this plugin's own duplicate-send guard, so this key only needs to dodge Medusa's ghost-row
		// crash on a retried FAILURE-status key — it doesn't need to be stable across redeliveries.
		idempotency_key: `${TEMPLATE}:${data.id}:${randomUUID()}`,
	});

	if (notification?.external_id) {
		try {
			await messageLogService.recordSent({
				externalId: notification.external_id,
				phoneNumber: customer.phone,
				customerId: customer.id,
				purpose: "transactional",
			});
		} catch (err) {
			// The SMS has already been sent and billed — a failure to LOG it must never surface as a
			// send failure (which would re-throw into the event bus and could retry this whole
			// handler). Logged and swallowed; see `recordSent`'s own JSDoc for the residual gap this
			// leaves in delivery analytics, which this catch cannot close.
			logger.error(`signalhouse-sms: order ${data.id} sent but failed to log to message-log: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

export const config: SubscriberConfig = {
	event: "order.placed",
};
