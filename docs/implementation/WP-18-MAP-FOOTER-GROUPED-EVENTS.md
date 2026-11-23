# WP-18 — Simplified Map Footer and Consolidated Ocean Timeline

## Changes

- The existing **in-app Leaflet voyage map stays**. The default Leaflet attribution overlay (including Leaflet branding and all bottom-corner links) is disabled.
- Visible **© OpenStreetMap contributors** attribution and an optional map-error-report link are displayed as a small line **directly below** the map, not on top of map geography. Do not remove the OSM credit/link while using public OSM tiles: see https://operations.osmfoundation.org/policies/tiles/ .
- The former outside-map coordinate navigation button, shown in older deployed screenshots as **«فتح الموقع على خريطة خارجية»**, was already removed from source in WP-17. Only the distinct ShipsGo provider-map action remains: **«عرض على ShipsGo»**.
- Frontend map CSS now targets the map heading specifically, not every direct child `div`, preventing a `display:flex` rule from affecting the Leaflet canvas.
- Port translation recognizes the Egyptian port **ALEXANDRIA → الإسكندرية** even when movement entries omit the UN/LOCODE; variants such as PORT OF ALEXANDRIA and EL DEKHEILA are also handled.

## Consolidating per-container events

ShipsGo returns a movement list separately for each container. `groupOceanEvents.ts` groups a single ocean timeline row only when **all** these fields match:

1. the movement type `eventCode` (or description if no type);
2. exact provider time instant (timezone offsets normalized where explicit);
3. estimated versus actual flag;
4. location;
5. vessel name;
6. voyage reference.

Different event types (e.g. vessel arrival and container discharge), different vessels, different times, or actual/estimated events are never merged. Each grouped row lists distinct original container numbers as small tags; a disclosure shows additional numbers when more than five containers share that movement. Original backend provider response and per-container history are untouched.

## Tests

`cd frontend && npm run test:tracking && npm run lint && npm run build`

Tests cover Egypt port translation, required OSM copyright, lack of the external coordinate button, combining two arrival rows with equivalent timezone timestamps, keeping separate arrival/discharge and actual/estimated events, and retaining all container references.

The user screenshot of the **old** external-map button is evidence that the active production frontend was not yet displaying the earlier source update; verify Dokploy deployed the **new branch head** and hard-refresh after rollout. No production access was used to verify live deployment.
