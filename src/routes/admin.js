import { Router } from 'express'
import { desc, eq, ilike, or, sql } from 'drizzle-orm'
import { env } from '../config/env.js'
import { getDb } from '../db/postgres/connection.js'
import { orderMappings, trackingUpdates, webhookEvents, zapprLogs } from '../db/postgres/schema.js'
import { trackingPollQueue } from '../queue/queues.js'
import { safeCompare } from '../utils/crypto.js'
import { HmacError } from '../errors.js'

const router = Router()

// Reuses the Zappr webhook shared secret unless a dedicated ADMIN_TOKEN is set
const adminToken = () => env.ADMIN_TOKEN || env.ZAPPR_WEBHOOK_TOKEN

/** @type {import('express').RequestHandler} */
function adminAuth(req, _res, next) {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  if (!safeCompare(token, adminToken())) return next(new HmacError())
  next()
}

router.get('/api/overview', adminAuth, async (_req, res) => {
  const db = getDb()

  const [statusCounts, orders, webhooks, logs] = await Promise.all([
    db.select({ status: orderMappings.status, count: sql`count(*)::int` })
      .from(orderMappings)
      .groupBy(orderMappings.status),
    db.select()
      .from(orderMappings)
      .orderBy(desc(orderMappings.createdAt))
      .limit(50),
    db.select()
      .from(webhookEvents)
      .orderBy(desc(webhookEvents.createdAt))
      .limit(20),
    db.select({
      createdAt: zapprLogs.createdAt,
      endpoint: zapprLogs.endpoint,
      statusCode: zapprLogs.statusCode,
      latencyMs: zapprLogs.latencyMs,
    })
      .from(zapprLogs)
      .orderBy(desc(zapprLogs.createdAt))
      .limit(20),
  ])

  res.json({ statusCounts, orders, webhooks, logs })
})

router.get('/api/order', adminAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) return res.status(400).json({ error: 'q required' })

  const db = getDb()
  const [mapping] = await db.select()
    .from(orderMappings)
    .where(or(
      eq(orderMappings.shopifyOrderId, q),
      eq(orderMappings.zapprOrderId, q),
      ilike(orderMappings.shopifyOrderName, `%${q}%`),
    ))
    .limit(1)

  if (!mapping) return res.status(404).json({ error: 'not found' })

  const tracking = await db.select()
    .from(trackingUpdates)
    .where(eq(trackingUpdates.zapprOrderId, mapping.zapprOrderId ?? ''))
    .orderBy(desc(trackingUpdates.createdAt))
    .limit(20)

  res.json({ mapping, tracking })
})

// Manually kick tracking polling for an order — e.g. after a job hit its
// retry ceiling during an upstream outage and stopped requeuing.
router.post('/api/requeue-tracking', adminAuth, async (req, res) => {
  const zapprOrderId = String(req.body?.zapprOrderId ?? req.query.zapprOrderId ?? '').trim()
  if (!zapprOrderId) return res.status(400).json({ error: 'zapprOrderId required' })

  await trackingPollQueue.add('poll', { zapprOrderId, pollCount: 0 }, { delay: 0 })
  res.json({ ok: true, zapprOrderId })
})

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zappr Middleware — Dashboard</title>
<style>
  :root {
    --bg: oklch(1 0 0);
    --surface: oklch(0.975 0.006 290);
    --surface-2: oklch(0.955 0.008 290);
    --border: oklch(0.90 0.012 290);
    --ink: oklch(0.22 0.02 290);
    --muted: oklch(0.48 0.02 290);
    --primary: oklch(0.55 0.14 290);
    --primary-ink: oklch(0.98 0 0);
    --primary-soft: oklch(0.94 0.03 290);

    --success-bg: oklch(0.94 0.05 150); --success-ink: oklch(0.32 0.13 150);
    --warning-bg: oklch(0.94 0.06 80);  --warning-ink: oklch(0.38 0.14 80);
    --danger-bg:  oklch(0.94 0.06 25);  --danger-ink:  oklch(0.42 0.17 25);
    --neutral-bg: oklch(0.94 0.01 290); --neutral-ink: oklch(0.42 0.02 290);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: oklch(0.12 0 0);
      --surface: oklch(0.17 0 0);
      --surface-2: oklch(0.20 0 0);
      --border: oklch(0.27 0 0);
      --ink: oklch(0.93 0 0);
      --muted: oklch(0.64 0 0);
      --primary: oklch(0.72 0.12 290);
      --primary-ink: oklch(0.12 0 0);
      --primary-soft: oklch(0.22 0.03 290);

      --success-bg: oklch(0.24 0.05 150); --success-ink: oklch(0.80 0.15 150);
      --warning-bg: oklch(0.26 0.06 80);  --warning-ink: oklch(0.82 0.15 80);
      --danger-bg:  oklch(0.26 0.07 25);  --danger-ink:  oklch(0.82 0.16 25);
      --neutral-bg: oklch(0.22 0.01 290); --neutral-ink: oklch(0.75 0.02 290);
    }
  }

  * { box-sizing: border-box }
  html { color-scheme: light dark }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 15px/1.55 -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.93em }

  header.topbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    flex-wrap: wrap;
    padding: 14px clamp(16px, 4vw, 40px);
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 15px; white-space: nowrap }
  .brand .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); flex-shrink: 0 }
  .brand a { color: inherit; text-decoration: none }
  .controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }

  input, button {
    font: inherit; font-size: 13.5px;
    border-radius: 7px; border: 1px solid var(--border);
    padding: 8px 12px;
    background: var(--surface); color: var(--ink);
  }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px }
  input::placeholder { color: var(--muted); opacity: 1 }
  button { cursor: pointer; font-weight: 600; transition: background-color 150ms ease-out, border-color 150ms ease-out }
  button:hover { background: var(--surface-2) }
  button.primary { background: var(--primary); color: var(--primary-ink); border-color: transparent }
  button.primary:hover { background: color-mix(in oklch, var(--primary) 88%, black) }
  button:disabled { opacity: 0.5; cursor: default }
  .timestamp { color: var(--muted); font-size: 12.5px; white-space: nowrap }

  main { max-width: 1080px; margin: 0 auto; padding: 28px clamp(16px, 4vw, 40px) 64px }
  section { margin-bottom: 36px }
  h2 { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 14px }
  h3 { font-size: 14px; font-weight: 600; margin: 0 0 10px }

  #banner {
    display: none;
    padding: 12px 16px; margin-bottom: 20px;
    border-radius: 8px;
    background: var(--danger-bg); color: var(--danger-ink);
    font-size: 13.5px; font-weight: 500;
  }

  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
  }

  .lookup-row { display: flex; gap: 8px; flex-wrap: wrap }
  .lookup-row input { flex: 1; min-width: 220px }
  .hint { color: var(--muted); font-size: 12.5px; margin-top: 8px }

  .stats { display: flex; gap: 10px; flex-wrap: wrap }
  .stat {
    display: flex; align-items: center; gap: 10px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px 16px;
  }
  .stat-count { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums }
  .empty { color: var(--muted); font-size: 13.5px; padding: 4px 2px }

  .pill {
    display: inline-flex; align-items: center;
    padding: 3px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; white-space: nowrap;
  }
  .pill-success { background: var(--success-bg); color: var(--success-ink) }
  .pill-warning { background: var(--warning-bg); color: var(--warning-ink) }
  .pill-danger  { background: var(--danger-bg);  color: var(--danger-ink) }
  .pill-neutral { background: var(--neutral-bg); color: var(--neutral-ink) }

  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px }
  th, td { text-align: left; padding: 10px 14px; white-space: nowrap; border-bottom: 1px solid var(--border) }
  th { background: var(--surface-2); color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em }
  tbody tr:last-child td { border-bottom: none }
  tbody tr:hover { background: var(--surface) }
  td.muted, .muted { color: var(--muted) }

  details.section {
    border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
  }
  details.section summary {
    cursor: pointer; list-style: none;
    padding: 14px 18px; font-weight: 600; font-size: 13.5px;
    display: flex; align-items: center; gap: 8px;
    background: var(--surface);
  }
  details.section summary::-webkit-details-marker { display: none }
  details.section summary::before { content: '▸'; color: var(--muted); transition: transform 150ms ease-out }
  details.section[open] summary::before { transform: rotate(90deg) }
  details.section .table-wrap { border: none; border-top: 1px solid var(--border); border-radius: 0 }

  #orderResult { margin-top: 16px }
  .kv { display: grid; grid-template-columns: max-content 1fr; column-gap: 20px; row-gap: 12px; font-size: 13.5px }
  .kv dt { color: var(--muted) }
  .kv dd { margin: 0; font-weight: 500 }

  .tracking-list { display: flex; flex-direction: column; gap: 10px; margin-top: 8px }
  .tracking-item {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 10px 14px; background: var(--surface-2); border-radius: 8px; font-size: 13px;
  }
  .tracking-item time { color: var(--muted); min-width: 150px }

  @media (max-width: 640px) {
    .kv { grid-template-columns: 1fr }
    .kv dt { padding-top: 6px }
  }
</style>
</head>
<body>

<header class="topbar">
  <div class="brand"><span class="dot"></span> <a href="/">Zappr Middleware</a></div>
  <div class="controls">
    <input id="token" type="password" placeholder="Admin token" size="20">
    <button onclick="saveToken()">Connect</button>
    <button onclick="load()" id="refreshBtn">Refresh</button>
    <span class="timestamp" id="updated"></span>
  </div>
</header>

<main>
  <div id="banner"></div>

  <section id="lookup-section">
    <h2>Find an order</h2>
    <div class="panel">
      <div class="lookup-row">
        <input id="q" placeholder="Shopify order number, order name, or Zappr reference" onkeypress="if(event.key==='Enter')lookup()">
        <button class="primary" onclick="lookup()">Search</button>
      </div>
      <div class="hint">Try a Shopify order name like DON119947, its numeric order ID, or the reference Zappr has on file.</div>
      <div id="orderResult"></div>
    </div>
  </section>

  <section>
    <h2>Orders by status</h2>
    <div class="stats" id="counts"></div>
  </section>

  <section>
    <h2>Recent orders</h2>
    <div class="table-wrap"><table id="orders"></table></div>
  </section>

  <section>
    <details class="section">
      <summary>Webhook events</summary>
      <div class="table-wrap"><table id="webhooks"></table></div>
    </details>
  </section>

  <section>
    <details class="section">
      <summary>Zappr API calls</summary>
      <div class="table-wrap"><table id="logs"></table></div>
    </details>
  </section>
</main>

<script>
const $ = (id) => document.getElementById(id)
const tokenKey = 'zappr-admin-token'
$('token').value = localStorage.getItem(tokenKey) || ''

function saveToken() { localStorage.setItem(tokenKey, $('token').value); load() }
function showBanner(text) {
  const b = $('banner')
  if (!text) { b.style.display = 'none'; b.textContent = ''; return }
  b.style.display = 'block'; b.textContent = text
}

const fmt = (d) => d ? new Date(d).toLocaleString() : '—'
const esc = (v) => String(v ?? '—').replace(/</g, '&lt;')

const STATUS_GROUPS = {
  success: ['PUSHED', 'FULFILLED', 'DELIVERED', 'Delivered', 'Shipped', 'done', '2xx'],
  warning: ['PENDING', 'FALLBACK', 'processing', 'Assigned', 'Confirmed'],
  danger: ['FAILED', 'CANCELLED', 'Cancelled', 'failed', 'err'],
}
function statusClass(s) {
  for (const [cls, values] of Object.entries(STATUS_GROUPS)) {
    if (values.includes(s)) return cls
  }
  return 'neutral'
}
function pill(s) { return '<span class="pill pill-' + statusClass(s) + '">' + esc(s) + '</span>' }

async function api(path, opts) {
  const t = encodeURIComponent(localStorage.getItem(tokenKey) || '')
  const url = path + (path.includes('?') ? '&' : '?') + 'token=' + t
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || r.status + ' ' + r.statusText)
  return r.json()
}

async function load() {
  showBanner('')
  try {
    const d = await api('/admin/api/overview')
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString()

    $('counts').innerHTML = d.statusCounts.length
      ? d.statusCounts.map((c) =>
          '<div class="stat"><span class="stat-count">' + c.count + '</span>' + pill(c.status) + '</div>').join('')
      : '<div class="empty">No orders yet — they will appear here once the first Shopify order is pushed to Zappr.</div>'

    $('orders').innerHTML = d.orders.length
      ? '<thead><tr><th>Created</th><th>Shopify order</th><th>Zappr ref</th><th>Status</th><th>Pincode</th><th>Slot</th><th>EasyEcom IDs</th></tr></thead><tbody>'
        + d.orders.map((o) =>
          '<tr><td class="muted">' + fmt(o.createdAt) + '</td>'
          + '<td>' + esc(o.shopifyOrderName) + ' <span class="muted mono">' + esc(o.shopifyOrderId) + '</span></td>'
          + '<td class="mono">' + esc(o.zapprOrderId) + '</td>'
          + '<td>' + pill(o.status) + '</td>'
          + '<td>' + esc(o.pincode) + '</td>'
          + '<td>' + esc(o.slot) + '</td>'
          + '<td class="muted mono">' + esc(o.metadata?.easyEcomOrderId) + ' / ' + esc(o.metadata?.invoiceId) + '</td></tr>').join('')
        + '</tbody>'
      : '<tbody><tr><td class="empty">No orders yet.</td></tr></tbody>'

    $('webhooks').innerHTML = d.webhooks.length
      ? '<thead><tr><th>Received</th><th>Order ID</th><th>Type</th><th>Status</th><th>Error</th></tr></thead><tbody>'
        + d.webhooks.map((w) =>
          '<tr><td class="muted">' + fmt(w.createdAt) + '</td><td class="mono">' + esc(w.shopifyOrderId) + '</td><td>' + esc(w.eventType) + '</td>'
          + '<td>' + pill(w.status) + '</td><td class="muted">' + esc(w.error) + '</td></tr>').join('')
        + '</tbody>'
      : '<tbody><tr><td class="empty">No webhook events yet.</td></tr></tbody>'

    $('logs').innerHTML = d.logs.length
      ? '<thead><tr><th>Time</th><th>Endpoint</th><th>Status</th><th>Latency</th></tr></thead><tbody>'
        + d.logs.map((l) =>
          '<tr><td class="muted">' + fmt(l.createdAt) + '</td><td class="mono">' + esc(l.endpoint) + '</td>'
          + '<td>' + pill(l.statusCode >= 400 ? 'err' : '2xx') + ' <span class="muted">' + esc(l.statusCode) + '</span></td>'
          + '<td class="muted">' + esc(l.latencyMs) + ' ms</td></tr>').join('')
        + '</tbody>'
      : '<tbody><tr><td class="empty">No Zappr API calls logged yet.</td></tr></tbody>'
  } catch (e) {
    showBanner('Could not load dashboard: ' + e.message)
  }
}

function renderOrderResult(d) {
  const m = d.mapping
  const kv = [
    ['Shopify order', esc(m.shopifyOrderName) + ' <span class="muted mono">' + esc(m.shopifyOrderId) + '</span>'],
    ['Status', pill(m.status)],
    ['Zappr reference', '<span class="mono">' + esc(m.zapprOrderId) + '</span>'],
    ['Pincode', esc(m.pincode)],
    ['Delivery slot', esc(m.slot)],
    ['Surcharge', m.surchargeAmount != null ? '₹' + esc(m.surchargeAmount) : '—'],
    ['EasyEcom order / invoice', '<span class="mono">' + esc(m.metadata?.easyEcomOrderId) + ' / ' + esc(m.metadata?.invoiceId) + '</span>'],
    ['Created', fmt(m.createdAt)],
    ['Last updated', fmt(m.updatedAt)],
  ]

  const trackingHtml = d.tracking.length
    ? '<div class="tracking-list">' + d.tracking.map((t) =>
        '<div class="tracking-item"><time>' + fmt(t.createdAt) + '</time>' + pill(t.status)
        + (t.trackingNumber ? '<span class="mono">' + esc(t.trackingNumber) + '</span>' : '<span class="muted">No tracking number yet</span>')
        + '</div>').join('') + '</div>'
    : '<div class="empty">No tracking updates yet.</div>'

  $('orderResult').innerHTML = '<hr style="border:none;border-top:1px solid var(--border);margin:18px 0">'
    + '<dl class="kv">' + kv.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>'
    + '<h3 style="margin-top:20px">Tracking history</h3>' + trackingHtml
    + '<div style="margin-top:14px">'
    + '<button id="retryBtn"' + (m.zapprOrderId ? '' : ' disabled') + '>Retry tracking check</button>'
    + ' <span class="muted" id="retryMsg" style="font-size:12.5px"></span>'
    + '</div>'

  const retryBtn = $('retryBtn')
  if (retryBtn) {
    retryBtn.onclick = async () => {
      retryBtn.disabled = true
      $('retryMsg').textContent = 'Requesting a fresh tracking check…'
      try {
        await api('/admin/api/requeue-tracking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zapprOrderId: m.zapprOrderId }),
        })
        $('retryMsg').textContent = 'Done — check back in a minute for the updated status.'
      } catch (e) {
        $('retryMsg').textContent = 'Could not requeue: ' + e.message
      } finally {
        retryBtn.disabled = false
      }
    }
  }
}

async function lookup() {
  showBanner('')
  const q = $('q').value.trim()
  if (!q) return
  try {
    const d = await api('/admin/api/order?q=' + encodeURIComponent(q))
    renderOrderResult(d)
  } catch (e) {
    $('orderResult').innerHTML = ''
    showBanner('Lookup: ' + e.message)
  }
}

if (localStorage.getItem(tokenKey)) load()
setInterval(() => { if (localStorage.getItem(tokenKey)) load() }, 30000)
</script>
</body>
</html>`

router.get('/', (_req, res) => {
  res.type('html').send(PAGE)
})

export default router
