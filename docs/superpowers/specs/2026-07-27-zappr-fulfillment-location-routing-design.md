# Zappr Fulfillment Location Routing — Design

## Context

Real inventory for Zappr-eligible products is managed inside EasyEcom, not Shopify. Right now every order — whether or not it's fulfilled by Zappr — sits on the same default Shopify location ("Unived VAPI"), and the store owner has no way to see, from Shopify admin alone, which orders are Zappr's responsibility or what stock Zappr actually has on hand.

This feature routes eligible + serviceable orders to a dedicated "Bangalore Zappr" Shopify location (already created in Shopify admin), tags them for easy identification, and keeps that location's Shopify-visible stock count reasonably in sync with EasyEcom — without adding meaningful load to EasyEcom's rate-limited API (500 req/day per x-api-key, shared with storefront checks and tracking polling).

Orders outside Zappr's serviceable pincodes, or for non-eligible products, are untouched — they stay on the default location exactly as today.

## Non-goals

- Two-way sync (Shopify → EasyEcom). EasyEcom is always the source of truth for quantity.
- Real-time inventory sync. "Reasonably fresh" (order-time + 4×/day) is the agreed bar.
- Handling products that are eligible in some warehouses but not others — Zappr eligibility is per-product/variant, not per-region beyond the existing pincode-serviceability check.

## Architecture

### New config

- `ZAPPR_SHOPIFY_LOCATION_ID` (env var) — the Bangalore Zappr location's GID. Resolved once via a `locations` GraphQL query and set manually; it will not change.
- Admin token scope expansion required: `write_orders` (tagging), `write_inventory` (pushing stock counts), `read_locations`. Existing `scripts/get-token.js` OAuth flow is reused once these scopes are added to the app in the Dev Dashboard; the resulting token replaces `SHOPIFY_ADMIN_TOKEN`.

### New table: `zappr_synced_skus`

Tracks which SKUs the periodic sync job should push stock for.

| column | type | notes |
|---|---|---|
| `sku` | varchar, unique | EasyEcom/Shopify SKU |
| `shopify_variant_id` | varchar | for reference/debugging |
| `shopify_inventory_item_id` | varchar | required by `inventorySetQuantities` |
| `last_quantity` | integer, nullable | last quantity pushed to Shopify |
| `last_synced_at` | timestamptz, nullable | |
| `created_at` | timestamptz | |

Populated two ways:

1. **Organic tracking** — `checkAvailability()` (`src/services/availabilityService.js`) and `pushOrderToZappr()` (`src/services/orderService.js`) already compute `zapprEligible` per variant. When true, upsert the SKU (fire-and-forget, must never block or fail the calling request).
2. **Daily backfill** — a scheduled job pages through the Shopify product catalog (`products` GraphQL query, paginated), checks each variant's `custom.zappr_eligible` metafield client-side, and upserts any SKU not already tracked. Deliberately avoids relying on Shopify's metafield-based product search syntax (limited/version-dependent) — plain pagination + client-side filtering is slower but robust.

### Order-time flow

`pushOrderToZappr` is already all-or-nothing per order — if any line item fails the pre-push availability/stock check, the whole order goes to `FALLBACK` and nothing is pushed (existing behavior, unchanged). So by the time status reaches `PUSHED`, every item in that fulfillment order is confirmed Zappr-eligible and serviceable, and moving the entire fulfillment order to the Zappr location is unambiguous — there's no partial/mixed-eligibility case to handle.

Immediately after the order-mapping status is set to `PUSHED` (i.e. the Zappr push itself already succeeded):

1. `fulfillmentOrderMove` mutation — move the order's fulfillment order to `ZAPPR_SHOPIFY_LOCATION_ID`.
2. `tagsAdd` mutation — add the `zappr-fulfillment` tag to the Shopify order.
3. Re-fetch stock for the SKU(s) just sold via the existing `adapter.checkStock` call (piggybacking on the `invalidateStock()` call that already runs at this point) and push the fresh quantity to Shopify via `inventorySetQuantities` at the Zappr location.

**Failure handling:** none of these three steps may throw back into the order-push flow. The order is already correctly pushed to Zappr and will be fulfilled at the courier level regardless of whether Shopify's location/tag/stock display is accurate — a failure here is a cosmetic admin-visibility gap, never a fulfillment problem. Each step is wrapped individually, logs on failure, and the flow continues. FALLBACK/ineligible orders never reach this code path — no location move needed since they're already on the default location.

### Periodic sync job (4×/day)

Reuses the existing `maintenanceQueue` / `maintenanceWorker.js` cron pattern (adds a new `type` discriminator job, no new PM2 process). Schedule: `0 */6 * * *` (every 6 hours).

For each row in `zappr_synced_skus`: call `adapter.checkStock({ zapprSku })` (same call used elsewhere in the codebase), then push the quantity via `inventorySetQuantities` targeting `shopify_inventory_item_id` + `ZAPPR_SHOPIFY_LOCATION_ID`. Update `last_quantity` / `last_synced_at`.

**Budget note:** at 4 runs/day this fits EasyEcom's 500 req/day quota comfortably unless the tracked-SKU count grows very large (roughly: `4 × SKU count` must leave headroom for storefront checks, order pushes, and tracking polls sharing the same quota). Revisit interval or move to a batched/paginated EasyEcom endpoint if the catalog scales up significantly.

### Non-serviceable / non-eligible orders

No change. They're never routed through the new location-move/tag/sync code — they stay on the default "Unived VAPI" location exactly as they do today.

## Testing

- Unit tests for the organic-upsert logic (mock DB, assert upsert called with correct SKU when `zapprEligible: true`, not called otherwise).
- Unit tests for the periodic sync job's SKU-loop → `checkStock` → `inventorySetQuantities` chain (mock adapter + Shopify client), including a case where one SKU's EasyEcom call fails and confirms the loop continues to the next SKU rather than aborting.
- Unit tests for the order-time `fulfillmentOrderMove` + `tagsAdd` + inventory-push calls: confirm they fire only when `status === PUSHED`, confirm a mutation failure doesn't propagate/throw out of `pushOrderToZappr`.
- No new live-order testing required beyond what's already been proven for the base push flow — this only adds Shopify-side calls after an already-verified successful push.
