# WP-13 — ShipsGo Ocean V2 compatibility and secure updates

Implementation: `feature/import-management-mvp`. Source of truth: [ShipsGo official V2 OpenAPI](https://api.shipsgo.com/docs/v2/specs/openapi.json).

## Integration contract
- New activations use `POST https://api.shipsgo.com/v2/ocean/shipments` with `X-Shipsgo-User-Token` header and JSON `reference`, `carrier` (optional SCAC), and `booking_number` **or** `container_number`. A container reference is sent as `container_number` when CT is the first activated reference.
- `GET /ocean/carriers?take=100&skip=...` supplies ACTIVE carriers; cached for 6 hours. The backend validates supplied SCACs before paid POST, not by guessing from shipping-line names.
- Successful `200 SUCCESS` and confirmed `409 ALREADY_EXISTS` both supply `shipment.id`. Save the ID under the `v2:` prefix; it is reused for all subsequent requests and survives subscription renewal. The 409 response is explicitly documented as zero-credit cost.
- Existing numeric V1.2 IDs continue to use the old V1.2 read endpoint and MUST retain `WATHIQA_SHIPSGO_API_KEY` until retired/reconciled. New paid activations require V2 credentials and **never** fall back to V1.2 when the V2 token is absent. No migration, recreation or recharging of old IDs.
- `GET /ocean/shipments/{id}` supplies status, carrier/SCAC, B/L, containers, movement events, original/updated/predicted ETA, ETD, transit progress, transshipment count, CO2, and loading/discharge ports. `GET /ocean/shipments/{id}/geojson` supplies a current point only if a GeoJSON feature is marked `CURRENT`. The separately provided ShipsGo map token is used for a provider map link. No synthetic location or ETA.
- Data are **informational**, not authoritative for customs, payments or order settlement. A B/L with multiple containers shares one tracking credit/ID under the existing business rule; activating by CT first may not capture additional containers not discoverable from that initial registration. Choose B/L for multi-container bills when possible.
- Existing 30-minute manual refresh guard remains; V2 provider updates can additionally be delivered by webhook. No automatic paid polling or unapproved reactivation.

## Deployment configuration
Use Dokploy private environment variables, never Git:
- `WATHIQA_SHIPSGO_V2_TOKEN`: ShipsGo V2 account token (new activations).
- `WATHIQA_SHIPSGO_WEBHOOK_SECRET`: a distinct random shared secret entered in ShipsGo webhook configuration.
- `WATHIQA_SHIPSGO_API_KEY`: V1.2 authCode only for legacy paid records.
Container Compose passes these values to the backend `OceanTracking__...` settings.

Local Development: `.local/shipsgo-v2-token.txt` and `.local/shipsgo-webhook-secret.txt` are supported by `scripts/Start-ImportApi.ps1`. Loopback-only provider override: `OceanTracking__ShipsGoV2TestBaseUrl=http://127.0.0.1:5098/` (Development environment ONLY). API host is fixed in production.

Public production webhook URL through the existing Next.js rewrite: `https://YOUR-DOMAIN/import-api/api/tracking/provider-webhook`. The internal .NET API route remains `/api/tracking/provider-webhook`. Verify that the HTTPS reverse proxy forwards the **raw UTF-8 request bytes** and `X-Shipsgo-Webhook-Signature` header unchanged before enabling the subscription.

Webhook receiver: `POST /api/tracking/provider-webhook` (the **backend API** URL, not an authenticated browser UI page). Configure ShipsGo `OCEAN.SHIPMENTS.SHIPMENT_UPDATED` webhook to deliver to its publicly accessible HTTPS route. The route is the only intentionally CSRF-exempt write route, but requires constant-time verification of `X-Shipsgo-Webhook-Signature` against HMAC-SHA256 of the exact UTF-8 request body. An unconfigured secret rejects callbacks. The name header and payload event must both match. Maximum body size 4 MB. Only previously registered paid V2 IDs are updated, with preservation of existing geographic coordinates and rejection of stale provider timestamps. This does **not** modify payment or customs tables. Register the callback in ShipsGo dashboard manually; the app does not create external subscriptions on behalf of the account.

## Verification
- Backend: `dotnet build backend/Wathiqa.ImportApi --no-restore --verbosity quiet`.
- Contract parser/security tests: `dotnet run --project backend/Wathiqa.ShipsGoContractTests`.
- HTTP protocol test: start `node scripts/Mock-ShipsGoV2-Local.mjs`, set `SHIPSGO_V2_HTTP_TEST=1`, then run the above C# test project; stop the mock afterward.
- Frontend: `cd frontend; npm ci; npm run lint; npm run build`.
- The local HTTP mock **does not prove** a production account's token, available credits, actual carrier support, actual real-world voyage or public webhook delivery. Verify those with a controlled staging rollout, production-approved credentials, backups and a single authorized sample activation before claiming real integration success. Do not run chargeable tests or migrations automatically against Dokploy/VPS.

## Error / safe retry model
- Provider token missing -> no activation.
- Invalid SCAC/B/L format -> reject before paid POST.
- Failed free carrier lookup -> definitive preflight failure; don't leave a paid slot in NeedsReview.
- Paid POST timeout, 429 or unknown response -> NeedsReview without automatic replay; investigate ShipsGo before retrying.
- `POST /api/tracking/{id}/reconcile` is a tenant-authorized, read-only provider reconciliation: search V2 for the exact Wathiqa shipment reference and independently match its B/L or registered container. If exactly one confirmed ID is found, link it without paying or sending a new provider POST. A missing or ambiguous result leaves NeedsReview intact.
- Successful POST followed by failed GET -> retain paid provider ID and retry only GET after the cooldown.
- Signed webhook replay with older/equal provider update timestamp -> no state rollback.
