export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR'
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NoHealthyKeysError extends AppError {
  constructor() {
    super('No healthy API keys available', 503, 'NO_HEALTHY_KEYS')
  }
}

export class SpendingLimitExceededError extends AppError {
  constructor() {
    super('All available keys have reached their spending limits', 503, 'SPENDING_LIMIT_EXCEEDED')
  }
}

export class SellerNotFoundError extends AppError {
  constructor() {
    super('Seller not found', 404, 'SELLER_NOT_FOUND')
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

export class PricingUnavailableError extends AppError {
  constructor(model: string) {
    super(`Pricing not available for model: ${model}`, 400, 'PRICING_UNAVAILABLE')
  }
}
