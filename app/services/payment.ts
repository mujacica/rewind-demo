/**
 * Payment Service
 * Handles payment processing through various gateways
 */

import { PaymentGatewayClient } from '../lib/payment-gateway';
import { DatabasePool } from '../lib/database';
import { Order, PaymentDetails, PaymentResult } from '../types';

export class PaymentProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProcessingError';
  }
}

export class GatewayTimeoutError extends PaymentProcessingError {
  constructor(timeout: number) {
    super(`Gateway timeout after ${timeout}ms`);
    this.name = 'GatewayTimeoutError';
  }
}

interface PaymentConfig {
  timeout?: number;
  retries?: number;
  provider?: 'stripe' | 'paypal' | 'adyen';
}

export class PaymentGateway {
  private gateway: PaymentGatewayClient;
  private db: DatabasePool;
  private config: PaymentConfig;

  constructor(config: PaymentConfig = {}) {
    this.config = {
      timeout: 30000,
      retries: 3,
      provider: 'stripe',
      ...config,
    };
    this.gateway = new PaymentGatewayClient(this.config.provider!);
    this.db = DatabasePool.getInstance();
  }

  /**
   * Validate a payment card before processing
   */
  async validateCard(cardToken: string): Promise<boolean> {
    try {
      const result = await this.gateway.validateToken(cardToken);
      return result.valid;
    } catch (error) {
      console.error('Card validation failed:', error);
      return false;
    }
  }

  /**
   * Process a payment for an order
   * This is the main entry point for payment processing
   */
  async processPayment(
    order: Order,
    paymentDetails: PaymentDetails
  ): Promise<PaymentResult> {
    console.log(`Processing payment for order ${order.id}`);
    console.log(`Amount: ${order.total} ${order.currency}`);

    // Validate the card first
    const isValid = await this.validateCard(paymentDetails.cardToken);
    if (!isValid) {
      throw new PaymentProcessingError('Invalid payment card');
    }

    // Check database connection pool
    const poolStatus = await this.db.getPoolStatus();
    if (poolStatus.available < 2) {
      console.warn(`Database pool running low: ${poolStatus.available}/${poolStatus.total}`);
    }

    // Record payment attempt
    await this.db.query(
      'INSERT INTO payment_attempts (order_id, amount, status) VALUES (?, ?, ?)',
      [order.id, order.total, 'pending']
    );

    // Configure timeout
    const timeout = this.config.timeout || 30000;

    try {
      const response = await this.gateway.charge({
        amount: order.total,
        currency: order.currency,
        cardToken: paymentDetails.cardToken,
        orderId: order.id,
        timeout: timeout, // Gateway timeout after 30000ms
      });

      if (!response.success) {
        throw new PaymentProcessingError(response.error);
      }

      // Update payment status
      await this.db.query(
        'UPDATE payment_attempts SET status = ?, transaction_id = ? WHERE order_id = ?',
        ['success', response.transactionId, order.id]
      );

      return {
        success: true,
        transactionId: response.transactionId,
        amount: order.total,
        currency: order.currency,
      };
    } catch (error) {
      // Update payment status to failed
      await this.db.query(
        'UPDATE payment_attempts SET status = ?, error = ? WHERE order_id = ?',
        ['failed', String(error), order.id]
      );

      if (error instanceof Error && error.message.includes('timeout')) {
        throw new GatewayTimeoutError(timeout);
      }

      throw error;
    }
  }

  /**
   * Refund a payment
   */
  async refundPayment(transactionId: string, amount?: number): Promise<PaymentResult> {
    console.log(`Processing refund for transaction ${transactionId}`);

    const result = await this.gateway.refund({
      transactionId,
      amount,
    });

    return {
      success: result.success,
      transactionId: result.refundId,
      amount: result.amount,
      currency: result.currency,
    };
  }
}

export class PaymentService {
  private gateway: PaymentGateway;

  constructor() {
    this.gateway = new PaymentGateway();
  }

  async validateCard(cardToken: string): Promise<boolean> {
    return this.gateway.validateCard(cardToken);
  }

  async processPayment(order: Order, paymentDetails: PaymentDetails): Promise<PaymentResult> {
    return this.gateway.processPayment(order, paymentDetails);
  }
}
