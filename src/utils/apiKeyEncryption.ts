import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MedusaError } from "@medusajs/framework/utils";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/**
 * Reads and validates `SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY` (64 hex chars = 32 bytes, same
 * convention as the Signal House Shopify app's `ENCRYPTION_KEY`). Checked lazily, at the
 * first encrypt/decrypt call rather than at module load, so an install that never opens the settings
 * screen doesn't fail to boot over a key it doesn't yet need.
 * @returns {Buffer} The 32-byte encryption key.
 * @throws {MedusaError} - When the env var is missing or not exactly 64 hex characters.
 */
function getEncryptionKey(): Buffer {
	const raw = process.env.SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY;
	if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
		throw new MedusaError(
			MedusaError.Types.INVALID_DATA,
			"SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY must be set to exactly 64 hex characters (32 bytes) to store a Signal House API key.",
		);
	}
	return Buffer.from(raw, "hex");
}

/**
 * Encrypts a Signal House API key for storage. AES-256-GCM with a random IV per call, so encrypting
 * the same key twice never produces the same ciphertext.
 * @param {string} plaintext - The API key as pasted by the merchant.
 * @returns {string} `${iv}:${authTag}:${ciphertext}`, each hex-encoded.
 * @throws {MedusaError} - When the encryption key env var is missing or malformed.
 */
export function encryptApiKey(plaintext: string): string {
	const key = getEncryptionKey();
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return [iv, authTag, ciphertext].map((buf) => buf.toString("hex")).join(":");
}

/**
 * Decrypts a value produced by `encryptApiKey`.
 * @param {string} stored - The `${iv}:${authTag}:${ciphertext}` value from storage.
 * @returns {string} The original API key.
 * @throws {MedusaError} - When the encryption key env var is missing/malformed, or `stored` is not
 *   in the expected `iv:authTag:ciphertext` form.
 * @throws {Error} - When the auth tag doesn't verify (wrong key, or the ciphertext was tampered
 *   with) — a generic error from Node's own `crypto` module, not one this function raises itself.
 */
export function decryptApiKey(stored: string): string {
	const key = getEncryptionKey();
	const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
	if (!ivHex || !authTagHex || !ciphertextHex) {
		throw new MedusaError(MedusaError.Types.INVALID_DATA, "apiKeyEncryption: stored value is not in the expected iv:authTag:ciphertext form");
	}

	const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
	decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
	const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);

	return plaintext.toString("utf8");
}

/**
 * The last 4 characters of an API key, for the admin UI to show "connected as ...1234" without ever
 * decrypting the stored key for display.
 * @param {string} apiKey - The plaintext API key.
 * @returns {string} Its last 4 characters (or the whole key, if shorter than 4 characters).
 */
export function last4(apiKey: string): string {
	return apiKey.slice(-4);
}
