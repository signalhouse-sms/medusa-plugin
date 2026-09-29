import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { verifySignalHouseWebhookSignature } from "../../../utils/webhookSignature";
import { normalizeKeywordBody, isOptOutKeyword } from "../../../utils/messagingKeywords";
import { joinOptInWorkflow } from "../../../workflows/join-opt-in";
import { stopOptOutWorkflow } from "../../../workflows/stop-opt-out";
import { MESSAGE_LOG_MODULE } from "../../../modules/message-log";
import type MessageLogModuleService from "../../../modules/message-log/service";

const TIMESTAMP_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/**
 * Receives Signal House's signed webhook (a registered Subscribed Endpoint — NOT the legacy
 * per-number webhook URL, which is explicitly unsigned) and processes two unrelated event families:
 * inbound JOIN/STOP keywords (`MESSAGE_RECEIVED`), and outbound delivery receipts
 * (`MESSAGE_DELIVERED`/`MESSAGE_FAILED`).
 *
 * **Inbound (`MESSAGE_RECEIVED`)** is the only place in the plugin that can turn a real,
 * carrier-confirmed SMS reply into a consent grant — deliberately the opposite of a public "submit a
 * phone number to mark it consented" endpoint, which can't prove the phone's owner did anything.
 * Matches the Signal House Shopify app's JOIN handling: JOIN grants
 * `marketing`/`cart_recovery`/`ai_reply`/`transactional` (see `grantJoinConsentStep`'s JSDoc for why
 * `transactional` is included) and sends a confirmation SMS. STOP matches the platform's own
 * mandatory opt-out keyword floor (`../../../utils/messagingKeywords.ts`, matching the
 * Signal House API's list) and revokes every purpose via `revokeByPhone` — the
 * exact inbound handling that method's own JSDoc (`sms-consent/service.ts`) said would land here
 * rather than being bolted on later. JOIN itself stays an exact match (post-normalization), as the
 * Shopify app deliberately does — it isn't part of the mandatory keyword floor.
 *
 * **Delivery receipts (`MESSAGE_DELIVERED`/`MESSAGE_FAILED`)** update `message-log`'s record of a
 * message this plugin sent, keyed by `identifier` (Signal House's message `_id`, the same value
 * already captured as `notification.external_id` — see `message-log/models/message-log.ts`'s JSDoc).
 * **The payload shape is genuinely different from `MESSAGE_RECEIVED`'s**: verified against
 * the Signal House API's global and per-number webhook payloads — a delivery event's `metaData` IS the flat message document (`status`, `segmentCount`,
 * etc. directly on it), not wrapped under a `Message` key the way an inbound event's is. Reading
 * `body.metaData.Message` for a delivery event would silently find nothing.
 *
 * The signature's `timestamp` input is also checked for freshness (rejects anything more than 5
 * minutes old, or non-numeric) — otherwise a captured, validly-signed payload would verify
 * indefinitely on replay.
 * @async
 * @param {MedusaRequest} req - The inbound webhook request. Requires `preserveRawBody` (see
 *   `../../middlewares.ts`) since the signature is computed over the exact raw body bytes.
 * @param {MedusaResponse} res - The response.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

	const secret = process.env.SIGNALHOUSE_WEBHOOK_SIGNING_SECRET;
	if (!secret) {
		logger.error("signalhouse-sms: SIGNALHOUSE_WEBHOOK_SIGNING_SECRET not set — rejecting inbound webhook");
		res.status(401).json({ message: "webhook not configured" });
		return;
	}

	const signature = req.headers["x-signalhouse-signature"];
	const timestamp = req.headers["x-signalhouse-timestamp"];
	const rawBody = req.rawBody instanceof Buffer ? req.rawBody.toString("utf8") : undefined;

	if (typeof signature !== "string" || typeof timestamp !== "string" || rawBody === undefined) {
		res.status(401).json({ message: "missing signature headers" });
		return;
	}

	const timestampMs = Number(timestamp);
	if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > TIMESTAMP_FRESHNESS_WINDOW_MS) {
		logger.error("signalhouse-sms: inbound webhook timestamp is missing, invalid, or stale — rejecting");
		res.status(401).json({ message: "stale or invalid timestamp" });
		return;
	}

	if (!verifySignalHouseWebhookSignature(rawBody, timestamp, signature, secret)) {
		logger.error("signalhouse-sms: inbound webhook signature verification failed");
		res.status(401).json({ message: "invalid signature" });
		return;
	}

	// Body is already verified against the raw bytes above — safe to trust the parsed JSON now.
	const body = req.body as {
		event?: string;
		identifier?: string;
		metaData?: {
			Message?: { direction?: string; senderPhoneNumber?: string; messageBody?: string };
			status?: string;
			segmentCount?: number;
			successOrFailureReason?: string;
		};
	};

	if (body.event === "MESSAGE_DELIVERED" || body.event === "MESSAGE_FAILED") {
		if (!body.identifier) {
			res.sendStatus(200);
			return;
		}

		const messageLogService: MessageLogModuleService = req.scope.resolve(MESSAGE_LOG_MODULE);
		const updated = await messageLogService.recordDelivery({
			externalId: body.identifier,
			status: body.event === "MESSAGE_DELIVERED" ? "delivered" : "failed",
			segmentCount: body.metaData?.segmentCount ?? null,
			failureReason: body.metaData?.successOrFailureReason ?? null,
		});
		if (!updated) {
			logger.info(`signalhouse-sms: delivery receipt for unknown message ${body.identifier}, ignoring`);
		}

		res.sendStatus(200);
		return;
	}

	const message = body.metaData?.Message;
	if (body.event !== "MESSAGE_RECEIVED" || message?.direction !== "INBOUND" || !message.senderPhoneNumber || !body.identifier) {
		res.sendStatus(200);
		return;
	}

	const phoneNumber = message.senderPhoneNumber;
	const identifier = body.identifier;
	const keyword = normalizeKeywordBody(message.messageBody ?? "");

	if (keyword === "join") {
		await joinOptInWorkflow(req.scope).run({ input: { phoneNumber, identifier, inboundMessageBody: message.messageBody ?? "" } });
		logger.info(`signalhouse-sms: ${phoneNumber} opted in via JOIN keyword`);
	} else if (isOptOutKeyword(keyword)) {
		await stopOptOutWorkflow(req.scope).run({ input: { phoneNumber, revocationMethod: "keyword_stop" } });
		logger.info(`signalhouse-sms: ${phoneNumber} opted out via "${keyword}" keyword`);
	}

	res.sendStatus(200);
}
