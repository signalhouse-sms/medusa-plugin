/**
 * Fetches JSON from an admin route and throws with the server's own error message on failure.
 * Shared by every admin UI page in this plugin so error handling stays consistent.
 * @async
 * @param {string} path - The admin route path.
 * @param {RequestInit} [init] - Fetch options (method, body, etc).
 * @returns {Promise<T>} The parsed response body.
 * @throws {Error} - When the response is not ok, with the server's `message` field if present.
 */
export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
	const body = await res.json();
	if (!res.ok) {
		throw new Error(body?.message || "Request failed");
	}
	return body as T;
}
