import { test } from "node:test";
import assert from "node:assert/strict";
import { SignalHouseSmsNotificationService } from "./service";

const logger = { info: () => {}, warn: () => {}, error: () => {} } as any;

function buildService() {
	return new SignalHouseSmsNotificationService(
		{ logger },
		{ apiKey: "test-key", senderPhoneNumber: "+15555550100" },
	);
}

test("send() wraps `to` in an array — the API rejects a bare string (regression guard)", async () => {
	const service = buildService() as any;
	let capturedArgs: any;
	service.sdk_.messages.sendSMS = async (args: any) => {
		capturedArgs = args;
		return {
			success: true,
			data: { enqueuedCount: 1, insertedMessages: [{ _id: "msg_1", status: "ENQUEUED" }] },
		};
	};

	await service.send({ to: "+15555550199", channel: "sms", content: { text: "hi" } });

	assert.ok(Array.isArray(capturedArgs.recipientPhoneNumbers), "recipientPhoneNumbers must be an array");
	assert.deepEqual(capturedArgs.recipientPhoneNumbers, ["15555550199"]);
});

test("send() normalizes a checkout-formatted `to` into the bare 11-digit form the API's queueSendSMSSchema accepts (fable audit finding)", async () => {
	const service = buildService() as any;
	let capturedArgs: any;
	service.sdk_.messages.sendSMS = async (args: any) => {
		capturedArgs = args;
		return {
			success: true,
			data: { enqueuedCount: 1, insertedMessages: [{ _id: "msg_4", status: "ENQUEUED" }] },
		};
	};

	await service.send({ to: "(555) 555-0199", channel: "sms", content: { text: "hi" } });

	assert.deepEqual(capturedArgs.recipientPhoneNumbers, ["15555550199"]);
});

test("send() throws on a `to` with fewer than 10 digits, rather than sending garbage to the API", async () => {
	const service = buildService() as any;
	service.sdk_.messages.sendSMS = async () => {
		throw new Error("sendSMS should not be called for an unnormalizable number");
	};

	await assert.rejects(
		() => service.send({ to: "not-a-phone", channel: "sms", content: { text: "hi" } }),
		/does not contain at least 10 digits/,
	);
});

test("send() accepts a non-NANP international recipient the API itself allows, not just US/Canada numbers (ai-review finding, PR #1326)", async () => {
	const service = buildService() as any;
	let capturedArgs: any;
	service.sdk_.messages.sendSMS = async (args: any) => {
		capturedArgs = args;
		return {
			success: true,
			data: { enqueuedCount: 1, insertedMessages: [{ _id: "msg_5", status: "ENQUEUED" }] },
		};
	};

	await service.send({ to: "+442079460958", channel: "sms", content: { text: "hi" } });

	assert.deepEqual(capturedArgs.recipientPhoneNumbers, ["442079460958"]);
});

test("send() throws when enqueuedCount is 0 even though the API returned 2xx (blocked/opt-out/DNC)", async () => {
	const service = buildService() as any;
	service.sdk_.messages.sendSMS = async () => ({
		success: true,
		data: { enqueuedCount: 0, insertedMessages: [{ _id: "msg_2", status: "FAILED" }] },
	});

	await assert.rejects(
		() => service.send({ to: "+15555550199", channel: "sms", content: { text: "hi" } }),
		/was not enqueued/,
	);
});

test("send() throws when no message was inserted at all (global DNC suppression)", async () => {
	const service = buildService() as any;
	service.sdk_.messages.sendSMS = async () => ({
		success: true,
		data: { enqueuedCount: 0, insertedMessages: [] },
	});

	await assert.rejects(
		() => service.send({ to: "+15555550199", channel: "sms", content: { text: "hi" } }),
		/was not enqueued/,
	);
});

test("send() returns the message id on a real enqueue", async () => {
	const service = buildService() as any;
	service.sdk_.messages.sendSMS = async () => ({
		success: true,
		data: { enqueuedCount: 1, insertedMessages: [{ _id: "msg_3", status: "ENQUEUED" }] },
	});

	const result = await service.send({ to: "+15555550199", channel: "sms", content: { text: "hi" } });

	assert.equal(result.id, "msg_3");
});
