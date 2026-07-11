/**
 * One-time OAuth token grab for stores outside the app's organization
 * (collaborator/client stores where the client credentials grant is refused).
 *
 * Prereq (Dev Dashboard → your app → Configuration):
 *   - Allowed redirection URL(s) must include: http://localhost:3456/callback
 *   - Distribution: custom (single store)
 *
 * Run: node scripts/get-token.js
 * Opens the install/consent URL, captures the callback, exchanges the code
 * for a permanent offline token and prints it. Paste it into .env as
 * SHOPIFY_ADMIN_TOKEN.
 */

import 'dotenv/config'
import http from 'node:http'
import ky from 'ky'

const STORE = process.env.SHOPIFY_STORE
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET
const PORT = 3456
const REDIRECT_URI = `http://localhost:${PORT}/callback`
const SCOPES = 'read_orders,read_products,read_inventory'

const authUrl
  = `https://${STORE}/admin/oauth/authorize`
    + `?client_id=${CLIENT_ID}`
    + `&scope=${SCOPES}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI)
  if (url.pathname !== '/callback') {
    res.writeHead(404).end()
    return
  }

  const code = url.searchParams.get('code')
  if (!code) {
    res.writeHead(400).end('Missing ?code param')
    return
  }

  try {
    const data = await ky.post(`https://${STORE}/admin/oauth/access_token`, {
      json: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code },
    }).json()

    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('Token obtained — check your terminal. You can close this tab.')

    console.log('\n✓ Offline access token obtained\n')
    console.log(`  SHOPIFY_ADMIN_TOKEN=${data.access_token}`)
    console.log(`\n  Granted scopes: ${data.scope}`)
    console.log('\nPaste the line above into .env, then re-run scripts/setup.js')
  } catch (err) {
    res.writeHead(500).end('Token exchange failed — check terminal')
    console.error('Token exchange failed:', err.message)
  } finally {
    server.close()
  }
})

server.listen(PORT, () => {
  console.log(`Listening on ${REDIRECT_URI} for the OAuth callback...\n`)
  console.log('Open this URL in the browser where you are logged into the store admin:\n')
  console.log(`  ${authUrl}\n`)
})
