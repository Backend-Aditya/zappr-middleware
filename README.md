# zappr-middleware

Production-grade Shopify ↔ Zappr delivery integration for Unived.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Shopify Storefront                        │
│  Theme JS ──────► App Proxy ────────────────────────────────┐   │
│  Checkout ──────► Carrier Service ──────────────────────┐   │   │
│  Order Paid ────► Webhook ──────────────────────────┐   │   │   │
└──────────────────────────────────────────────────────────────────┘
                                                       │   │   │
                               ┌───────────────────────┘   │   │
                               │       ┌───────────────────┘   │
                               ▼       ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                      zappr-middleware (Express 5)                │
│                                                                  │
│  /webhooks/orders-paid ──► [HMAC verify] ──► BullMQ job ──►    │
│  /apps/zappr/check ──────► [HMAC + rate limit] ──► 3-check ──► │
│  /carrier ───────────────► [HMAC] ──► rate builder ──►         │
│  /webhooks/zappr/tracking ──────────► tracking sync ──►         │
│                                                                  │
│  ┌───────────┐  ┌──────────┐  ┌─────────────────────────────┐  │
│  │  MongoDB  │  │ Postgres │  │  Redis                      │  │
│  │  (Mongo)  │  │ (Drizzle)│  │  Stock TTL: 2min            │  │
│  │ WebhookEvt│  │ order_   │  │  Pincode set: 24h           │  │
│  │ ZapprLog  │  │ mappings │  │  Rate limit counters        │  │
│  └───────────┘  │ tracking │  └─────────────────────────────┘  │
│                 │ _updates │                                     │
│                 └──────────┘                                     │
│                                                                  │
│  ┌──────────────────────────────────────────────┐               │
│  │  BullMQ Workers (separate processes)          │               │
│  │  orderPushWorker ──► Zappr API ──► DB update │               │
│  │  trackingPollWorker ──► Zappr ──► Shopify    │               │
│  └──────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
              ┌─────────────────────────────┐
              │        Zappr API (live)       │
              │   POST /api/v1/stock/check   │
              │   POST /api/v1/pincode/check │
              │   POST /api/v1/orders        │
              │   GET  /api/v1/orders/:id/.. │
              └─────────────────────────────┘
```

## Setup

### 1. Prerequisites
- Docker + docker-compose
- Node.js 22+

### 2. Start infrastructure
```bash
cp .env.example .env
# Edit .env with your Shopify credentials
docker-compose up -d
```

### 3. Run migrations
```bash
npm install
npm run migrate
```

### 4. Start the app
```bash
# Development (watch mode)
npm run dev
npm run dev:worker    # in another terminal

# Production
npm start             # PM2 cluster mode
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/apps/zappr/check` | Shopify Proxy HMAC | Check Zappr availability for PDP |
| `POST` | `/carrier` | Shopify Webhook HMAC | Carrier callback — returns Zappr rate |
| `POST` | `/webhooks/orders-paid` | Shopify Webhook HMAC | Order paid hook → queues Zappr push |
| `POST` | `/webhooks/zappr/tracking` | — | Zappr tracking push |
| `GET` | `/health` | none | Liveness probe |
| `GET` | `/ready` | none | Readiness probe (checks DB + Redis) |

### GET /apps/zappr/check

Query params: `pincode`, `variantId`, `quantity`, `zapprSku`, `zappr_eligible`, `signature`

Response:
```json
{
  "available": true,
  "slot": "SAME_DAY",
  "deliveryPromise": "Delivered today by 9 PM",
  "surcharge": 49,
  "reason": null
}
```

## BullMQ Retry Flow

```
orders/paid webhook received
        │
        ▼
  HMAC verified + idempotency check (Mongo)
        │
        ▼
  Insert order_mapping (Postgres, status=PENDING)
        │
        ▼
  Enqueue job → orderPushQueue
        │
  return 200 immediately (< 50ms)
        │
        ▼ (async, separate worker process)
  orderPushWorker picks up job
        │
        ▼
  Re-validate availability (3 checks)
        │
   ┌────┴────┐
   │         │
  pass      fail
   │         │
   ▼         ▼
Create    Set status=FALLBACK
Zappr     (normal shipping handles it)
order
   │
   ▼
Update order_mapping
status=PUSHED + zapprOrderId
   │
   ▼
Invalidate stock cache

On failure: BullMQ retries with exponential backoff
  attempt 1 → 2s delay
  attempt 2 → 4s delay
  attempt 3 → 8s delay
  After 3 failures → status=FAILED, Pino error log
  (wire to Slack/PagerDuty via pino transport)
```

## Three-Check Availability Logic

```
checkAvailability(input, adapter)
  │
  ├─ Check 1: variant metafield custom.zappr_eligible === true?
  │    └─ No → { available: false, reason: 'VARIANT_NOT_ZAPPR_ELIGIBLE' }
  │
  ├─ Check 2: pincode in Redis SMEMBER zappr:pincodes?
  │    └─ No → { available: false, reason: 'PINCODE_NOT_SERVICEABLE' }
  │
  └─ Check 3: stock available in cache / Zappr API?
       ├─ Cache hit (TTL 2min) → use cached value
       ├─ Cache miss → adapter.checkStock() → cache result
       └─ API error → { available: false, reason: 'ZAPPR_SERVICE_UNAVAILABLE' }
```

## Testing

```bash
npm test                    # all tests
npm run test:coverage       # with coverage report
```

## Slot Cutoff (IST)

| Order time (IST) | Slot |
|------------------|------|
| Before 15:00 | SAME_DAY |
| 15:00 or later | NEXT_DAY |
| Holiday (ZAPPR_HOLIDAYS) | NEXT_DAY |

Uses `dayjs` with `Asia/Kolkata` timezone — never hardcoded UTC offsets.
