# Atlas A-5 staging integration

This branch ports the Atlas frontend from `THE_MYTH_Atlas_A5_Windows_Staging_994dd21.zip` (SHA-256 `2f1276c9bb09c922c478b59ea0a231a39a652b51bb86ee5a659362ebc5441bd9`) onto GitHub `work` at `549bc927a60a6313f45fa93fb83ab52176a4de7a`. The archive describes source commit `994dd21532407871ecef32d98aa03f66661b3c91`; it is a staging frontend, not a complete Sites source export. The running Site's source and deployment have not been compared with this branch. Do not use this branch to overwrite that Site without first comparing the current Site source and preserving conflicting work.

## Integration and safety

The `본편 > 우주 공간 > 3D 지도` entry mounts the read-only Atlas with active entities and relations. The nine `web/atlas-*.js` modules provide the demo scene, navigation, renderer, 2D city map, and passage panel. `scripts/sync-web-assets.mjs` copies these source files and existing web assets into `public/` for Sites builds. No staging mock, staging preview server, or staging storage keys are included; existing draft/autosave keys remain in use.

Real records are projected for list navigation only. Even when source data has coordinates, `adaptWorld` does not infer an approved coordinate format or assign positions. Real passage records are not connected and are not inferred from archive relations. The 2D real-city view is an unpositioned placeholder plus related existing records. The separately selected demo is an in-memory visualization and is never written to the archive. Demo scenes and routes do not certify current production visuals or behavior.

No database schema, D1/R2 configuration, object IDs, or archive persistence was changed. Future real-data integration requires a separately reviewed coordinate schema and units, spatial hierarchy/ID mapping, passage endpoint, direction, status, agency and time semantics, and city facility positions. Agree on migration/versioning, edit permissions, and handling missing data before connecting storage. Do not generate canonical locations or routes from demonstration fixtures.

## Verification

From the repository root, `npm run install:ci` installs locked build dependencies; `npm run build` builds the Sites app and emits the Atlas modules in `dist/client/`. Run `npm run test:sites`, `node --test tests/atlas-data.test.mjs`, `bash scripts/check.sh`, `python3 scripts/browser_smoke.py`, and `python3 tests/test_atlas_browser.py`. The browser and API tests use temporary local databases and mocked R2, not production storage. Browser tests require Playwright and Chromium with WebGL2 support; some environments require access outside the command sandbox for local networking and Chromium.

## Before any future deployment

In the authorized Work/Sites environment, retrieve the current private Site source and deployed version for project `appgprj_6aedb2ae0c208191ab014ed6d81f2125`. Compare actual code and asset trees against this integration branch, preserve both histories, review conflicts, and verify the approved Atlas behavior and existing archive functions with isolated data. Confirm owner-only access and the existing DB/BUCKET bindings. The previous Site version and whether it matches the staging archive remain unknown. Deploy only after explicit user approval; never seed, reset, or replace production data as a test.
