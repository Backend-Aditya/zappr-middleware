import { Router } from 'express'

const router = Router()

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zappr Middleware</title>
<style>
  :root { --bg:#0d1117; --card:#161c24; --line:#28313c; --text:#e2e8f0; --dim:#94a3b8; --accent:#60a5fa; }
  * { box-sizing:border-box; margin:0 }
  body { background:var(--bg); color:var(--text); font:15px/1.6 system-ui,Segoe UI,sans-serif; padding:40px 20px; max-width:760px; margin:0 auto }
  h1 { font-size:22px; margin-bottom:4px }
  .sub { color:var(--dim); margin-bottom:28px }
  .flow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:28px; justify-content:center }
  .node { border:1px solid var(--line); border-radius:8px; padding:8px 16px; background:var(--bg); font-weight:600 }
  .arrow { color:var(--dim) }
  ul { list-style:none }
  li { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 18px; margin-bottom:10px }
  li b { display:block; margin-bottom:2px }
  li span { color:var(--dim); font-size:13.5px }
  .foot { color:var(--dim); font-size:13px; margin-top:24px }
  a { color:var(--accent); text-decoration:none }
</style>
</head>
<body>
<h1>Zappr Middleware</h1>
<div class="sub">Shopify ↔ Zappr (EasyEcom) quick-delivery integration for Unived</div>

<div class="flow">
  <span class="node">Shopify Store</span><span class="arrow">⇄</span>
  <span class="node">Middleware</span><span class="arrow">⇄</span>
  <span class="node">Zappr / EasyEcom</span>
</div>

<ul>
  <li><b>Storefront delivery check</b><span>Pincode widget on product pages — verifies serviceable area, product eligibility, and live warehouse stock, then shows a same-day / next-day promise with the delivery fee.</span></li>
  <li><b>Automatic order push</b><span>Paid Shopify orders are verified and pushed to Zappr in the background, with retries and safe fallback to standard fulfillment when quick delivery isn't possible.</span></li>
  <li><b>Tracking sync</b><span>Courier status and AWB numbers flow back via webhooks and polling, creating and updating the Shopify fulfillment automatically.</span></li>
  <li><b>Cancellation propagation</b><span>Cancels are forwarded to Zappr so no dead orders sit in the warehouse queue.</span></li>
  <li><b>Secure by default</b><span>Shopify HMAC verification on webhooks and App Proxy requests, shared-secret tokens on inbound Zappr webhooks, rate limiting on public endpoints.</span></li>
  <li><b>Operations dashboard</b><span>Live order statuses, webhook events, and Zappr API logs at <a href="/admin">/admin</a> (token required).</span></li>
</ul>

<div class="foot">Status: <a href="/health">/health</a> · <a href="/ready">/ready</a></div>
</body>
</html>`

router.get('/', (_req, res) => {
  res.type('html').send(PAGE)
})

export default router
