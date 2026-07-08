import { buildZapprClient } from './client.js'
import { buildEasyEcomAdapter } from './easyEcomAdapter.js'
import { env } from '../config/env.js'
import { ZapprApiError } from '../errors.js'

const client = () => {
  if (!env.ZAPPR_BASE_URL || !env.ZAPPR_API_KEY || !env.ZAPPR_X_API_KEY) {
    throw new ZapprApiError('ZAPPR_BASE_URL, ZAPPR_API_KEY and ZAPPR_X_API_KEY required in live mode', 500)
  }
  return buildZapprClient(env.ZAPPR_BASE_URL, env.ZAPPR_API_KEY, env.ZAPPR_X_API_KEY)
}

/** @type {import('./adapter.js').ZapprAdapter} */
export const realAdapter = buildEasyEcomAdapter(client)
