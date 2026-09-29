import type { INotificationModuleService } from "@medusajs/framework/types";

/**
 * Returns true when a notification for this resource+template has already succeeded, so a caller
 * that only fires once per resource (an `order.placed`/`shipment.created` confirmation) can skip a
 * redelivered event instead of resending.
 *
 * This exists because `@medusajs/notification`'s own `idempotency_key` can't safely gate a retry
 * after a prior attempt FAILED: `createNotifications_` still calls `provider.send()` again for a
 * retried key whose existing row has `status: 'failure'` (a real duplicate SMS) but excludes that
 * retry from its insert (the key already exists, regardless of status), then crashes trying to
 * `update` a row it never created ("Notification with id ... not found") — verified directly
 * against the installed `@medusajs/notification` source, not assumed. `resource_id`/`resource_type`
 * (documented on `CreateNotificationDTO` for exactly this — "the ID of the resource this
 * notification is for") make the duplicate-send guard this plugin's own, independent of Medusa's
 * idempotency_key matching, so the caller is then free to use a fresh key on every attempt (see
 * `send-join-confirmation.ts`'s identical random-suffix technique for the same underlying bug).
 *
 * Two accepted residual gaps, neither closed with a claim/lock:
 * 1. Two genuinely concurrent deliveries of the same event both check before either has created a
 *    row and could both send — the same class already accepted in `jobs/cart-abandonment.ts`'s own
 *    duplicate guard, narrower here since a single event's redelivery isn't attacker-repeatable the
 *    way a cart-recovery job tick is.
 * 2. A `status: 'pending'` row (the SMS was billed by `provider.send()` succeeding, but the
 *    `finally` update in `createNotifications_` never landed — a crash between send and update)
 *    also reads as "not succeeded" here, so a redelivery resends rather than staying blocked the
 *    way the plugin's OLD fixed-key behavior did. This trades one gap for a different one: the old
 *    behavior silently dropped a legitimate retry on a pending row (a message that might genuinely
 *    have failed to send, permanently unretried); this trades that for a rare double-send on a
 *    message that DID send but never got marked so. Neither is fully closed; this one is judged the
 *    better failure mode for a transactional confirmation, not a solved problem.
 * @async
 * @param {INotificationModuleService} notificationModuleService - The Notification module.
 * @param {string} resourceId - The resource this notification is for (e.g. an order id).
 * @param {string} resourceType - The resource's type (e.g. `"order"`).
 * @param {string} template - The notification template name.
 * @returns {Promise<boolean>} Whether a `status: 'success'` notification already exists for this
 *   resource+template.
 */
export async function hasSucceededNotification(
	notificationModuleService: INotificationModuleService,
	resourceId: string,
	resourceType: string,
	template: string,
): Promise<boolean> {
	const existing = await notificationModuleService.listNotifications({ resource_id: resourceId, resource_type: resourceType, template });
	return existing.some((notification) => notification.status === "success");
}
