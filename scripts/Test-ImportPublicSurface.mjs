// WP-09: Validate the actual optimized Next.js production server, not only
// proxy.ts source. Run with scripts/Start-ImportApi.ps1 + Start-Web.ps1 after
// building the frontend. Never target a publicly reachable/production host.
import assert from "node:assert/strict";

const base = "http://127.0.0.1:3000";
let count = 0;
async function check(path, expected, label, location) {
  const response = await fetch(base + path, { redirect: "manual" });
  assert.equal(response.status, expected, `${label}: ${path}`);
  if (location) {
    assert.equal(new URL(response.headers.get("location"), base).pathname, location);
  }
  if (expected === 404) {
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "route_not_available" });
  }
  count++;
  console.log("PASS " + label);
  return response;
}

await check("/", 307, "Public root redirects to import workspace", "/import");
await check("/import/login", 200, "Import login remains public");
await check("/import/orders", 200, "Import application route remains available");
await check("/import-api/api/health", 200, "Import API same-origin proxy remains available");
await check("/import-api/api/companies", 401, "Tenant API enforces authentication");
await check("/editor/template/00000000-0000-0000-0000-000000000000", 404,
  "Old template editor is unavailable in Production");
await check("/api/templates", 404, "Old template API is unavailable in Production");
await check("/api/health", 404, "Legacy API health path does not escape gate");
await check("/importer", 404, "Import route prefix cannot be spoofed");
// Next.js normalizes old /_next/data URLs before Proxy routing. A 307 with
// x-nextjs-redirect to the import app is also safe; it must NOT return the
// former editor's data or expose a legacy response with status 200.
const legacyData = await fetch(base + "/_next/data/legacy.json", { redirect: "manual" });
assert([307, 404].includes(legacyData.status), "Legacy data URL unexpectedly resolved");
if (legacyData.status === 307) {
  assert.match(legacyData.headers.get("x-nextjs-redirect") ?? "", /^\/_next\/data\/[^/]+\/import\.json$/);
}
count++;
console.log("PASS Legacy Next.js data URL cannot retrieve editor data");
await check("/icon.svg", 200, "Brand icon remains accessible");

const html = await (await fetch(base + "/import/login")).text();
const asset = html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/);
assert(asset, "Import login must contain a Next.js asset URL");
await check(asset[1].replaceAll("&amp;", "&"), 200, "Static assets remain accessible");

console.log("WP09_PUBLIC_SURFACE_PASS_COUNT=" + count);
