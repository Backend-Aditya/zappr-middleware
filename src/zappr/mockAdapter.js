import { buildZapprClient } from './client.js'
import { buildEasyEcomAdapter } from './easyEcomAdapter.js'
import { env } from '../config/env.js'

// Same EasyEcom contract as realAdapter, pointed at mock-zappr-server,
// so ZAPPR_MODE=mock behaves identically to production.
const client = () => buildZapprClient(env.ZAPPR_MOCK_URL, env.ZAPPR_MOCK_API_KEY, env.ZAPPR_MOCK_X_API_KEY)

/** @type {import('./adapter.js').ZapprAdapter} */
export const mockAdapter = buildEasyEcomAdapter(client)
