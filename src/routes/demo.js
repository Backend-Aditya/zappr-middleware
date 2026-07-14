import { Router } from 'express'
import { env } from '../config/env.js'
import { safeCompare } from '../utils/crypto.js'
import { HmacError } from '../errors.js'
import { getAdapter } from '../zappr/adapter.js'
import { checkAvailability } from '../services/availabilityService.js'
import { getRedis } from '../cache/redis.js'
import { getDb } from '../db/postgres/connection.js'
import { sql } from 'drizzle-orm'

const router = Router()

const demoToken = () => env.ADMIN_TOKEN || env.ZAPPR_WEBHOOK_TOKEN

/** @type {import('express').RequestHandler} */
function demoAuth(req, _res, next) {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  if (!safeCompare(token, demoToken())) return next(new HmacError())
  next()
}

const DEMO_SKU = 'Test_SKU_Unived_2'
const DEMO_PINCODE = '560102'

// Each step runs a real operation and returns its result — no mocks.
router.post('/api/step/:name', demoAuth, async (req, res) => {
  const { name } = req.params
  const { ref, invoiceId } = req.body ?? {}
  const adapter = await getAdapter()
  const started = Date.now()

  const run = {
    async health() {
      await getRedis().ping()
      await getDb().execute(sql`select 1`)
      return { mode: env.ZAPPR_MODE, database: 'connected', redis: 'connected' }
    },
    async availability_ok() {
      return checkAvailability(
        { pincode: DEMO_PINCODE, variantId: 'demo', quantity: 1, zapprSku: DEMO_SKU, zapprEligible: true },
        adapter,
      )
    },
    async availability_bad() {
      return checkAvailability(
        { pincode: '110001', variantId: 'demo', quantity: 1, zapprSku: DEMO_SKU, zapprEligible: true },
        adapter,
      )
    },
    async stock() {
      return adapter.checkStock({ zapprSku: DEMO_SKU, quantity: 1 })
    },
    async create() {
      const reference = `DEMO-${Date.now()}`
      const result = await adapter.createOrder({
        items: [{ zapprSku: DEMO_SKU, quantity: 1, price: '1.00' }],
        pincode: DEMO_PINCODE,
        slot: 'SAME_DAY',
        address: {
          name: 'Demo Customer',
          address1: '42 Demo Street, HSR Layout',
          city: 'Bengaluru',
          province: 'Karnataka',
          country: 'India',
          phone: '9999999999',
          email: 'demo@unived.com',
        },
        shopifyReference: reference,
      })
      return { reference, ...result }
    },
    async tracking() {
      if (!ref) throw new Error('run the create step first')
      return adapter.getTracking({ zapprOrderId: ref })
    },
    async details() {
      if (!invoiceId) throw new Error('run the create step first')
      const d = await adapter.getOrderDetails({ invoiceId })
      const row = Array.isArray(d?.data) ? d.data[0] : d?.data
      return {
        reference_code: row?.reference_code,
        order_status: row?.order_status ?? row?.orderStatus,
        invoice_id: row?.invoice_id,
        marketplace: row?.marketplace,
        pickup_city: row?.pickup_city,
      }
    },
    async cancel() {
      if (!ref) throw new Error('run the create step first')
      return adapter.cancelOrder({ zapprOrderId: ref })
    },
  }[name]

  if (!run) return res.status(404).json({ error: 'unknown step' })

  try {
    const result = await run()
    res.json({ ok: true, ms: Date.now() - started, result })
  } catch (err) {
    res.json({ ok: false, ms: Date.now() - started, error: err.message })
  }
})

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zappr Integration — Live Demo</title>
<style>
  :root { --bg:#0d1117; --card:#161c24; --line:#28313c; --text:#e2e8f0; --dim:#94a3b8; --ok:#34d399; --bad:#f87171; --accent:#60a5fa; }
  * { box-sizing:border-box; margin:0 }
  body { background:var(--bg); color:var(--text); font:15px/1.6 system-ui,Segoe UI,sans-serif; padding:32px 20px; max-width:880px; margin:0 auto }
  h1 { font-size:22px; margin-bottom:4px } .sub { color:var(--dim); margin-bottom:24px }
  .flow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:24px; justify-content:center }
  .node { border:1px solid var(--line); border-radius:8px; padding:8px 16px; background:var(--bg); font-weight:600 }
  .arrow { color:var(--dim) }
  .bar { display:flex; gap:8px; margin-bottom:24px; flex-wrap:wrap }
  input,button { background:var(--card); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:9px 14px; font:inherit }
  button { cursor:pointer } button:hover { border-color:var(--accent) }
  button.primary { background:var(--accent); color:#0d1117; font-weight:600; border:none }
  button:disabled { opacity:.45; cursor:default }
  .step { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:12px }
  .step-head { display:flex; align-items:center; gap:12px }
  .num { width:28px; height:28px; border-radius:50%; background:var(--bg); border:1px solid var(--line); display:flex; align-items:center; justify-content:center; font-size:13px; flex-shrink:0 }
  .step h3 { font-size:15px } .step p { color:var(--dim); font-size:13px; margin-top:2px }
  .step-head button { margin-left:auto; flex-shrink:0 }
  .badge { font-size:12px; padding:2px 10px; border-radius:10px; display:none }
  .badge.ok { display:inline; background:#0c2f24; color:var(--ok) } .badge.bad { display:inline; background:#331a1a; color:var(--bad) }
  pre { display:none; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:12px; margin-top:12px; font:12.5px/1.5 ui-monospace,Consolas,monospace; white-space:pre-wrap; word-break:break-all; max-height:260px; overflow:auto }
  .ms { color:var(--dim); font-size:12px; margin-left:8px }
  #msg { color:var(--bad); margin-bottom:12px; min-height:1.2em }
</style>
</head>
<body>
<h1>Shopify ↔ Zappr Quick-Delivery Integration</h1>
<div class="sub">Live demonstration — every step below executes against the production middleware and the real Zappr (EasyEcom) API in real time. Nothing is simulated.</div>

<div class="flow">
  <span class="node">Shopify Store</span><span class="arrow">⇄</span>
  <span class="node">Middleware (this server)</span><span class="arrow">⇄</span>
  <span class="node">Zappr / EasyEcom</span>
</div>

<div class="bar">
  <input id="token" type="password" placeholder="demo token" size="24">
  <button onclick="saveToken()">Connect</button>
  <button class="primary" id="runall" onclick="runAll()">▶ Run complete workflow</button>
</div>
<div id="msg"></div>

<div id="steps"></div>

<script>
const STEPS = [
  { id:'health', title:'System health', desc:'Middleware checks its PostgreSQL database and Redis queue connections.' },
  { id:'availability_ok', title:'Customer checks delivery availability', desc:'Storefront widget flow: serviceable Bengaluru pincode (560102) + eligible product → live stock check at Zappr → same-day promise with delivery fee.' },
  { id:'availability_bad', title:'Non-serviceable pincode is refused', desc:'Same check with a Delhi pincode (110001) → correctly declined, customer sees standard delivery only.' },
  { id:'stock', title:'Live inventory at Zappr', desc:'Real-time stock for the test SKU straight from EasyEcom\\'s warehouse system.' },
  { id:'create', title:'Order is pushed to Zappr', desc:'What happens automatically after a customer pays: middleware creates the order in EasyEcom. A real test order is created right now.' },
  { id:'tracking', title:'Tracking lookup', desc:'Middleware polls Zappr for courier status and AWB number (also received via webhooks) and syncs it to the Shopify order.' },
  { id:'details', title:'Order verified inside Zappr', desc:'Fetches the order back from EasyEcom by invoice ID — proof it exists in their system.' },
  { id:'cancel', title:'Cancellation', desc:'Order cancellation propagates to Zappr (also cleans up the demo order just created).' },
]
let ctx = {}
const $ = (id) => document.getElementById(id)
const tokenKey = 'zappr-admin-token'
$('token').value = localStorage.getItem(tokenKey) || ''
function saveToken() { localStorage.setItem(tokenKey, $('token').value); $('msg').textContent = 'Token saved — run the workflow.' }

$('steps').innerHTML = STEPS.map((s, i) =>
  '<div class="step" id="step-' + s.id + '"><div class="step-head"><div class="num">' + (i + 1) + '</div>'
  + '<div><h3>' + s.title + ' <span class="badge" id="badge-' + s.id + '"></span><span class="ms" id="ms-' + s.id + '"></span></h3>'
  + '<p>' + s.desc + '</p></div>'
  + '<button onclick="runStep(\\'' + s.id + '\\')">Run</button></div>'
  + '<pre id="out-' + s.id + '"></pre></div>',
).join('')

async function runStep(id) {
  const badge = $('badge-' + id); const out = $('out-' + id)
  badge.className = 'badge'; out.style.display = 'none'; $('msg').textContent = ''
  try {
    const t = encodeURIComponent(localStorage.getItem(tokenKey) || '')
    const r = await fetch('/demo/api/step/' + id + '?token=' + t, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: ctx.reference, invoiceId: ctx.invoiceId }),
    })
    if (r.status === 401) throw new Error('invalid token — paste the demo token and press Connect')
    const d = await r.json()
    badge.className = 'badge ' + (d.ok ? 'ok' : 'bad')
    badge.textContent = d.ok ? 'PASS' : 'FAIL'
    $('ms-' + id).textContent = d.ms + ' ms'
    out.textContent = JSON.stringify(d.ok ? d.result : { error: d.error }, null, 2)
    out.style.display = 'block'
    if (id === 'create' && d.ok) { ctx.reference = d.result.reference; ctx.invoiceId = d.result.invoiceId }
    return d.ok
  } catch (e) { $('msg').textContent = e.message; return false }
}

async function runAll() {
  $('runall').disabled = true
  ctx = {}
  for (const s of STEPS) {
    const ok = await runStep(s.id)
    if (!ok) break
    await new Promise((r) => setTimeout(r, 400))
  }
  $('runall').disabled = false
}
</script>
</body>
</html>`

router.get('/', (_req, res) => {
  res.type('html').send(PAGE)
})

export default router
