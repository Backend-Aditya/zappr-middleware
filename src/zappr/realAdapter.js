import { buildZapprClient } from './client.js'
import { buildEasyEcomAdapter } from './easyEcomAdapter.js'
import { getEasyEcomToken } from './tokenService.js'
import { env } from '../config/env.js'

// ZAPPR_BASE_URL/API_KEY/X_API_KEY are required by the env schema, so
// createEnv() already refuses to boot without them. getEasyEcomToken()
// returns a Supabase-refreshed JWT when configured, else ZAPPR_API_KEY as-is.
const client = async () => buildZapprClient(env.ZAPPR_BASE_URL, await getEasyEcomToken(), env.ZAPPR_X_API_KEY)

/** @type {import('./adapter.js').ZapprAdapter} */
export const realAdapter = buildEasyEcomAdapter(client)
