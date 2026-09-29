import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { randomUUID } from "node:crypto";
import { SMS_CONSENT_MODULE } from "../modules/sms-consent";
import type SmsConsentModuleService from "../modules/sms-consent/service";
import { MESSAGE_LOG_MODULE } from "../modules/message-log";
import type MessageLogModuleService from "../modules/message-log/service";
import { withStopFooter } from "../utils/sms";
import { hasSucceededNotification } from "../utils/notificationIdempotency";

const RESOURCE_TYPE = "fulfillment";
const TEMPLATE = "shipment-created";

/**
 * Sends a transactional shipping-confirmation SMS, gated the same way as
 * `./order-placed.ts` — an active "transactional" consent grant is required, no exceptions.
 * `shipment.created`'s payload carries the fulfillment id (verified against the emitting
 * workflow, `@medusajs/core-flows`'s `order/workflows/create-shipment.js`: `data: { id:
 * shipment.id, no_notification }`, where `shipment.id` is itself the fulfillment id per the
 * fulfillment-domain `createShipmentWorkflow`'s own doc example, `id: "ful_123"`) — never
 * `order_id`/`fulfillment_id`. The query starts FROM the fulfillment entity and joins outward to
 * `order.customer`, rather than filtering the order entity by a linked module's field (order and
 * fulfillment are separate modules connected by a module link, which `query.graph` can traverse
 * for field selection but not for filtering a root entity — filtering by the fulfillment's own
 * primitive `id` sidesteps that entirely).
 * @async
 * @param {SubscriberArgs<{id: string; no_notification?: boolean}>} args - The shipment.created event.
 */
export default async function shipmentCreatedHandler({
	event: { data },
	container,
}: SubscriberArgs<{ id: string; no_notification?: boolean }>) {
	if (data.no_notification) {
		return;
	}

	const query = container.resolve(ContainerRegistrationKeys.QUERY);
	const notificationModuleService = container.resolve(Modules.NOTIFICATION);
	const consentService: SmsConsentModuleService = container.resolve(SMS_CONSENT_MODULE);
	const messageLogService: MessageLogModuleService = container.resolve(MESSAGE_LOG_MODULE);
	const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

	const {
		data: [fulfillment],
	} = await query.graph({
		entity: "fulfillment",
		fields: ["id", "order.id", "order.display_id", "order.customer.id", "order.customer.phone"],
		filters: { id: data.id },
	});

	const order = fulfillment?.order;
	if (!order) {
		logger.info(`signalhouse-sms: shipment ${data.id} — no order resolved for this fulfillment, skipping confirmation`);
		return;
	}

	const customer = order.customer;
	if (!customer?.phone) {
		logger.info(`signalhouse-sms: shipment ${data.id} order ${order.id} has no customer phone, skipping confirmation`);
		return;
	}

	const eligibility = await consentService.checkEligibility(customer.id, customer.phone, "transactional");
	if (!eligibility.eligible) {
		logger.info(`signalhouse-sms: shipment ${data.id} customer ${customer.id} not eligible (${eligibility.reason}), skipping`);
		return;
	}

	// See order-placed.ts's identical check: a redelivered event whose prior attempt already
	// succeeded must not resend, and this plugin's own resource-scoped record (not Medusa's
	// idempotency_key) is what actually guards that — hasSucceededNotification's JSDoc has why.
	if (await hasSucceededNotification(notificationModuleService, data.id, RESOURCE_TYPE, TEMPLATE)) {
		logger.info(`signalhouse-sms: shipment ${data.id} confirmation already sent, skipping redelivered event`);
		return;
	}

	const body = await withStopFooter(container, customer.phone, `Your order #${order.display_id} has shipped!`);

	const notification = await notificationModuleService.createNotifications({
		to: customer.phone,
		channel: "sms",
		template: TEMPLATE,
		content: { text: body },
		resource_id: data.id,
		resource_type: RESOURCE_TYPE,
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
			// See order-placed.ts's identical catch: the SMS is already sent and billed, so a logging
			// failure must never surface as (or be mistaken for) a send failure.
			logger.error(`signalhouse-sms: shipment ${data.id} sent but failed to log to message-log: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

export const config: SubscriberConfig = {
	event: "shipment.created",
};
