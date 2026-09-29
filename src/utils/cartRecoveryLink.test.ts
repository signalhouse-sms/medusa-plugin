import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCartRecoveryUrl } from "./cartRecoveryLink";

test("buildCartRecoveryUrl() appends cart_id to a base URL with no existing query string", () => {
	const url = buildCartRecoveryUrl("https://shop.example.com/cart-recover", "cart_123");
	assert.equal(url, "https://shop.example.com/cart-recover?cart_id=cart_123");
});

test("buildCartRecoveryUrl() adds cart_id alongside an existing query string, not a second `?`", () => {
	const url = buildCartRecoveryUrl("https://shop.example.com/cart-recover?utm_source=sms", "cart_123");
	assert.equal(url, "https://shop.example.com/cart-recover?utm_source=sms&cart_id=cart_123");
});

test("buildCartRecoveryUrl() preserves a trailing slash on the base path", () => {
	const url = buildCartRecoveryUrl("https://shop.example.com/cart-recover/", "cart_123");
	assert.equal(url, "https://shop.example.com/cart-recover/?cart_id=cart_123");
});

test("buildCartRecoveryUrl() URL-encodes a cart id that needs it", () => {
	const url = buildCartRecoveryUrl("https://shop.example.com/cart-recover", "cart id with spaces");
	assert.equal(url, "https://shop.example.com/cart-recover?cart_id=cart+id+with+spaces");
});
