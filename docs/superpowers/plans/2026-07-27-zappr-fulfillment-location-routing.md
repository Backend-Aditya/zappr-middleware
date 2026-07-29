# Zappr Fulfillment Location Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Zappr-eligible + Zappr-serviceable Shopify orders to a dedicated "Bangalore Zappr" fulfillment location, tag them `zappr-fulfillment`, and keep that location's Shopify inventory roughly in sync with EasyEcom (organic tracking + daily catalog scan + order-time push + 4×/day periodic sync).

**Architecture:** All new logic lives behind a single non-throwing side-effect call (`syncShopifyZapprSideEffects`) invoked from the existing `pushOrderToZappr` right after an order reaches `PUSHED` — it never affects whether the Zappr push itself succeeds. A new Postgres table (`zappr_synced_skus`) tracks which SKUs the periodic job should sync. Three new small Shopify API wrapper files (`orders.js`, `inventory.js`, an addition to `fulfillment.js`) each own one GraphQL mutation. The periodic sync and daily catalog scan reuse the existing `maintenanceQueue`/`maintenanceWorker.js` cron pattern — no new PM2 process.

**Tech Stack:** Node.js, Express 5, Drizzle ORM (Postgres), BullMQ (Redis-backed), ky (HTTP), Vitest.

## Global Constraints

- EasyEcom API is rate-limited: 500 requests/day, 5/sec, per x-api-key — shared with storefront checks, order pushes, and tracking polling. The periodic sync job runs at most 4×/day; never increase that frequency without re-checking this budget against current tracked-SKU count.
- Nothing in this feature may ever cause `pushOrderToZappr` to throw or roll back an already-successful Zappr push. Every new Shopify-side call (location move, tag, inventory push) is wrapped so a failure only logs — the real order fulfillment must never be blocked by a cosmetic Shopify-admin-visibility failure.
- Non-eligible or non-serviceable orders (i.e. anything that reaches `FALLBACK`) must never be touched by any of the new code paths — they stay on the default Shopify location exactly as today.
- Follow the existing project conventions: `createLogger(...)` per module, JSDoc on every exported function, `drizzle-orm`'s `eq`/`sql` helpers, ky for HTTP, one responsibility per file.
- `ZAPPR_SHOPIFY_LOCATION_ID` is optional at the env-schema level — every new code path must no-op gracefully (not throw) when it's unset, since the location ID is resolved manually as a one-time setup step, not derivable at boot.

---

### Task 1: Schema, config, and location-ID lookup script

**Files:**
- Modify: `src/db/postgres/schema.js` — add `zapprSyncedSkus` table
- Create: `src/db/postgres/migrations/<generated>.sql` (via `npm run migrate:generate`, not hand-written)
- Modify: `src/config/env.js` — add `ZAPPR_SHOPIFY_LOCATION_ID`
- Modify: `.env.example` — document the new var
- Create: `scripts/get-location-id.js` — one-off script to list Shopify locations and their GIDs

**Interfaces:**
- Produces: `zapprSyncedSkus` Drizzle table export (columns: `id`, `sku`, `shopifyVariantId`, `shopifyInventoryItemId`, `lastQuantity`, `lastSyncedAt`, `createdAt`) — consumed by Task 2's service.
- Produces: `env.ZAPPR_SHOPIFY_LOCATION_ID` (`string | undefined`) — consumed by Tasks 5 and 7.

- [ ] **Step 1: Add the table to schema.js**

Add this table definition to `src/db/postgres/schema.js`, after the existing `zapprLogs` table (end of file):

```js
// Tracks which SKUs the periodic Zappr-inventory-sync job pushes stock for.
// Populated organically (order push) and by the daily catalog scan.
export const zapprSyncedSkus = pgTable(
  'zappr_synced_skus',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    sku: varchar('sku', { length: 128 }).notNull().unique(),
    shopifyVariantId: varchar('shopify_variant_id', { length: 128 }).notNull(),
    shopifyInventoryItemId: varchar('shopify_inventory_item_id', { length: 128 }).notNull(),
    lastQuantity: integer('last_quantity'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  },
  (t) => [
    index('idx_zappr_synced_skus_sku').on(t.sku),
  ],
)
```

No new imports are needed — `pgTable`, `uuid`, `varchar`, `integer`, `timestamp`, `index`, `sql`, and the local `now()` helper are already imported/defined at the top of `schema.js`.

- [ ] **Step 2: Generate the migration**

Run: `npm run migrate:generate`

This introspects `schema.js` against the existing migration history (no live DB connection needed) and writes a new file under `src/db/postgres/migrations/`. Open the generated `.sql` file and confirm it contains a single `CREATE TABLE "zappr_synced_skus"` statement with the columns above — nothing else should have changed.

- [ ] **Step 3: Add the env var**

In `src/config/env.js`, add this line directly after `ZAPPR_CARRIER_ID`:

```js
    ZAPPR_CARRIER_ID: z.coerce.number().int().positive().optional(),
    // Bangalore Zappr Shopify location GID — resolve once with
    // scripts/get-location-id.js, then set manually; it will not change.
    ZAPPR_SHOPIFY_LOCATION_ID: z.string().optional(),
```

In `.env.example`, add directly after the `ZAPPR_CARRIER_ID=` line:

```
# Bangalore Zappr Shopify location GID — resolve with scripts/get-location-id.js
ZAPPR_SHOPIFY_LOCATION_ID=
```

- [ ] **Step 4: Write the location-lookup script**

Create `scripts/get-location-id.js`:

```js
/**
 * One-off: list Shopify locations and their GIDs so ZAPPR_SHOPIFY_LOCATION_ID
 * can be set correctly. Run: node scripts/get-location-id.js
 */
import 'dotenv/config'
import ky from 'ky'

const STORE = process.env.SHOPIFY_STORE
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN

if (!STORE || !TOKEN) {
  console.error('Set SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN in .env first (see scripts/get-token.js).')
  process.exit(1)
}

const query = '{ locations(first: 20) { nodes { id name isActive } } }'

const res = await ky.post(`https://${STORE}/admin/api/2025-01/graphql.json`, {
  headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
  json: { query },
}).json()

if (res.errors?.length) {
  console.error('GraphQL errors:', res.errors)
  process.exit(1)
}

console.log('Locations:')
for (const loc of res.data.locations.nodes) {
  console.log(`  ${loc.id}  ${loc.name}  ${loc.isActive ? '(active)' : '(inactive)'}`)
}
console.log('\nCopy the "Bangalore Zappr" location id into ZAPPR_SHOPIFY_LOCATION_ID in .env')
```

- [ ] **Step 5: Verify**

Run: `node --check src/config/env.js && node --check scripts/get-location-id.js`
Expected: no output (syntax OK).

Run: `npm test`
Expected: all existing tests still pass (this task adds no new test files — schema/config changes are additive and covered by the fact that env schema validation already happens at boot for every test run via `tests/setup.js`).

- [ ] **Step 6: Commit**

```bash
git add src/db/postgres/schema.js src/db/postgres/migrations src/config/env.js .env.example scripts/get-location-id.js
git commit -m "Add zappr_synced_skus table, ZAPPR_SHOPIFY_LOCATION_ID config, location lookup script"
```

---

### Task 2: SKU-tracking service

**Files:**
- Create: `src/services/zapprInventorySyncService.js`
- Test: `tests/unit/zapprInventorySyncService.test.js`

**Interfaces:**
- Consumes: `zapprSyncedSkus` table from Task 1 (`src/db/postgres/schema.js`).
- Produces: `trackEligibleSku({ sku, shopifyVariantId, shopifyInventoryItemId }): Promise<void>`, `getTrackedSkus(): Promise<Array<{ sku: string, shopifyInventoryItemId: string }>>`, `recordSyncedQuantity(sku: string, quantity: number): Promise<void>` — consumed by Tasks 5, 6, and 7.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/zapprInventorySyncService.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { inserted: [], conflictSets: [], updated: [], selectResult: [] }

vi.mock('../../src/db/postgres/connection.js', () => ({
  getDb: () => ({
    insert: () => ({
      values: (v) => ({
        onConflictDoUpdate: ({ set }) => {
          state.inserted.push(v)
          state.conflictSets.push(set)
          return Promise.resolve()
        },
      }),
    }),
    select: () => ({
      from: () => Promise.resolve(state.selectResult),
    }),
    update: () => ({
      set: (v) => ({
        where: () => {
          state.updated.push(v)
          return Promise.resolve()
        },
      }),
    }),
  }),
}))

const { trackEligibleSku, getTrackedSkus, recordSyncedQuantity } = await import('../../src/services/zapprInventorySyncService.js')

beforeEach(() => {
  state.inserted.length = 0
  state.conflictSets.length = 0
  state.updated.length = 0
  state.selectResult = []
})

describe('trackEligibleSku', () => {
  it('upserts the SKU with variant and inventory item ids', async () => {
    await trackEligibleSku({ sku: 'SKU-1', shopifyVariantId: 'gid://shopify/ProductVariant/1', shopifyInventoryItemId: 'gid://shopify/InventoryItem/1' })

    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0]).toEqual({
      sku: 'SKU-1',
      shopifyVariantId: 'gid://shopify/ProductVariant/1',
      shopifyInventoryItemId: 'gid://shopify/InventoryItem/1',
    })
  })

  it('does nothing when sku or inventory item id is missing', async () => {
    await trackEligibleSku({ sku: '', shopifyVariantId: 'v', shopifyInventoryItemId: 'i' })
    await trackEligibleSku({ sku: 'SKU-2', shopifyVariantId: 'v', shopifyInventoryItemId: '' })

    expect(state.inserted).toHaveLength(0)
  })
})

describe('getTrackedSkus', () => {
  it('returns the tracked SKU list', async () => {
    state.selectResult = [{ sku: 'SKU-1', shopifyInventoryItemId: 'gid://shopify/InventoryItem/1' }]
    const result = await getTrackedSkus()
    expect(result).toEqual(state.selectResult)
  })
})

describe('recordSyncedQuantity', () => {
  it('updates lastQuantity and lastSyncedAt', async () => {
    await recordSyncedQuantity('SKU-1', 42)
    expect(state.updated).toHaveLength(1)
    expect(state.updated[0].lastQuantity).toBe(42)
    expect(state.updated[0].lastSyncedAt).toBeInstanceOf(Date)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/zapprInventorySyncService.test.js`
Expected: FAIL — `Cannot find module '../../src/services/zapprInventorySyncService.js'`

- [ ] **Step 3: Write the implementation**

Create `src/services/zapprInventorySyncService.js`:

```js
import { eq } from 'drizzle-orm'
import { getDb } from '../db/postgres/connection.js'
import { zapprSyncedSkus } from '../db/postgres/schema.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('zappr-inventory-sync-service')

/**
 * Track a SKU for periodic Shopify inventory sync. Upsert — safe to call
 * repeatedly (e.g. on every order push for the same SKU).
 * @param {{ sku: string, shopifyVariantId: string, shopifyInventoryItemId: string }} opts
 * @returns {Promise<void>}
 */
export async function trackEligibleSku({ sku, shopifyVariantId, shopifyInventoryItemId }) {
  if (!sku || !shopifyInventoryItemId) return

  await getDb().insert(zapprSyncedSkus)
    .values({ sku, shopifyVariantId, shopifyInventoryItemId })
    .onConflictDoUpdate({
      target: zapprSyncedSkus.sku,
      set: { shopifyVariantId, shopifyInventoryItemId },
    })

  log.info({ sku }, 'SKU tracked for Zappr inventory sync')
}

/**
 * @returns {Promise<Array<{ sku: string, shopifyInventoryItemId: string }>>}
 */
export async function getTrackedSkus() {
  return getDb().select({
    sku: zapprSyncedSkus.sku,
    shopifyInventoryItemId: zapprSyncedSkus.shopifyInventoryItemId,
  }).from(zapprSyncedSkus)
}

/**
 * Record the quantity last pushed to Shopify for a SKU.
 * @param {string} sku
 * @param {number} quantity
 * @returns {Promise<void>}
 */
export async function recordSyncedQuantity(sku, quantity) {
  await getDb().update(zapprSyncedSkus)
    .set({ lastQuantity: quantity, lastSyncedAt: new Date() })
    .where(eq(zapprSyncedSkus.sku, sku))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/zapprInventorySyncService.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: all tests pass; no new lint errors (pre-existing JSDoc `@returns` description warnings elsewhere in the repo are expected and not something this task fixes).

- [ ] **Step 6: Commit**

```bash
git add src/services/zapprInventorySyncService.js tests/unit/zapprInventorySyncService.test.js
git commit -m "Add zappr inventory sync tracking service"
```

---

### Task 3: Shopify mutation helpers (move, tag, set inventory)

**Files:**
- Modify: `src/shopify/fulfillment.js` — add `moveFulfillmentOrder`
- Create: `src/shopify/orders.js` — `addOrderTags`
- Create: `src/shopify/inventory.js` — `setInventoryQuantity`
- Test: `tests/unit/shopifyMutations.test.js`

**Interfaces:**
- Consumes: `shopifyGraphql(query, variables)` from `src/shopify/graphql.js` (existing, unchanged).
- Produces: `moveFulfillmentOrder({ fulfillmentOrderId, locationId }): Promise<void>`, `addOrderTags({ orderId, tags }): Promise<void>`, `setInventoryQuantity({ inventoryItemId, locationId, quantity }): Promise<void>` — all consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/shopifyMutations.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGraphql = vi.fn()
vi.mock('../../src/shopify/graphql.js', () => ({
  shopifyGraphql: (...args) => mockGraphql(...args),
}))

const { moveFulfillmentOrder } = await import('../../src/shopify/fulfillment.js')
const { addOrderTags } = await import('../../src/shopify/orders.js')
const { setInventoryQuantity } = await import('../../src/shopify/inventory.js')

beforeEach(() => {
  mockGraphql.mockReset()
})

describe('moveFulfillmentOrder', () => {
  it('calls fulfillmentOrderMove with the right variables', async () => {
    mockGraphql.mockResolvedValue({ fulfillmentOrderMove: { movedFulfillmentOrder: { id: 'fo-1' }, userErrors: [] } })

    await moveFulfillmentOrder({ fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1', locationId: 'gid://shopify/Location/1' })

    expect(mockGraphql).toHaveBeenCalledWith(
      expect.stringContaining('fulfillmentOrderMove'),
      { id: 'gid://shopify/FulfillmentOrder/1', newLocationId: 'gid://shopify/Location/1' },
    )
  })

  it('throws on userErrors', async () => {
    mockGraphql.mockResolvedValue({ fulfillmentOrderMove: { movedFulfillmentOrder: null, userErrors: [{ field: 'id', message: 'not found' }] } })

    await expect(moveFulfillmentOrder({ fulfillmentOrderId: 'fo-1', locationId: 'loc-1' })).rejects.toThrow(/not found/)
  })
})

describe('addOrderTags', () => {
  it('calls tagsAdd with the right variables', async () => {
    mockGraphql.mockResolvedValue({ tagsAdd: { node: { id: 'order-1' }, userErrors: [] } })

    await addOrderTags({ orderId: 'gid://shopify/Order/1', tags: ['zappr-fulfillment'] })

    expect(mockGraphql).toHaveBeenCalledWith(
      expect.stringContaining('tagsAdd'),
      { id: 'gid://shopify/Order/1', tags: ['zappr-fulfillment'] },
    )
  })

  it('throws on userErrors', async () => {
    mockGraphql.mockResolvedValue({ tagsAdd: { node: null, userErrors: [{ field: 'id', message: 'bad id' }] } })

    await expect(addOrderTags({ orderId: 'order-1', tags: ['x'] })).rejects.toThrow(/bad id/)
  })
})

describe('setInventoryQuantity', () => {
  it('calls inventorySetQuantities with the right variables', async () => {
    mockGraphql.mockResolvedValue({ inventorySetQuantities: { inventoryAdjustmentGroup: { id: 'adj-1' }, userErrors: [] } })

    await setInventoryQuantity({ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/1', quantity: 42 })

    expect(mockGraphql).toHaveBeenCalledWith(
      expect.stringContaining('inventorySetQuantities'),
      {
        input: {
          name: 'available',
          reason: 'correction',
          ignoreCompareQuantity: true,
          quantities: [{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/1', quantity: 42 }],
        },
      },
    )
  })

  it('throws on userErrors', async () => {
    mockGraphql.mockResolvedValue({ inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: 'quantity', message: 'invalid' }] } })

    await expect(setInventoryQuantity({ inventoryItemId: 'i', locationId: 'l', quantity: -1 })).rejects.toThrow(/invalid/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/shopifyMutations.test.js`
Expected: FAIL — `addOrderTags`/`setInventoryQuantity` modules don't exist yet, and `moveFulfillmentOrder` isn't exported from `fulfillment.js` yet.

- [ ] **Step 3: Add `moveFulfillmentOrder` to `fulfillment.js`**

In `src/shopify/fulfillment.js`, add this mutation constant after `UPDATE_TRACKING` (before the `getFulfillmentOrders` function):

```js
const MOVE_FULFILLMENT_ORDER = /* GraphQL */ `
  mutation FulfillmentOrderMove($id: ID!, $newLocationId: ID!) {
    fulfillmentOrderMove(id: $id, newLocationId: $newLocationId) {
      movedFulfillmentOrder {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`
```

Then add this function at the end of the file:

```js
/**
 * Move a fulfillment order to a different Shopify location — used to route
 * Zappr-eligible orders to the Zappr-managed location.
 * @param {{ fulfillmentOrderId: string, locationId: string }} opts
 * @returns {Promise<void>}
 */
export async function moveFulfillmentOrder({ fulfillmentOrderId, locationId }) {
  const data = await shopifyGraphql(MOVE_FULFILLMENT_ORDER, {
    id: fulfillmentOrderId,
    newLocationId: locationId,
  })

  const { userErrors } = data.fulfillmentOrderMove
  if (userErrors?.length) {
    log.error({ userErrors }, 'FulfillmentOrderMove userErrors')
    throw new Error(`FulfillmentOrderMove failed: ${userErrors.map((e) => e.message).join(', ')}`)
  }
}
```

- [ ] **Step 4: Create `src/shopify/orders.js`**

```js
import { shopifyGraphql } from './graphql.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('shopify-orders')

const TAGS_ADD = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`

/**
 * Add tags to a Shopify order (or any taggable node).
 * @param {{ orderId: string, tags: string[] }} opts
 * @returns {Promise<void>}
 */
export async function addOrderTags({ orderId, tags }) {
  const data = await shopifyGraphql(TAGS_ADD, { id: orderId, tags })

  const { userErrors } = data.tagsAdd
  if (userErrors?.length) {
    log.error({ userErrors }, 'TagsAdd userErrors')
    throw new Error(`TagsAdd failed: ${userErrors.map((e) => e.message).join(', ')}`)
  }
}
```

- [ ] **Step 5: Create `src/shopify/inventory.js`**

```js
import { shopifyGraphql } from './graphql.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('shopify-inventory')

const INVENTORY_SET_QUANTITIES = /* GraphQL */ `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`

/**
 * Set the "available" quantity for a SKU's inventory item at a specific
 * Shopify location — used to mirror EasyEcom's stock count for the Zappr
 * location so the store owner can see it directly in Shopify admin.
 * @param {{ inventoryItemId: string, locationId: string, quantity: number }} opts
 * @returns {Promise<void>}
 */
export async function setInventoryQuantity({ inventoryItemId, locationId, quantity }) {
  const data = await shopifyGraphql(INVENTORY_SET_QUANTITIES, {
    input: {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: true,
      quantities: [{ inventoryItemId, locationId, quantity }],
    },
  })

  const { userErrors } = data.inventorySetQuantities
  if (userErrors?.length) {
    log.error({ userErrors }, 'InventorySetQuantities userErrors')
    throw new Error(`InventorySetQuantities failed: ${userErrors.map((e) => e.message).join(', ')}`)
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/shopifyMutations.test.js`
Expected: PASS (6 tests)

- [ ] **Step 7: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: all tests pass; no new lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/shopify/fulfillment.js src/shopify/orders.js src/shopify/inventory.js tests/unit/shopifyMutations.test.js
git commit -m "Add Shopify mutation helpers: move fulfillment order, tag order, set inventory quantity"
```

---

### Task 4: Extend the fulfillment-order query with inventory item IDs

**Files:**
- Modify: `src/shopify/queries/getFulfillmentOrders.js`

**Interfaces:**
- Produces: each line item's `variant` now also carries `inventoryItem { id }` — consumed by Task 5.

- [ ] **Step 1: Add `inventoryItem { id }` to the variant selection**

In `src/shopify/queries/getFulfillmentOrders.js`, inside the `variant { ... }` block (which currently has `id`, `price`, `metafield`, `product`), add `inventoryItem { id }` right after `price`:

```js
              variant {
                id
                price
                inventoryItem {
                  id
                }
                metafield(namespace: "custom", key: "zappr_eligible") {
                  value
                }
                product {
                  metafield(namespace: "custom", key: "zappr_eligible") {
                    value
                  }
                }
              }
```

- [ ] **Step 2: Verify**

Run: `node --check src/shopify/queries/getFulfillmentOrders.js`
Expected: no output (syntax OK — this file is a plain template-string export, so this mainly guards against a stray typo breaking the module load).

Run: `npm test`
Expected: all existing tests pass unchanged (`tests/unit/orderService.test.js`'s `fulfillmentOrderFixture` helper builds its own fixture object independent of this query string, so it isn't affected by this query-text change).

- [ ] **Step 3: Commit**

```bash
git add src/shopify/queries/getFulfillmentOrders.js
git commit -m "Fetch inventory item id per line item for Zappr inventory sync"
```

---

### Task 5: Wire order-time Shopify side effects into pushOrderToZappr

**Files:**
- Modify: `src/services/orderService.js`
- Modify: `tests/unit/orderService.test.js`

**Interfaces:**
- Consumes: `moveFulfillmentOrder`, `addOrderTags` (Task 3), `setInventoryQuantity` (Task 3), `trackEligibleSku`/`recordSyncedQuantity` (Task 2), `env.ZAPPR_SHOPIFY_LOCATION_ID` (Task 1), `variant.inventoryItem.id` on fulfillment-order line items (Task 4).
- Produces: no new exports — this task changes `pushOrderToZappr`'s internal behavior only. Existing callers (`orderPushWorker.js`) are unaffected.

- [ ] **Step 1: Update the shared test fixture to include an inventory item id**

The existing `fulfillmentOrderFixture` helper in `tests/unit/orderService.test.js` builds a `variant` object without `inventoryItem` — every new test in this task needs one present, and it's harmless to the existing tests (they never inspect that field). Find this in the fixture (inside the `lineItems.nodes` array):

```js
              variant: { id: 'gid://shopify/ProductVariant/1', price: '1.00', metafield: { value: 'true' } },
```

Replace it with:

```js
              variant: { id: 'gid://shopify/ProductVariant/1', price: '1.00', inventoryItem: { id: `gid://shopify/InventoryItem/${sku}` }, metafield: { value: 'true' } },
```

(`sku` is already a parameter of `fulfillmentOrderFixture(shopifyOrderId, sku, quantity)` and in scope at that line.)

- [ ] **Step 2: Write the failing test**

Add this to `tests/unit/orderService.test.js`. First, extend the existing mocks at the top of the file — add these three new `vi.mock` blocks near the existing ones (after the `vi.mock('../../src/queue/queues.js', ...)` block):

```js
const shopifySideEffects = { moved: [], tagged: [], inventorySet: [] }
vi.mock('../../src/shopify/fulfillment.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    moveFulfillmentOrder: vi.fn(async (opts) => { shopifySideEffects.moved.push(opts) }),
  }
})
vi.mock('../../src/shopify/orders.js', () => ({
  addOrderTags: vi.fn(async (opts) => { shopifySideEffects.tagged.push(opts) }),
}))
vi.mock('../../src/shopify/inventory.js', () => ({
  setInventoryQuantity: vi.fn(async (opts) => { shopifySideEffects.inventorySet.push(opts) }),
}))
vi.mock('../../src/services/zapprInventorySyncService.js', () => ({
  trackEligibleSku: vi.fn(async () => {}),
  recordSyncedQuantity: vi.fn(async () => {}),
}))
```

Note: the existing `vi.mock('../../src/shopify/fulfillment.js', () => ({ getFulfillmentOrders: vi.fn() }))` block must be replaced by the one above (it now needs to preserve `getFulfillmentOrders` via `importOriginal` while also mocking `moveFulfillmentOrder`) — remove the old block and use only the new one.

Then add this new `describe` block at the end of the file:

```js
describe('pushOrderToZappr — Shopify side effects on successful push', () => {
  it('moves the fulfillment order, tags the order, and syncs inventory for each SKU', async () => {
    shopifySideEffects.moved.length = 0
    shopifySideEffects.tagged.length = 0
    shopifySideEffects.inventorySet.length = 0

    process.env.ZAPPR_SHOPIFY_LOCATION_ID = 'gid://shopify/Location/999'

    getFulfillmentOrders.mockResolvedValue(fulfillmentOrderFixture('4001', 'SKU-6', 1))

    const adapter = makeAdapter({
      stockBySku: { 'SKU-6': { available: true, quantity: 10 } },
      createOrderImpl: async () => ({ zapprOrderId: 'ref', estimatedDelivery: null, easyEcomOrderId: '1', invoiceId: '1' }),
    })

    await pushOrderToZappr({ shopifyOrderId: '4001' }, adapter)

    expect(shopifySideEffects.moved).toHaveLength(1)
    expect(shopifySideEffects.moved[0].locationId).toBe('gid://shopify/Location/999')
    expect(shopifySideEffects.tagged).toHaveLength(1)
    expect(shopifySideEffects.tagged[0].tags).toEqual(['zappr-fulfillment'])
    expect(shopifySideEffects.inventorySet).toHaveLength(1)
    expect(shopifySideEffects.inventorySet[0].quantity).toBe(10)

    delete process.env.ZAPPR_SHOPIFY_LOCATION_ID
  })

  it('does nothing when ZAPPR_SHOPIFY_LOCATION_ID is unset', async () => {
    shopifySideEffects.moved.length = 0
    delete process.env.ZAPPR_SHOPIFY_LOCATION_ID

    getFulfillmentOrders.mockResolvedValue(fulfillmentOrderFixture('4002', 'SKU-7', 1))
    const adapter = makeAdapter({
      stockBySku: { 'SKU-7': { available: true, quantity: 5 } },
      createOrderImpl: async () => ({ zapprOrderId: 'ref', estimatedDelivery: null, easyEcomOrderId: '1', invoiceId: '1' }),
    })

    await pushOrderToZappr({ shopifyOrderId: '4002' }, adapter)

    expect(shopifySideEffects.moved).toHaveLength(0)
  })

  it('does not throw when a Shopify side-effect call fails', async () => {
    const { moveFulfillmentOrder } = await import('../../src/shopify/fulfillment.js')
    moveFulfillmentOrder.mockRejectedValueOnce(new Error('Shopify is down'))
    process.env.ZAPPR_SHOPIFY_LOCATION_ID = 'gid://shopify/Location/999'

    getFulfillmentOrders.mockResolvedValue(fulfillmentOrderFixture('4003', 'SKU-8', 1))
    const adapter = makeAdapter({
      stockBySku: { 'SKU-8': { available: true, quantity: 5 } },
      createOrderImpl: async () => ({ zapprOrderId: 'ref', estimatedDelivery: null, easyEcomOrderId: '1', invoiceId: '1' }),
    })

    await expect(pushOrderToZappr({ shopifyOrderId: '4003' }, adapter)).resolves.toBeUndefined()

    delete process.env.ZAPPR_SHOPIFY_LOCATION_ID
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/orderService.test.js`
Expected: FAIL — `moveFulfillmentOrder`/`addOrderTags`/`setInventoryQuantity` are never called because `pushOrderToZappr` doesn't invoke them yet.

- [ ] **Step 4: Implement the side-effect helper and wire it in**

In `src/services/orderService.js`, add these imports at the top (after the existing `import { ZapprApiError } from '../errors.js'` line):

```js
import { moveFulfillmentOrder } from '../shopify/fulfillment.js'
import { addOrderTags } from '../shopify/orders.js'
import { setInventoryQuantity } from '../shopify/inventory.js'
import { trackEligibleSku, recordSyncedQuantity } from './zapprInventorySyncService.js'
import { env } from '../config/env.js'
```

Add this new function after the `isStockRejection` helper (before `pushOrderToZappr`):

```js
/**
 * Route a successfully-pushed order's fulfillment to the Zappr-managed
 * Shopify location, tag it, and sync Shopify's inventory display for each
 * SKU sold. Every step is independently wrapped — a failure here must never
 * roll back or fail the already-successful Zappr push, only degrade Shopify
 * admin visibility.
 * @param {{ shopifyOrderId: string, fulfillmentOrderId: string, orderGid: string, items: Array<{ zapprSku: string, quantity: number, variantId: string, shopifyInventoryItemId: string | null }>, adapter: import('../zappr/adapter.js').ZapprAdapter }} opts
 * @returns {Promise<void>}
 */
async function syncShopifyZapprSideEffects({ shopifyOrderId, fulfillmentOrderId, orderGid, items, adapter }) {
  if (!env.ZAPPR_SHOPIFY_LOCATION_ID) return

  try {
    await moveFulfillmentOrder({ fulfillmentOrderId, locationId: env.ZAPPR_SHOPIFY_LOCATION_ID })
  } catch (err) {
    log.error({ err, shopifyOrderId }, 'Failed to move fulfillment order to Zappr location')
  }

  try {
    await addOrderTags({ orderId: orderGid, tags: ['zappr-fulfillment'] })
  } catch (err) {
    log.error({ err, shopifyOrderId }, 'Failed to tag order as zappr-fulfillment')
  }

  for (const item of items) {
    if (!item.shopifyInventoryItemId) continue

    try {
      await trackEligibleSku({
        sku: item.zapprSku,
        shopifyVariantId: item.variantId,
        shopifyInventoryItemId: item.shopifyInventoryItemId,
      })

      const stock = await adapter.checkStock({ zapprSku: item.zapprSku, quantity: item.quantity })

      await setInventoryQuantity({
        inventoryItemId: item.shopifyInventoryItemId,
        locationId: env.ZAPPR_SHOPIFY_LOCATION_ID,
        quantity: stock.quantity,
      })

      await recordSyncedQuantity(item.zapprSku, stock.quantity)
    } catch (err) {
      log.error({ err, shopifyOrderId, sku: item.zapprSku }, 'Failed to sync Shopify inventory for SKU')
    }
  }
}
```

Now update the `items` mapping (existing line, inside `pushOrderToZappr`) to also carry `shopifyInventoryItemId`:

```js
  const items = fo.lineItems.nodes.map((li) => ({
    zapprSku: li.sku,
    quantity: li.remainingQuantity,
    variantId: li.variant?.id,
    price: li.variant?.price,
    shopifyInventoryItemId: li.variant?.inventoryItem?.id ?? null,
    // Variant metafield wins; falls back to the product-level flag
    zapprEligible: (li.variant?.metafield?.value ?? li.variant?.product?.metafield?.value) === 'true',
  }))
```

Finally, call the new helper right after the existing `log.info({ shopifyOrderId, zapprOrderId, slot }, 'Order pushed to Zappr')` line, still inside the `try` block (before the `finally`):

```js
    log.info({ shopifyOrderId, zapprOrderId, slot }, 'Order pushed to Zappr')

    await syncShopifyZapprSideEffects({
      shopifyOrderId,
      fulfillmentOrderId: fo.id,
      orderGid: shopifyGid,
      items,
      adapter,
    })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/orderService.test.js`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 6: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: all tests pass; no new lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/orderService.js tests/unit/orderService.test.js
git commit -m "Route successfully-pushed orders to the Zappr Shopify location, tag them, sync inventory"
```

---

### Task 6: Daily catalog backfill scan

**Files:**
- Create: `src/shopify/queries/getProductsPage.js`
- Create: `src/shopify/catalog.js`
- Test: `tests/unit/catalog.test.js`

**Interfaces:**
- Consumes: `shopifyGraphql` (existing), `trackEligibleSku` (Task 2).
- Produces: `scanEligibleProducts(): Promise<number>` (returns count of SKUs tracked) — consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/catalog.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGraphql = vi.fn()
vi.mock('../../src/shopify/graphql.js', () => ({
  shopifyGraphql: (...args) => mockGraphql(...args),
}))

const tracked = []
vi.mock('../../src/services/zapprInventorySyncService.js', () => ({
  trackEligibleSku: vi.fn(async (opts) => { tracked.push(opts) }),
}))

const { scanEligibleProducts } = await import('../../src/shopify/catalog.js')

beforeEach(() => {
  mockGraphql.mockReset()
  tracked.length = 0
})

describe('scanEligibleProducts', () => {
  it('pages through the catalog and tracks eligible variants only', async () => {
    mockGraphql
      .mockResolvedValueOnce({
        products: {
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
          nodes: [
            {
              id: 'gid://shopify/Product/1',
              metafield: { value: 'false' },
              variants: {
                nodes: [
                  { id: 'gid://shopify/ProductVariant/1', sku: 'SKU-1', inventoryItem: { id: 'gid://shopify/InventoryItem/1' }, metafield: { value: 'true' } },
                  { id: 'gid://shopify/ProductVariant/2', sku: 'SKU-2', inventoryItem: { id: 'gid://shopify/InventoryItem/2' }, metafield: null },
                ],
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: 'gid://shopify/Product/2',
              metafield: { value: 'true' },
              variants: {
                nodes: [
                  { id: 'gid://shopify/ProductVariant/3', sku: 'SKU-3', inventoryItem: { id: 'gid://shopify/InventoryItem/3' }, metafield: null },
                ],
              },
            },
          ],
        },
      })

    const count = await scanEligibleProducts()

    expect(mockGraphql).toHaveBeenCalledTimes(2)
    expect(mockGraphql).toHaveBeenNthCalledWith(1, expect.any(String), { cursor: null })
    expect(mockGraphql).toHaveBeenNthCalledWith(2, expect.any(String), { cursor: 'cursor-1' })

    // SKU-1: variant metafield true → tracked. SKU-2: variant metafield null,
    // product metafield false → not tracked. SKU-3: variant metafield null,
    // product metafield true → tracked (product-level flag as fallback).
    expect(tracked.map((t) => t.sku)).toEqual(['SKU-1', 'SKU-3'])
    expect(count).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/catalog.test.js`
Expected: FAIL — `src/shopify/catalog.js` doesn't exist yet.

- [ ] **Step 3: Create the products-page query**

Create `src/shopify/queries/getProductsPage.js`:

```js
export const GET_PRODUCTS_PAGE = /* GraphQL */ `
  query GetProductsPage($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        metafield(namespace: "custom", key: "zappr_eligible") {
          value
        }
        variants(first: 50) {
          nodes {
            id
            sku
            inventoryItem {
              id
            }
            metafield(namespace: "custom", key: "zappr_eligible") {
              value
            }
          }
        }
      }
    }
  }
`
```

- [ ] **Step 4: Create the catalog scanner**

Create `src/shopify/catalog.js`:

```js
import { shopifyGraphql } from './graphql.js'
import { GET_PRODUCTS_PAGE } from './queries/getProductsPage.js'
import { trackEligibleSku } from '../services/zapprInventorySyncService.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('shopify-catalog')

/**
 * Page through the full Shopify catalog and track every zappr_eligible
 * variant for inventory sync (variant-level metafield wins, falls back to
 * the product-level flag). Run once daily to catch products marked eligible
 * before they've ever been viewed on the storefront or ordered.
 * @returns {Promise<number>} number of SKUs tracked this run
 */
export async function scanEligibleProducts() {
  let cursor = null
  let hasNextPage = true
  let tracked = 0

  while (hasNextPage) {
    const data = await shopifyGraphql(GET_PRODUCTS_PAGE, { cursor })
    const { nodes, pageInfo } = data.products

    for (const product of nodes) {
      for (const variant of product.variants.nodes) {
        const eligible = (variant.metafield?.value ?? product.metafield?.value) === 'true'
        if (!eligible || !variant.sku || !variant.inventoryItem?.id) continue

        await trackEligibleSku({
          sku: variant.sku,
          shopifyVariantId: variant.id,
          shopifyInventoryItemId: variant.inventoryItem.id,
        })
        tracked++
      }
    }

    hasNextPage = pageInfo.hasNextPage
    cursor = pageInfo.endCursor
  }

  log.info({ tracked }, 'Daily Zappr-eligible catalog scan complete')
  return tracked
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/catalog.test.js`
Expected: PASS

- [ ] **Step 6: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: all tests pass; no new lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/shopify/queries/getProductsPage.js src/shopify/catalog.js tests/unit/catalog.test.js
git commit -m "Add daily catalog scan for Zappr-eligible SKUs"
```

---

### Task 7: Periodic sync job wiring

**Files:**
- Modify: `src/queue/workers/maintenanceWorker.js`
- Modify: `src/queue/schedulers.js`

**Interfaces:**
- Consumes: `getTrackedSkus`/`recordSyncedQuantity` (Task 2), `setInventoryQuantity` (Task 3), `scanEligibleProducts` (Task 6), `getAdapter` (existing, `src/zappr/adapter.js`), `env.ZAPPR_SHOPIFY_LOCATION_ID` (Task 1).
- Produces: two new recurring BullMQ jobs on the existing `maintenanceQueue` — no new exports consumed by other tasks.

This task extends `maintenanceWorker.js`, which self-boots a BullMQ `Worker` on import (`boot().then(() => new Worker(...))`) — the same pattern already used by `orderPushWorker.js` and `trackingPollWorker.js`. Consistent with those two files, this codebase does not unit-test worker files directly (they're thin BullMQ wrappers around already-tested service functions); verification here is a syntax check plus manual log review after deploy, not a new Vitest suite.

- [ ] **Step 1: Extend `maintenanceWorker.js`**

Replace the full contents of `src/queue/workers/maintenanceWorker.js` with:

```js
import 'dotenv/config'
import { Worker } from 'bullmq'
import { sql } from 'drizzle-orm'
import { connectPostgres, getDb } from '../../db/postgres/connection.js'
import { connectRedis } from '../../cache/redis.js'
import { getAdapter } from '../../zappr/adapter.js'
import { getTrackedSkus, recordSyncedQuantity } from '../../services/zapprInventorySyncService.js'
import { setInventoryQuantity } from '../../shopify/inventory.js'
import { scanEligibleProducts } from '../../shopify/catalog.js'
import { QUEUE_NAMES } from '../../config/constants.js'
import { env } from '../../config/env.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('maintenance-worker')

const RETENTION_DAYS = 30

async function boot() {
  await Promise.all([connectPostgres(), connectRedis()])
  log.info('Maintenance worker booted')
}

async function runDbCleanup() {
  const db = getDb()
  const cutoff = sql`now() - make_interval(days => ${RETENTION_DAYS})`

  const [logs, events, updates] = await Promise.all([
    db.execute(sql`DELETE FROM zappr_logs WHERE created_at < ${cutoff}`),
    db.execute(sql`DELETE FROM webhook_events WHERE created_at < ${cutoff} AND status = 'done'`),
    db.execute(sql`DELETE FROM tracking_updates WHERE created_at < ${cutoff} AND synced_to_shopify = true`),
  ])

  log.info(
    { zapprLogs: logs.rowCount, webhookEvents: events.rowCount, trackingUpdates: updates.rowCount },
    'Daily DB cleanup complete',
  )
}

async function runZapprInventorySync() {
  if (!env.ZAPPR_SHOPIFY_LOCATION_ID) {
    log.info('ZAPPR_SHOPIFY_LOCATION_ID not set — skipping Zappr inventory sync')
    return
  }

  const adapter = await getAdapter()
  const skus = await getTrackedSkus()
  let synced = 0

  for (const { sku, shopifyInventoryItemId } of skus) {
    try {
      const stock = await adapter.checkStock({ zapprSku: sku, quantity: 0 })
      await setInventoryQuantity({
        inventoryItemId: shopifyInventoryItemId,
        locationId: env.ZAPPR_SHOPIFY_LOCATION_ID,
        quantity: stock.quantity,
      })
      await recordSyncedQuantity(sku, stock.quantity)
      synced++
    } catch (err) {
      log.error({ err, sku }, 'Zappr inventory sync failed for SKU — continuing with the rest')
    }
  }

  log.info({ synced, total: skus.length }, 'Zappr inventory sync complete')
}

/**
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  switch (job.data?.type) {
    case 'cleanup':
      return runDbCleanup()
    case 'zappr-inventory-sync':
      return runZapprInventorySync()
    case 'zappr-sku-scan':
      return scanEligibleProducts()
    default:
      log.warn({ type: job.data?.type }, 'Unknown maintenance job type — skipping')
  }
}

boot().then(() => {
  const worker = new Worker(QUEUE_NAMES.MAINTENANCE, processJob, {
    connection: { url: env.REDIS_URL },
    concurrency: 1,
  })

  worker.on('completed', (job) => log.info({ jobId: job.id }, 'Maintenance job completed'))
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Maintenance job failed'))

  process.on('SIGTERM', async () => {
    await worker.close()
    process.exit(0)
  })
})
```

- [ ] **Step 2: Register the two new cron schedules**

Replace the full contents of `src/queue/schedulers.js` with:

```js
import { maintenanceQueue } from './queues.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('schedulers')

/**
 * Register recurring BullMQ jobs.
 * Called once at server boot.
 * @returns {Promise<void>}
 */
export async function registerScheduledJobs() {
  await maintenanceQueue.add(
    'daily-db-cleanup',
    { type: 'cleanup' },
    {
      repeat: { cron: '0 21 * * *' },
      jobId: 'daily-db-cleanup',
    },
  )

  // Fallback/refresh sync for the Zappr-managed Shopify location's inventory
  // display — 4x/day keeps EasyEcom API usage well within its 500 req/day
  // quota alongside order pushes, tracking polling, and storefront checks.
  await maintenanceQueue.add(
    'zappr-inventory-sync',
    { type: 'zappr-inventory-sync' },
    {
      repeat: { cron: '0 */6 * * *' },
      jobId: 'zappr-inventory-sync',
    },
  )

  // Catches products marked zappr_eligible before they've ever been viewed
  // on the storefront or ordered (organic tracking wouldn't see them yet).
  await maintenanceQueue.add(
    'zappr-sku-scan',
    { type: 'zappr-sku-scan' },
    {
      repeat: { cron: '30 21 * * *' },
      jobId: 'zappr-sku-scan',
    },
  )

  log.info('Scheduled jobs registered')
}
```

- [ ] **Step 3: Verify**

Run: `node --check src/queue/workers/maintenanceWorker.js && node --check src/queue/schedulers.js`
Expected: no output (syntax OK).

Run: `npm test`
Expected: all existing tests pass unchanged (no test file imports these two modules directly, matching the existing precedent for `orderPushWorker.js`/`trackingPollWorker.js`).

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/queue/workers/maintenanceWorker.js src/queue/schedulers.js
git commit -m "Wire periodic Zappr inventory sync and daily catalog scan into maintenance worker"
```

---

## Post-implementation deployment checklist (not code tasks — do after all 7 tasks are merged)

1. In Shopify Dev Dashboard, add `write_orders`, `write_inventory`, and `read_locations` scopes to the app's configuration and release the version.
2. Re-run `node scripts/get-token.js` to obtain a new `SHOPIFY_ADMIN_TOKEN` with the expanded scopes; update it in `.env` and on Render.
3. Run `node scripts/get-location-id.js` to find the Bangalore Zappr location's GID; set `ZAPPR_SHOPIFY_LOCATION_ID` in `.env` and on Render.
4. Deploy (Render's `npm run migrate` step in the start command applies the new table automatically).
5. Place one real test order for a Zappr-eligible, Zappr-serviceable product and confirm in Shopify admin: the fulfillment order is at the Bangalore Zappr location, the order carries the `zappr-fulfillment` tag, and the SKU's inventory at that location shows a number.
6. Before setting `ZAPPR_SHOPIFY_LOCATION_ID`, activate every Zappr-eligible SKU's inventory item at the Bangalore Zappr location in Shopify (via `inventoryActivate` or manually in Shopify admin). `inventorySetQuantities` and `fulfillmentOrderMove` both fail or behave unexpectedly for inventory items that were never activated at the target location.
7. Before enabling the feature, count the actual number of Zappr-eligible SKUs and, if that count is high enough that `4 × SKU_count` risks the EasyEcom 500 req/day quota when combined with order pushes, tracking polling, and storefront checks, drop the periodic inventory-sync interval from 4x/day to a lower frequency (e.g. 2x/day).
