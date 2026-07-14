import ky from 'ky'

/**
 * Fire-and-forget log to zappr_logs table. Never blocks the request.
 * @param {object} entry
 */
async function logToDb(entry) {
  try {
    const { getDb } = await import('../db/postgres/connection.js')
    const { zapprLogs } = await import('../db/postgres/schema.js')
    await getDb().insert(zapprLogs).values(entry)
  } catch { /* non-blocking — log failure must never affect the request */ }
}

/**
 * Build a ky instance for a Zappr endpoint.
 * @param {string} baseUrl
 * @param {string} apiKey - JWT bearer token
 * @param {string} [xApiKey] - EasyEcom x-api-key header, required in live mode
 * @returns {import('ky').KyInstance}
 */
export function buildZapprClient(baseUrl, apiKey, xApiKey) {
  return ky.create({
    // ky v2 renamed prefixUrl → baseUrl
    baseUrl,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(xApiKey ? { 'x-api-key': xApiKey } : {}),
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
    },
    timeout: 10_000,
    retry: {
      limit: 3,
      methods: ['get', 'post'],
      statusCodes: [408, 429, 503],
      backoffLimit: 5000,
    },
    // ky v2 hooks receive a single state object ({ request, options, response })
    hooks: {
      beforeRequest: [
        ({ request }) => {
          request._startTime = Date.now()
        },
      ],
      afterResponse: [
        ({ request, response }) => {
          const latencyMs = Date.now() - (request._startTime ?? Date.now())
          logToDb({
            direction: 'outbound',
            endpoint: request.url,
            statusCode: response.status,
            latencyMs,
          })
          return response
        },
      ],
    },
  })
}
