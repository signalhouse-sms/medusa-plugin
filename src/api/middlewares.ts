import { defineMiddlewares } from "@medusajs/framework/http";

/**
 * `preserveRawBody` is required on the inbound Signal House webhook route — its signature is an
 * HMAC over the exact raw request bytes (the Signal House webhook signing scheme), and Express's default JSON parsing discards the original bytes once parsed. Scoped to
 * this one matcher, matching Medusa's own core precedent for the same problem
 * (`@medusajs/medusa`'s `/hooks/payment/:provider` route).
 */
export default defineMiddlewares({
	routes: [
		{
			matcher: "/webhooks/signalhouse",
			method: ["POST"],
			bodyParser: { preserveRawBody: true },
		},
	],
});
