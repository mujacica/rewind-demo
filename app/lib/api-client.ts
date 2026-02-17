/**
 * External API Client
 * Handles requests to external APIs with retry logic and rate limiting
 */

// Custom error types
export class RateLimitError extends Error {
  public retryAfter: number;

  constructor(message: string, retryAfter: number = 60) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class ExternalAPIError extends Error {
  public statusCode: number;
  public endpoint: string;

  constructor(message: string, statusCode: number = 500, endpoint: string = '') {
    super(message);
    this.name = 'ExternalAPIError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
  }
}

export class RetryExhaustedError extends Error {
  public attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
  }
}

// Types
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

interface ClientConfig {
  baseUrl: string;
  apiKey?: string;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

/**
 * ExternalAPIClient - Handles external API requests with resilience patterns
 */
export class ExternalAPIClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private maxRetries: number;
  private retryDelay: number;
  private timeout: number;
  private requestCount: number = 0;
  private rateLimitThreshold: number = 100;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;
    this.timeout = config.timeout ?? 30000;

    this.headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (config.apiKey) {
      this.headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
  }

  /**
   * Make a request to the external API
   */
  async request<T = unknown>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(this.baseUrl + endpoint, {
      ...options,
      headers: { ...this.headers, ...options.headers },
    });
    if (response.status === 429) throw new RateLimitError("Rate limit exceeded");

    if (!response.ok) {
      throw new ExternalAPIError(`Request failed: ${response.status}`);
    }

    const data = await response.json();
    this.requestCount++;

    return data as T;
  }

  /**
   * Make a request with automatic retry on failure
   */
  async requestWithRetry<T = unknown>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.maxRetries) {
      try {
        return await this.request<T>(endpoint, options);
      } catch (error) {
        lastError = error as Error;
        attempt++;

        // Don't retry on rate limit - throw immediately
        if (error instanceof RateLimitError) {
          throw error;
        }

        if (attempt < this.maxRetries) {
          // Exponential backoff
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    throw new RetryExhaustedError(
      `Max retries (${this.maxRetries}) exceeded: ${lastError?.message}`,
      this.maxRetries
    );
  }

  /**
   * Check if we're approaching rate limit
   */
  isApproachingRateLimit(): boolean {
    return this.requestCount >= this.rateLimitThreshold * 0.9;
  }

  /**
   * Reset request counter (typically called on new time window)
   */
  resetRequestCount(): void {
    this.requestCount = 0;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * GET request helper
   */
  async get<T = unknown>(endpoint: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * POST request helper
   */
  async post<T = unknown>(endpoint: string, body: unknown, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body,
    });
  }
}

// Create a default client for payment gateway
export const paymentGatewayClient = new ExternalAPIClient({
  baseUrl: 'https://api.payment-gateway.com',
  apiKey: process.env.PAYMENT_GATEWAY_API_KEY,
  maxRetries: 3,
  timeout: 30000,
});
