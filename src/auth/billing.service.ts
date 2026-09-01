import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  BillingCycle,
  CURRENCY,
  PLANS,
  PlanId,
  TAX_PERCENT,
} from './subscription.service';

export type PaymentMethodId = 'card' | 'upi' | 'netbanking' | 'wallet';

export interface PaymentMethod {
  id: PaymentMethodId;
  name: string;
  description: string;
  /** False while the gateway for it is not connected yet. */
  available: boolean;
}

/**
 * How a customer may pay.
 *
 * Everything is marked unavailable until a gateway is wired in — the checkout
 * still walks the full journey and stops at the last step, which is the only
 * part that needs the gateway.
 */
export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'card',
    name: 'Credit / Debit card',
    description: 'Visa, Mastercard, RuPay and Amex',
    available: false,
  },
  {
    id: 'upi',
    name: 'UPI',
    description: 'Google Pay, PhonePe, Paytm or any UPI app',
    available: false,
  },
  {
    id: 'netbanking',
    name: 'Net banking',
    description: 'All major Indian banks',
    available: false,
  },
  {
    id: 'wallet',
    name: 'Wallet',
    description: 'Paytm, Amazon Pay and more',
    available: false,
  },
];

export interface OrderQuote {
  planId: PlanId;
  planName: string;
  cycle: BillingCycle;
  seats: number;
  currency: string;
  /** Undiscounted list price for the chosen cycle and seats. */
  subtotal: number;
  /** What the yearly cycle saves against twelve monthly payments. */
  savings: number;
  taxPercent: number;
  tax: number;
  total: number;
  /** When the next renewal would fall, as an ISO date. */
  renewsOn: string;
}

export type OrderStatus = 'awaiting_payment' | 'payment_pending' | 'cancelled';

export interface BillingContact {
  fullName: string;
  email: string;
  mobile: string;
  company: string;
  gstin: string;
}

export interface Order extends OrderQuote {
  orderId: string;
  userId: number;
  status: OrderStatus;
  method: PaymentMethodId | null;
  contact: BillingContact;
  createdAt: string;
  updatedAt: string;
}

const MAX_SEATS = 100;
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The checkout, minus the money.
 *
 * Pricing, seat maths, tax and the order record are all real and identical in
 * development and production. Only the final capture is missing, so plugging a
 * gateway in later is one method on this service rather than a new flow.
 *
 * Orders live in memory because nothing is charged yet — an unpaid draft that
 * does not survive a restart costs nobody anything, and it keeps the live
 * database schema untouched until there is a payment worth recording.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly orders = new Map<string, Order>();

  listPaymentMethods(): PaymentMethod[] {
    return PAYMENT_METHODS;
  }

  /** True once at least one method can actually take money. */
  get gatewayReady(): boolean {
    return PAYMENT_METHODS.some((m) => m.available);
  }

  /**
   * Price a plan for a cycle and seat count.
   *
   * Returns null for an unknown plan or a free one, so the caller can say why
   * instead of quoting zero.
   */
  quote(planId: string, cycle: string, seats: number): OrderQuote | null {
    const plan = PLANS[planId as PlanId];
    const billingCycle: BillingCycle = cycle === 'yearly' ? 'yearly' : 'monthly';

    if (!plan || plan.id === 'free') return null;

    const count = Math.min(MAX_SEATS, Math.max(1, Math.floor(Number(seats) || 1)));
    const subtotal = plan.price[billingCycle] * count;
    const savings =
      billingCycle === 'yearly'
        ? Math.max(0, plan.price.monthly * 12 * count - subtotal)
        : 0;
    const tax = Math.round((subtotal * TAX_PERCENT) / 100);

    const renewsOn = new Date();
    if (billingCycle === 'yearly') {
      renewsOn.setFullYear(renewsOn.getFullYear() + 1);
    } else {
      renewsOn.setMonth(renewsOn.getMonth() + 1);
    }

    return {
      planId: plan.id,
      planName: plan.name,
      cycle: billingCycle,
      seats: count,
      currency: CURRENCY,
      subtotal,
      savings,
      taxPercent: TAX_PERCENT,
      tax,
      total: subtotal + tax,
      renewsOn: renewsOn.toISOString(),
    };
  }

  /** Start an order. The customer has chosen what to buy but not yet paid. */
  createOrder(input: {
    userId: number;
    planId: string;
    cycle: string;
    seats: number;
    method?: string | null;
    contact: Partial<BillingContact>;
  }): Order | null {
    const quote = this.quote(input.planId, input.cycle, input.seats);
    if (!quote) return null;

    this.sweepExpired();

    const now = new Date().toISOString();
    const order: Order = {
      ...quote,
      orderId: `ord_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
      userId: input.userId,
      status: 'awaiting_payment',
      method: this.normaliseMethod(input.method),
      contact: {
        fullName: String(input.contact.fullName ?? '').trim(),
        email: String(input.contact.email ?? '').trim(),
        mobile: String(input.contact.mobile ?? '').trim(),
        company: String(input.contact.company ?? '').trim(),
        gstin: String(input.contact.gstin ?? '').trim().toUpperCase(),
      },
      createdAt: now,
      updatedAt: now,
    };

    this.orders.set(order.orderId, order);
    this.logger.log(
      `Order ${order.orderId}: ${order.planName} ${order.cycle} x${order.seats} = ${order.currency} ${order.total}`,
    );
    return order;
  }

  getOrder(orderId: string, userId: number): Order | null {
    const order = this.orders.get(orderId);
    return order && order.userId === userId ? order : null;
  }

  /** Record the chosen payment method against an order. */
  setMethod(orderId: string, userId: number, method: string): Order | null {
    const order = this.getOrder(orderId, userId);
    const chosen = this.normaliseMethod(method);
    if (!order || !chosen) return null;

    order.method = chosen;
    order.updatedAt = new Date().toISOString();
    return order;
  }

  /**
   * The last step before money changes hands.
   *
   * With no gateway connected this parks the order and reports that clearly,
   * rather than pretending a payment succeeded. When a gateway is added, this
   * is where its session is created and its handle returned.
   */
  submitForPayment(
    orderId: string,
    userId: number,
  ): { order: Order; gatewayReady: boolean; message: string } | null {
    const order = this.getOrder(orderId, userId);
    if (!order || !order.method) return null;

    order.status = 'payment_pending';
    order.updatedAt = new Date().toISOString();

    return {
      order,
      gatewayReady: this.gatewayReady,
      message: this.gatewayReady
        ? 'Redirecting you to the payment provider.'
        : 'Your order is saved. Online payment is not switched on yet — our team will contact you to complete it.',
    };
  }

  cancelOrder(orderId: string, userId: number): Order | null {
    const order = this.getOrder(orderId, userId);
    if (!order) return null;

    order.status = 'cancelled';
    order.updatedAt = new Date().toISOString();
    return order;
  }

  private normaliseMethod(method?: string | null): PaymentMethodId | null {
    const found = PAYMENT_METHODS.find((m) => m.id === String(method ?? '').trim());
    return found ? found.id : null;
  }

  /** Drop drafts nobody came back to, so the map cannot grow without bound. */
  private sweepExpired() {
    const cutoff = Date.now() - ORDER_TTL_MS;
    for (const [id, order] of this.orders) {
      if (new Date(order.createdAt).getTime() < cutoff) this.orders.delete(id);
    }
  }
}
