export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode]
   * @param {string} [code]
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
  }
}

export class ZapprApiError extends AppError {
  /**
   * @param {string} message
   * @param {number} [statusCode]
   * @param {unknown} [response]
   */
  constructor(message, statusCode = 502, response) {
    super(message, statusCode, 'ZAPPR_API_ERROR')
    this.name = 'ZapprApiError'
    this.response = response
  }
}

export class ShopifyApiError extends AppError {
  /**
   * @param {string} message
   * @param {number} [statusCode]
   * @param {unknown} [response]
   */
  constructor(message, statusCode = 502, response) {
    super(message, statusCode, 'SHOPIFY_API_ERROR')
    this.name = 'ShopifyApiError'
    this.response = response
  }
}

export class ValidationError extends AppError {
  /**
   * @param {string} message
   * @param {unknown} [issues]
   */
  constructor(message, issues) {
    super(message, 400, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
    this.issues = issues
  }
}

export class HmacError extends AppError {
  constructor() {
    super('HMAC verification failed', 401, 'HMAC_INVALID')
    this.name = 'HmacError'
  }
}
