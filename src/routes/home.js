import { Router } from 'express'

const router = Router()

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zappr Middleware</title>
<style>
  :root {
    --bg: oklch(1 0 0);
    --surface: oklch(0.975 0.006 290);
    --border: oklch(0.90 0.012 290);
    --ink: oklch(0.22 0.02 290);
    --muted: oklch(0.48 0.02 290);
    --primary: oklch(0.55 0.14 290);
    --primary-ink: oklch(0.98 0 0);
    --primary-soft: oklch(0.94 0.03 290);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: oklch(0.12 0 0);
      --surface: oklch(0.17 0 0);
      --border: oklch(0.27 0 0);
      --ink: oklch(0.93 0 0);
      --muted: oklch(0.64 0 0);
      --primary: oklch(0.72 0.12 290);
      --primary-ink: oklch(0.12 0 0);
      --primary-soft: oklch(0.22 0.03 290);
    }
  }

  * { box-sizing: border-box; margin: 0 }
  html { color-scheme: light dark }
  body {
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.6 -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px clamp(20px, 5vw, 48px);
    border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px }
  .brand .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--primary); flex-shrink: 0 }
  .navlinks { display: flex; gap: 24px; flex-wrap: wrap }
  .navlinks a { color: var(--muted); text-decoration: none; font-size: 14.5px; font-weight: 500 }
  .navlinks a:hover, .navlinks a:focus-visible { color: var(--ink) }

  main {
    max-width: 640px;
    margin: 0 auto;
    padding: clamp(56px, 12vh, 104px) 20px 64px;
    text-align: center;
  }
  h1 {
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    letter-spacing: -0.02em;
    line-height: 1.15;
    text-wrap: balance;
    margin-bottom: 16px;
  }
  .lede {
    color: var(--muted);
    font-size: 1.0625rem;
    line-height: 1.65;
    max-width: 52ch;
    margin: 0 auto 40px;
    text-wrap: pretty;
  }

  .flow {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 40px;
  }
  .flow .node {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 16px;
    background: var(--surface);
    font-size: 13.5px;
    font-weight: 500;
  }
  .flow .arrow { color: var(--muted); font-size: 14px }

  .cta { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 11px 22px;
    border-radius: 8px;
    font-size: 14.5px;
    font-weight: 600;
    text-decoration: none;
    border: 1px solid transparent;
    transition: background-color 150ms ease-out, border-color 150ms ease-out;
  }
  .btn-primary { background: var(--primary); color: var(--primary-ink) }
  .btn-primary:hover, .btn-primary:focus-visible { background: color-mix(in oklch, var(--primary) 88%, black) }
  .btn-secondary { background: transparent; color: var(--ink); border-color: var(--border) }
  .btn-secondary:hover, .btn-secondary:focus-visible { background: var(--surface) }
  .btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }

  footer {
    text-align: center;
    padding: 24px 20px 40px;
    color: var(--muted);
    font-size: 13px;
  }
  footer a { color: inherit }
</style>
</head>
<body>

<nav>
  <div class="brand"><span class="dot"></span> Zappr Middleware</div>
  <div class="navlinks">
    <a href="/admin">Admin</a>
    <a href="/health">Health</a>
    <a href="/ready">Ready</a>
  </div>
</nav>

<main>
  <h1>Shopify and Zappr, kept in sync automatically</h1>
  <p class="lede">
    This service connects Unived's Shopify store to Zappr's quick-delivery network —
    checking stock and pincode availability, pushing paid orders through, and keeping
    delivery tracking up to date without anyone needing to do it by hand.
  </p>

  <div class="flow">
    <span class="node">Shopify Store</span><span class="arrow">⇄</span>
    <span class="node">Middleware</span><span class="arrow">⇄</span>
    <span class="node">Zappr / EasyEcom</span>
  </div>

  <div class="cta">
    <a class="btn btn-primary" href="/admin">Open dashboard</a>
    <a class="btn btn-secondary" href="/health">Check system health</a>
  </div>
</main>

<footer>
  Status endpoints: <a href="/health">/health</a> · <a href="/ready">/ready</a>
</footer>

</body>
</html>`

router.get('/', (_req, res) => {
  res.type('html').send(PAGE)
})

export default router
