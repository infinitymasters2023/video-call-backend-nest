import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { BillingService } from './billing.service';
import { SubscriptionService } from './subscription.service';

interface ApiResponse {
  statusCode: number;
  isSuccess: boolean;
  message: string;
  data: any;
}

/**
 * Everything the checkout needs before a payment provider exists.
 *
 * Kept apart from AuthController so the sign-in surface stays untouched, and
 * every price here comes from the plan catalogue the profile page already
 * shows — one source of truth, so a price cannot differ between the two.
 */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly authService: AuthService,
    private readonly billing: BillingService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** Plans, payment methods and tax — enough to render checkout in one call. */
  @Get('config')
  config(): ApiResponse {
    return {
      statusCode: 200,
      isSuccess: true,
      message: 'OK',
      data: {
        plans: this.subscriptions.listPlans(),
        paymentMethods: this.billing.listPaymentMethods(),
        gatewayReady: this.billing.gatewayReady,
      },
    };
  }

  /** Live price for a plan, cycle and seat count. */
  @Get('quote')
  quote(
    @Query('planId') planId: string,
    @Query('cycle') cycle: string,
    @Query('seats') seats: string,
  ): ApiResponse {
    const quote = this.billing.quote(planId, cycle, Number(seats) || 1);

    if (!quote) {
      return {
        statusCode: 400,
        isSuccess: false,
        message: 'That plan cannot be purchased.',
        data: null,
      };
    }

    return { statusCode: 200, isSuccess: true, message: 'OK', data: quote };
  }

  @Post('order')
  async createOrder(
    @Body()
    dto: {
      planId?: string;
      cycle?: string;
      seats?: number;
      method?: string;
      fullName?: string;
      email?: string;
      mobile?: string;
      company?: string;
      gstin?: string;
    },
    @Headers('authorization') authorization?: string,
  ): Promise<ApiResponse> {
    const record = await this.resolve(authorization);
    if (!record) {
      return { statusCode: 401, isSuccess: false, message: 'Not signed in', data: null };
    }

    const order = this.billing.createOrder({
      userId: Number(record.UserID),
      planId: String(dto.planId ?? ''),
      cycle: String(dto.cycle ?? 'monthly'),
      seats: Number(dto.seats ?? 1),
      method: dto.method,
      contact: {
        fullName: dto.fullName ?? record.FullName ?? '',
        email: dto.email ?? record.Email ?? '',
        mobile: dto.mobile ?? record.Mobile ?? '',
        company: dto.company ?? '',
        gstin: dto.gstin ?? '',
      },
    });

    if (!order) {
      return {
        statusCode: 400,
        isSuccess: false,
        message: 'That plan cannot be purchased.',
        data: null,
      };
    }

    return { statusCode: 200, isSuccess: true, message: 'Order created', data: order };
  }

  @Get('order/:orderId')
  async getOrder(
    @Param('orderId') orderId: string,
    @Headers('authorization') authorization?: string,
  ): Promise<ApiResponse> {
    const record = await this.resolve(authorization);
    if (!record) {
      return { statusCode: 401, isSuccess: false, message: 'Not signed in', data: null };
    }

    const order = this.billing.getOrder(orderId, Number(record.UserID));
    return order
      ? { statusCode: 200, isSuccess: true, message: 'OK', data: order }
      : { statusCode: 404, isSuccess: false, message: 'Order not found', data: null };
  }

  @Post('order/:orderId/method')
  async chooseMethod(
    @Param('orderId') orderId: string,
    @Body() dto: { method?: string },
    @Headers('authorization') authorization?: string,
  ): Promise<ApiResponse> {
    const record = await this.resolve(authorization);
    if (!record) {
      return { statusCode: 401, isSuccess: false, message: 'Not signed in', data: null };
    }

    const order = this.billing.setMethod(
      orderId,
      Number(record.UserID),
      String(dto.method ?? ''),
    );

    return order
      ? { statusCode: 200, isSuccess: true, message: 'Payment method selected', data: order }
      : {
          statusCode: 400,
          isSuccess: false,
          message: 'Could not select that payment method.',
          data: null,
        };
  }

  /**
   * Hand the order to the payment provider.
   *
   * Until one is connected this reports honestly that the charge has not been
   * taken, and the order stays retrievable so it can be picked up later.
   */
  @Post('order/:orderId/pay')
  async pay(
    @Param('orderId') orderId: string,
    @Headers('authorization') authorization?: string,
  ): Promise<ApiResponse> {
    const record = await this.resolve(authorization);
    if (!record) {
      return { statusCode: 401, isSuccess: false, message: 'Not signed in', data: null };
    }

    const result = this.billing.submitForPayment(orderId, Number(record.UserID));

    if (!result) {
      return {
        statusCode: 400,
        isSuccess: false,
        message: 'Choose a payment method before continuing.',
        data: null,
      };
    }

    return {
      statusCode: 200,
      isSuccess: true,
      message: result.message,
      data: { order: result.order, gatewayReady: result.gatewayReady },
    };
  }

  @Post('order/:orderId/cancel')
  async cancel(
    @Param('orderId') orderId: string,
    @Headers('authorization') authorization?: string,
  ): Promise<ApiResponse> {
    const record = await this.resolve(authorization);
    if (!record) {
      return { statusCode: 401, isSuccess: false, message: 'Not signed in', data: null };
    }

    const order = this.billing.cancelOrder(orderId, Number(record.UserID));
    return order
      ? { statusCode: 200, isSuccess: true, message: 'Order cancelled', data: order }
      : { statusCode: 404, isSuccess: false, message: 'Order not found', data: null };
  }

  private resolve(authorization?: string) {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    return token ? this.authService.resolveToken(token) : Promise.resolve(null);
  }
}
