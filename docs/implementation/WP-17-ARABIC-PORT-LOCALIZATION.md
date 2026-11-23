# WP-17 — Arabic Port Localization, Voyage Dates and Map Actions

## Overview
ShipsGo's API continues to supply the original port names, UN/LOCODE location codes, shipment IDs and event codes. Wathiqa translates only their **display** in the UI, without modifying the provider data, subscription credits, shipment records, or database schema.

### Arabic port names (offline at runtime)
Lookup order in `frontend/src/lib/trackingArabic.ts`:
1. Reviewed port-specific override keyed by the exact five-character UN/LOCODE: `portArabicOverrides.ts`.
2. A committed **935-entry** Arabic UN/LOCODE/Arabic-label snapshot sourced from Wikidata CC0 (property P1937 and Arabic entity labels): `portArabicWikidata.json`.
3. Human-reviewed common-name aliases only when the carrier's country prefix is compatible; prevents confusing same-named places in different countries.
4. A local, approximate Latin → Arabic phonetic fallback that is **explicitly labeled as approximate** and displays the original name alongside it.

No translation provider is called during runtime, and no B/L or customer data is sent to a translator. The snapshot can be regenerated during development with `frontend/scripts/build-arabic-port-index.mjs` from SPARQL JSON source exports. Reference query:
```sparql
SELECT ?locode ?ar WHERE {
  ?item wdt:P1937 ?locode; rdfs:label ?ar.
  FILTER(LANG(?ar) = "ar")
}
```
Use the Wikidata Query Service with a reasonable page size and rate limit, save results into local development files and run the generator with those files. The generator rejects nonstandard codes and invalid Arabic labels and omits ambiguous aliases. **Do not redistribute UNECE's complete raw UN/LOCODE database** as a substitute for this CC0 source: that dataset has different usage terms.

Wikidata can be incomplete or have inconsistent source names, so the reviewed overrides win. Phonetic results are not authoritative translations; the UI always retains the provider's original code and name for confirmation. Translation cannot be guaranteed for every place in the world.

### Voyage ETA and timestamps
The port-of-discharge `date_of_discharge` is a **calendar date** for the carrier's estimated discharge, not a precise vessel arrival time. Wathiqa shows it as the primary estimated date. When missing, it falls back to `date_of_discharge_predicted` (ShipsGo model) or the initial declared date, with source indicated. `date_of_discharge_predicted` is optional and may be empty despite a valid primary estimated date. For shipment dates, show only the calendar date, avoiding UTC-to-browser timezone day shift and fake midnight. Real synchronization/event timestamps continue to include a time.

### Map and navigation
- Within Wathiqa, keep the embedded voyage map drawn from GeoJSON returned by ShipsGo.
- **Remove** the button linking to an external OpenStreetMap coordinate page.
- Keep a **single** action labeled **«عرض على ShipsGo»** linking to the provider's map token URL when supplied.
- If the provider supplies no GeoJSON route, do not draw a fabricated sea path between ports. If only points are supplied, show the points with an Arabic explanation. Provider-side `SHIPSGO_V2_GEOJSON` console events report `ROUTE_RECEIVED`, `WAYPOINTS_ONLY`, `EMPTY`, `UNAVAILABLE` or `UNEXPECTED_RESPONSE`, without secrets or B/L numbers.

### Verification
```bash
cd frontend
npm run test:tracking
npm run lint
npm run build
cd ..
dotnet build Wathiqa.slnx --configuration Release
dotnet run --project backend/Wathiqa.ShipsGoContractTests --configuration Release
```
The map's full route depends on ShipsGo's live Ocean API GeoJSON and access permissions. Local unit tests do not establish that the provider returned GeoJSON for a specific production shipment. Check `OUTBOUND_HTTP` and `SHIPSGO_V2_GEOJSON` in Docker Console Logs to diagnose missing lines, without creating another paid tracking request.
