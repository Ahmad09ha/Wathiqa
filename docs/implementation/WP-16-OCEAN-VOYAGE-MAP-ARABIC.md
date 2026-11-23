# WP-16 — Embedded Ocean Voyage Map + Arabic Tracking Presentation

## Why this change was needed

ShipsGo's account dashboard can show a **SAILING** shipment while Wathiqa displays the first stored **NEW** API response. The original Wathiqa throttle prevented refreshing any tracking reference for 30 minutes, even though its paid provider shipment ID had already been saved.

The updated code distinguishes:
- **New paid registration**: existing reservation / credit protection and 30-minute attempt throttle remain intact; no automatic retry of an ambiguous POST.
- **Existing paid registration** (an established provider request ID): refresh uses **read-only GET** on the same provider ID, with a **one-minute throttle** rather than 30 minutes. This retrieves updated route details without another create/chargeable POST.
- The last persisted provider response remains available until an updated successful fetch.
- `SHIPSGO_V2_SNAPSHOT` structured console output shows the provider status, number of containers, movement count and whether a route was returned, without printing B/L, token or customer data. If the app still displays NEW after GET, check whether ShipsGo's Ocean API is lagging its dashboard rather than guessing that the parser failed.

## Map inside Wathiqa

Backend: `ShipsGoV2Client.ParseGeoJson` reads the documented `GET /ocean/shipments/{id}/geojson` feature collection. It extracts:
- `Point` features for origin, destination and intermediate waypoints;
- `LineString` features for `PAST`, `CURRENT` and `FUTURE` sea route portions;
- the `properties.current.coordinates` within a `CURRENT` LineString (or a `CURRENT` Point) for an actual provider-supplied current position.
- coordinates are converted from GeoJSON `[longitude, latitude]` into named latitude/longitude fields and validated; 100 features, 500 points per segment, 3000 total points maximum bound response processing.

Frontend: `TrackingVoyageMap.tsx` displays a native interactive Leaflet map inside the tracking panel, using OpenStreetMap tiles. It draws past and current segments as solid lines, future segments as dashed lines, and labels port waypoints in Arabic. Current position appears **only when the provider supplies coordinates**; no invented live vessel position. If GeoJSON is unavailable, a clear Arabic message is shown and the official ShipsGo map link remains as a fallback if supplied. OpenStreetMap tiles are obtained from OSM infrastructure and require browser access; observe OSM tile usage policy and consider a commercial/self-hosted tile service for very high traffic.

## Arabic translation

`frontend/src/lib/trackingArabic.ts` maps all documented ShipsGo Ocean V2 shipment status values and movement event codes to Arabic, plus container types, map phases and selected port aliases (including ZHAPU -> تشابو, ISKENDERUN -> إسكندرون). Technical references (B/L, container numbers, SCAC, voyage numbers, vessel and shipping company **proper names**) remain unchanged. Port names not included in the curated dictionary remain in their official form rather than displaying a wrong translation; expand the mapping as real-world routes appear. API field labels and known error codes appear in Arabic as well.

This is presentation-only. The underlying provider payloads, request IDs, event codes, prices/credits and shipping documents do not change.

## Testing

```powershell
dotnet build Wathiqa.slnx --configuration Release
dotnet run --project backend/Wathiqa.ShipsGoContractTests --configuration Release
cd frontend
npm run test:tracking
npm run lint
npm run build
```

For the local mock HTTP integration test, start `node scripts/Mock-ShipsGoV2-Local.mjs` and run the C# contract suite with `SHIPSGO_V2_HTTP_TEST=1`. This exercises the GET + GeoJSON parsing path without any actual ShipsGo credentials or paid registrations.

## Production verification (after deploy)

1. Confirm the backend is serving the new code and the existing shipment's provider request ID was previously activated.
2. On a reference with a stored NEW status, wait at least one minute since the last successful sync; click **تحديث من شركة الشحن** once. This executes GET for the existing tracking ID, not a new registration.
3. In Dokploy → API Logs, inspect `OUTBOUND_HTTP` for GET shipment and GeoJSON plus `SHIPSGO_V2_SNAPSHOT` status and movement count. Do not share credentials or API tokens.
4. Confirm the voyage dates/ports match ShipsGo and Arabic labels appear, then inspect the embedded map. Lack of provider coordinates must **never** be displayed as a live vessel position.

If ShipsGo API still reports NEW while its UI reports SAILING, compare the same provider ID and connected account with ShipsGo support; do not create an additional paid shipment just to force data.
