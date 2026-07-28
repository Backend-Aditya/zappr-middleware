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
