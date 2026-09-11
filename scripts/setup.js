/**
 * One-time setup script — registers webhook + checks app proxy config.
 * Run: node scripts/setup.js
 */

import 'dotenv/config'
import ky from 'ky'

const STORE = process.env.SHOPIFY_STORE
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET
const NGROK_URL = process.argv[2]

if (!NGROK_URL) {
  console.error('Usage: node scripts/setup.js https://your-ngrok-url.ngrok-free.dev')
  process.exit(1)
}

async function getToken() {
  // Static admin-app token takes precedence (collaborator stores can't use
  // the client credentials grant — see src/shopify/tokenService.js).
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN

  const res = await ky.post(`https://${STORE}/admin/oauth/access_token`, {
    json: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' },
  }).json()
  return res.access_token
}

async function graphql(token, query, variables = {}) {
  const res = await ky.post(
    `https://${STORE}/admin/api/2026-04/graphql.json`,
    {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      json: { query, variables },
    },
  ).json()
  if (res.errors?.length) throw new Error(res.errors.map(e => e.message).join(', '))
  return res.data
}

async function registerWebhook(token, topic, path) {
  const data = await graphql(token, `
    mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
      webhookSubscriptionCreate(
        topic: $topic
        webhookSubscription: { format: JSON, callbackUrl: $callbackUrl }
      ) {
        webhookSubscription { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
        userErrors { field message }
      }
    }
  `, { topic, callbackUrl: `${NGROK_URL}${path}` })
  const { userErrors, webhookSubscription } = data.webhookSubscriptionCreate
  if (userErrors?.length) throw new Error(userErrors.map(e => e.message).join(', '))
  return {
    ...webhookSubscription,
    address: webhookSubscription.endpoint?.callbackUrl ?? '',
  }
}

async function listWebhooks(token) {
  const data = await graphql(token, `
    { webhookSubscriptions(first: 20) { nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }
  `)
  return data.webhookSubscriptions.nodes.map(n => ({
    id: n.id,
    topic: n.topic,
    address: n.endpoint?.callbackUrl ?? '',
  }))
}

const WEBHOOK_TOPICS = [
  { topic: 'ORDERS_PAID', path: '/webhooks/orders-paid' },
  { topic: 'ORDERS_CANCELLED', path: '/webhooks/orders-cancelled' },
  { topic: 'FULFILLMENT_ORDERS_MOVED', path: '/webhooks/fulfillment-order-moved' },
]

async function main() {
  console.log(`Setting up zappr-middleware for ${STORE}...`)
  console.log(`Ngrok URL: ${NGROK_URL}\n`)

  const token = await getToken()
  console.log('✓ Token obtained')

  // Check existing webhooks
  const existing = await listWebhooks(token)

  for (const { topic, path } of WEBHOOK_TOPICS) {
    const alreadyExists = existing.find((w) => w.topic === topic)

    if (alreadyExists) {
      console.log(`✓ ${topic} webhook already registered → ${alreadyExists.address}`)
      if (!alreadyExists.address.includes(NGROK_URL)) {
        console.log(`  ⚠ URL mismatch — delete old webhook ID ${alreadyExists.id} first:`)
        console.log(`  curl -X DELETE https://${STORE}/admin/api/2026-04/webhooks/${alreadyExists.id}.json -H "X-Shopify-Access-Token: ${token}"`)
      }
    } else {
      const webhook = await registerWebhook(token, topic, path)
      console.log(`✓ Webhook registered (ID: ${webhook.id})`)
      console.log(`  Topic:   ${webhook.topic}`)
      console.log(`  Address: ${webhook.address}`)
    }
  }

  console.log('\n── Next steps ──────────────────────────────────────────')
  console.log('1. SHOPIFY_WEBHOOK_SECRET: get from Shopify Admin → Settings → Notifications → Webhooks')
  console.log(`   or: https://${STORE}/admin/settings/notifications`)
  console.log('2. App Proxy: set in Partner/Dev Dashboard → App → Extensions → App proxy')
  console.log(`   Proxy URL: ${NGROK_URL}`)
  console.log('   Subpath prefix: apps  |  Subpath: zappr')
  console.log('────────────────────────────────────────────────────────')
}

main().catch((err) => {
  console.error('Setup failed:', err.message)
  process.exit(1)
})
