/**
 * Checkout API Route
 * Handles the checkout process including cart validation and payment
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextResponse } from 'next/server';
import { CheckoutService } from '@/app/services/checkout';
import { validateCartItems } from '@/lib/cart-validator';
import { logCheckoutEvent } from '@/lib/analytics';

// Types for checkout request/response
interface CheckoutRequest {
  cartId: string;
  paymentMethod: {
    type: 'card' | 'paypal' | 'apple_pay';
    token: string;
    last4?: string;
  };
  shippingAddress?: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
}

interface CheckoutResponse {
  success: boolean;
  orderId?: string;
  error?: string;
  transactionId?: string;
}

/**
 * POST /api/checkout
 * Process a checkout request
 */
export async function POST(request: Request): Promise<NextResponse<CheckoutResponse>> {
  const { cartId, paymentMethod } = await request.json();

  // Validate the incoming request
  if (!cartId || !paymentMethod) {
    return NextResponse.json({
      success: false,
      error: 'Missing required fields: cartId and paymentMethod',
    }, { status: 400 });
  }

  const checkoutService = new CheckoutService();

  const result = await checkoutService.finalizeOrder(cartId, paymentMethod);

  return NextResponse.json(result);
}

/**
 * GET /api/checkout
 * Get checkout status or summary
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cartId = searchParams.get('cartId');

  if (!cartId) {
    return NextResponse.json({
      error: 'Cart ID is required',
    }, { status: 400 });
  }

  const checkoutService = new CheckoutService();

  try {
    const totals = await checkoutService.calculateTotals(cartId);
    return NextResponse.json({
      success: true,
      totals,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
