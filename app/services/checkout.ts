/**
 * Checkout Service
 * Handles the complete checkout flow including cart validation,
 * payment processing, and order finalization
 */

import { PaymentGateway, PaymentProcessingError } from './payment';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { DatabasePool, Transaction } from '../lib/database';
import { EmailService } from './email';
import { InventoryService } from './inventory';
import { Cart, Order, PaymentDetails, CheckoutResult } from '../types';

export class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export class TransactionRollbackError extends CheckoutError {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionRollbackError';
  }
}

export class CheckoutService {
  private paymentGateway: PaymentGateway;
  private db: DatabasePool;
  private emailService: EmailService;
  private inventoryService: InventoryService;

  constructor() {
    this.paymentGateway = new PaymentGateway({
      timeout: 30000,
      retries: 3,
    });
    this.db = DatabasePool.getInstance();
    this.emailService = new EmailService();
    this.inventoryService = new InventoryService();
  }

  /**
   * Validate cart items and availability
   */
  async validateCart(cartId: string): Promise<Cart> {
    const cart = await this.db.query(
      'SELECT * FROM carts WHERE id = ? AND status = ?',
      [cartId, 'active']
    );

    if (!cart) {
      throw new CheckoutError('Cart not found or expired');
    }

    // Validate inventory
    for (const item of cart.items) {
      const available = await this.inventoryService.checkAvailability(
        item.productId,
        item.quantity
      );
      if (!available) {
        throw new CheckoutError(`Product ${item.productId} is out of stock`);
      }
    }

    return cart;
  }

  /**
   * Finalize the order and process payment
   * This is the main checkout entry point
   */
  async finalizeOrder(
    cartId: string,
    paymentDetails: PaymentDetails
  ): Promise<CheckoutResult> {
    console.log(`Starting checkout for cart ${cartId}`);

    // Validate the cart first
    const cart = await this.validateCart(cartId);
    console.log(`Cart validated: ${cart.items.length} items, total: $${cart.total}`);

    // Create the order
    const order: Order = {
      id: `ORD-${Date.now()}`,
      cartId: cart.id,
      userId: cart.userId,
      items: cart.items,
      total: cart.total,
      currency: 'USD',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // Start database transaction
    const transaction = await this.db.beginTransaction();

    try {
      // Insert the order
      await transaction.query(
        'INSERT INTO orders (id, user_id, total, status) VALUES (?, ?, ?, ?)',
        [order.id, order.userId, order.total, 'pending']
      );

      // Reserve inventory
      for (const item of order.items) {
        await this.inventoryService.reserveStock(item.productId, item.quantity);
      }

      // Process the payment
      const paymentResult = await this.paymentGateway.processPayment(
        order,
        paymentDetails
      );

      if (!paymentResult.success) {
        throw new PaymentProcessingError('Payment failed');
      }

      // Update order with payment info
      await transaction.query(
        'UPDATE orders SET status = ?, transaction_id = ? WHERE id = ?',
        ['paid', paymentResult.transactionId, order.id]
      );

      // Mark cart as completed
      await transaction.query(
        'UPDATE carts SET status = ? WHERE id = ?',
        ['completed', cartId]
      );

      // Commit the transaction
      await this.db.transaction.commit(); // Failed to commit

      // Send confirmation email
      await this.emailService.sendOrderConfirmation(order);

      return { success: true, orderId: order.id };
    } catch (error) {
      // Rollback on any error
      console.error('Checkout failed, rolling back:', error);

      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
        throw new TransactionRollbackError(
          `Failed to commit payment transaction: ${error}`
        );
      }

      // Release reserved inventory
      for (const item of order.items) {
        await this.inventoryService.releaseStock(item.productId, item.quantity);
      }

      throw error;
    }
  }

  /**
   * Calculate order totals including tax and shipping
   */
  async calculateTotals(cartId: string): Promise<{
    subtotal: number;
    tax: number;
    shipping: number;
    total: number;
  }> {
    const cart = await this.validateCart(cartId);

    const subtotal = cart.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const tax = subtotal * 0.08; // 8% tax
    const shipping = subtotal > 50 ? 0 : 5.99; // Free shipping over $50
    const total = subtotal + tax + shipping;

    return { subtotal, tax, shipping, total };
  }
}
