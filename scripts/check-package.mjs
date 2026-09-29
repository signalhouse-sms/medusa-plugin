import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const [packed] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: packageRoot,
  encoding: "utf8",
}));
const files = new Set(packed.files.map(({ path }) => path));

/**
 * Check each concrete export target, including all conditional admin entry points.
 * @param {string|Object} target - Export path or conditional targets from package.json.
 */
function checkTarget(target) {
  if (typeof target === "string") {
    if (!target.includes("*")) {
      assert.ok(files.has(target.replace(/^\.\//, "")), `Export missing from npm package: ${target}`);
    }
  } else if (target && typeof target === "object") {
    Object.values(target).forEach(checkTarget);
  }
}

Object.values(manifest.exports).forEach(checkTarget);
assert.ok(files.has(".medusa/server/src/providers/signalhouse-sms/index.js"), "SMS provider missing from npm package");
assert.equal(manifest.publishConfig?.access, "public", "Scoped package must publish with public access");

[
  "README.md",
  "docs/INSTALLATION.md",
  "docs/CONSENT_INTEGRATION.md",
  "docs/COMPLIANCE_CHECKLIST.md",
  "docs/CART_RECOVERY_ROUTE.md",
].forEach((doc) => assert.ok(files.has(doc), `Doc missing from npm package: ${doc}`));
assert.equal(
  manifest.repository?.url,
  "git+https://github.com/signalhouse-sms/medusa-plugin.git",
  "repository must point at the public source repo",
);

const shipped = [...files].filter((path) => !path.startsWith("src/"));
const sourceMaps = shipped.filter((path) => path.endsWith(".map"));
assert.deepEqual(sourceMaps, [], "Source maps must not ship (they embed the original source)");

// Internal ticket keys, internal source paths, and inline source maps stay out of the public package.
const INTERNAL = /SHGHL-\d+|sourceMappingURL=data:|(^|[^\w])(api\/src|sdks\/javascript)\//;
shipped
  .filter((path) => /\.(js|mjs|cjs|md|json)$/.test(path))
  .forEach((path) => {
    const match = readFileSync(join(packageRoot, path), "utf8").match(INTERNAL);
    assert.equal(match, null, `Internal reference "${match?.[0]}" in packed file ${path}`);
  });

console.log(`Package exports, docs, and contents verified against ${files.size} packed files.`);
