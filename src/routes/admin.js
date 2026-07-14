import { Router } from 'express'
import { desc, eq, ilike, or, sql } from 'drizzle-orm'
import { env } from '../config/env.js'
import { getDb } from '../db/postgres/connection.js'
import { orderMappings, trackingUpdates, webhookEvents, zapprLogs } from '../db/postgres/schema.js'
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

  res.json({ mode: env.ZAPPR_MODE, statusCounts, orders, webhooks, logs })
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

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zappr Middleware — Status</title>
<style>
  :root { --bg:#0f1216; --card:#171c22; --line:#242c35; --text:#d7dde4; --dim:#8a95a1; --ok:#3fb96f; --warn:#e0a83c; --bad:#e05c5c; }
  * { box-sizing:border-box; margin:0 }
  body { background:var(--bg); color:var(--text); font:14px/1.5 ui-monospace,Consolas,monospace; padding:20px; }
  h1 { font-size:16px; margin-bottom:14px } h2 { font-size:13px; color:var(--dim); margin:18px 0 8px; text-transform:uppercase; letter-spacing:.05em }
  .bar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px }
  input,button { background:var(--card); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:7px 10px; font:inherit }
  input:focus { outline:1px solid var(--dim) } button { cursor:pointer }
  .cards { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px }
  .card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 16px; min-width:110px }
  .card b { font-size:20px; display:block }
  .wrap { overflow-x:auto; background:var(--card); border:1px solid var(--line); border-radius:8px }
  table { border-collapse:collapse; width:100%; font-size:13px }
  th,td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); white-space:nowrap }
  th { color:var(--dim); font-weight:normal } tr:last-child td { border-bottom:none }
  .st { padding:1px 8px; border-radius:10px; font-size:12px }
  .st-PUSHED,.st-DELIVERED,.st-done,.st-2xx { background:#153524; color:var(--ok) }
  .st-PENDING,.st-FALLBACK,.st-processing { background:#3a2f14; color:var(--warn) }
  .st-FAILED,.st-failed,.st-CANCELLED,.st-err { background:#3a1818; color:var(--bad) }
  .dim { color:var(--dim) } #msg { color:var(--bad); margin:8px 0 }
  #detail { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px; margin-top:8px; display:none; overflow-x:auto }
  pre { font:12px/1.5 inherit; white-space:pre-wrap; word-break:break-all }
</style>
</head>
<body>
<h1>Zappr Middleware <span id="mode" class="dim"></span></h1>
<div class="bar">
  <input id="token" type="password" placeholder="admin token" size="24">
  <button onclick="saveToken()">Connect</button>
  <input id="q" placeholder="lookup: order id / #name / zappr ref" size="32" onkeypress="if(event.key==='Enter')lookup()">
  <button onclick="lookup()">Lookup</button>
  <button onclick="load()">Refresh</button>
  <span class="dim" id="updated"></span>
</div>
<div id="msg"></div>
<div id="detail"></div>
<h2>Orders by status</h2><div class="cards" id="counts"></div>
<h2>Recent orders (50)</h2><div class="wrap"><table id="orders"></table></div>
<h2>Recent webhooks (20)</h2><div class="wrap"><table id="webhooks"></table></div>
<h2>Recent Zappr API calls (20)</h2><div class="wrap"><table id="logs"></table></div>
<script>
const $ = (id) => document.getElementById(id)
const tokenKey = 'zappr-admin-token'
$('token').value = localStorage.getItem(tokenKey) || ''
function saveToken() { localStorage.setItem(tokenKey, $('token').value); load() }
const fmt = (d) => d ? new Date(d).toLocaleString() : '—'
const st = (s) => '<span class="st st-' + s + '">' + s + '</span>'
const esc = (v) => String(v ?? '—').replace(/</g, '&lt;')

async function api(path) {
  const t = encodeURIComponent(localStorage.getItem(tokenKey) || '')
  const r = await fetch(path + (path.includes('?') ? '&' : '?') + 'token=' + t)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || r.status + ' ' + r.statusText)
  return r.json()
}

async function load() {
  $('msg').textContent = ''
  try {
    const d = await api('/admin/api/overview')
    $('mode').textContent = '· mode: ' + d.mode
    $('updated').textContent = 'updated ' + new Date().toLocaleTimeString()
    $('counts').innerHTML = d.statusCounts.length
      ? d.statusCounts.map((c) => '<div class="card"><b>' + c.count + '</b>' + st(c.status) + '</div>').join('')
      : '<div class="card dim">no orders yet</div>'
    $('orders').innerHTML = '<tr><th>created</th><th>shopify order</th><th>zappr ref</th><th>status</th><th>pincode</th><th>slot</th><th>easyecom ids</th></tr>'
      + d.orders.map((o) => '<tr><td>' + fmt(o.createdAt) + '</td><td>' + esc(o.shopifyOrderName) + ' <span class="dim">' + esc(o.shopifyOrderId) + '</span></td><td>'
      + esc(o.zapprOrderId) + '</td><td>' + st(o.status) + '</td><td>' + esc(o.pincode) + '</td><td>' + esc(o.slot) + '</td><td class="dim">'
      + esc(o.metadata?.easyEcomOrderId) + ' / ' + esc(o.metadata?.invoiceId) + '</td></tr>').join('')
    $('webhooks').innerHTML = '<tr><th>created</th><th>order id</th><th>type</th><th>status</th><th>error</th></tr>'
      + d.webhooks.map((w) => '<tr><td>' + fmt(w.createdAt) + '</td><td>' + esc(w.shopifyOrderId) + '</td><td>' + esc(w.eventType) + '</td><td>'
      + st(w.status) + '</td><td class="dim">' + esc(w.error) + '</td></tr>').join('')
    $('logs').innerHTML = '<tr><th>time</th><th>endpoint</th><th>status</th><th>latency</th></tr>'
      + d.logs.map((l) => '<tr><td>' + fmt(l.createdAt) + '</td><td>' + esc(l.endpoint) + '</td><td>'
      + st(l.statusCode >= 400 ? 'err' : '2xx') + ' ' + l.statusCode + '</td><td class="dim">' + esc(l.latencyMs) + ' ms</td></tr>').join('')
  } catch (e) { $('msg').textContent = 'Error: ' + e.message }
}

async function lookup() {
  $('msg').textContent = ''
  const q = $('q').value.trim()
  if (!q) return
  try {
    const d = await api('/admin/api/order?q=' + encodeURIComponent(q))
    $('detail').style.display = 'block'
    $('detail').innerHTML = '<h2>Order detail</h2><pre>' + esc(JSON.stringify(d.mapping, null, 2)) + '</pre>'
      + '<h2>Tracking updates</h2><pre>' + esc(JSON.stringify(d.tracking, null, 2)) + '</pre>'
  } catch (e) { $('detail').style.display = 'none'; $('msg').textContent = 'Lookup: ' + e.message }
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
