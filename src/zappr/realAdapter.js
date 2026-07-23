import { buildZapprClient } from './client.js'
import { buildEasyEcomAdapter } from './easyEcomAdapter.js'
import { env } from '../config/env.js'

// ZAPPR_BASE_URL/API_KEY/X_API_KEY are required by the env schema, so
// createEnv() already refuses to boot without them.
const client = () => buildZapprClient(env.ZAPPR_BASE_URL, env.ZAPPR_API_KEY, env.ZAPPR_X_API_KEY)

/** @type {import('./adapter.js').ZapprAdapter} */
export const realAdapter = buildEasyEcomAdapter(client)
