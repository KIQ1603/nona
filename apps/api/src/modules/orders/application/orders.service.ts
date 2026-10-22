import { PhoneVerificationService } from '../../accounts/application/phone-verification.service';
import { Inject, Injectable } from '@nestjs/common';
import {
  normalizeVnPhone,
  CUSTOMER_CANCELLABLE,
  type CartDto,
  type OrderDto,
  type QuoteDto,
  type shippingAddressInputSchema,
} from '@nona/contracts';
import type pg from 'pg';
import type { z } from 'zod';
import { AppError } from '../../../common/errors/app-error';
import {
  IdempotencyService,
  type IdempotencyOwner,
} from '../../../common/idempotency/idempotency.service';
import { enqueueOutbox } from '../../../common/outbox/outbox';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../platform/database/database.service';
import { CartService } from '../../cart/application/cart.service';
import { CartRepository, hashToken, type Owner } from '../../cart/infrastructure/cart.repository';
import { DesignsService } from '../../designs/application/designs.service';
import { CouponsService, type Customer } from '../../coupons/application/coupons.service';
import { PaymentGateway } from '../../payments/application/payment-gateway';
import { RefundsService } from '../../payments/application/refunds.service';
import { SettingsService } from '../../settings/application/settings.service';
import { generateOrderCode } from '../domain/order-code';
import { customerCanCancel } from '../domain/order-state';
import { priceOrder, type AppliedDiscount, type PricingResult } from '../domain/pricing';
import { resolveShipping, type ResolvedShipping } from '../domain/shipping-zone';
import { OrdersRepository, type OrderRow } from '../infrastructure/orders.repository';
import { cancelOrderInTx } from './order-cancellation';
import { orderPlacedPayload } from './order-events';
import { toOrderDto } from './order.mapper';

type ShippingAddress = z.infer<typeof shippingAddressInputSchema>;
export interface PlaceOrderInput {
  addressId?: string;
  shippingAddress?: ShippingAddress;
  contactEmail?: string;
  customerNote?: string;
  paymentMethod: 'COD' | 'VNPAY';
  expectedTotalVnd: number;
  lineIds?: string[];
}
export interface Viewer {
  userId?: string;
}

/** `::ffff:1.2.3.4` and `::1` are what Node reports for local IPv4/IPv6; VNPay wants plain IPv4. */
export const clientIp = (ip?: string) =>
  (ip ?? '127.0.0.1').replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');

@Injectable()
export class OrdersService {
  private readonly mediaBase: string;
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OrdersRepository) private readonly repo: OrdersRepository,
    @Inject(CartRepository) private readonly carts: CartRepository,
    @Inject(CartService) private readonly cartService: CartService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CouponsService) private readonly coupons: CouponsService,
    @Inject(DesignsService) private readonly designs: DesignsService,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
    @Inject(RefundsService) private readonly refunds: RefundsService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(PhoneVerificationService) private readonly phones: PhoneVerificationService,
    @Inject(ENV) env: Env,
  ) {
    this.mediaBase = env.MEDIA_BASE_URL.replace(/\/$/, '');
  }

  // ---- quote ------------------------------------------------------------------------------------

  /** Authoritative pricing preview computed from live data. The browser only displays it. */
  async quote(
    owner: Owner | null,
    customer: Customer,
    province?: string,
    lineIds?: string[],
  ): Promise<QuoteDto> {
    const whole = await this.cartService.get(owner);
    // only the lines the shopper ticked are priced (and, later, bought)
    const cart = lineIds
      ? { ...whole, lines: whole.lines.filter((l) => lineIds.includes(l.id)) }
      : whole;
    const rules = await this.settings.getShippingRules();
    const shipping = resolveShipping(rules, province);
    const purchasable = cart.lines.filter((l) => l.purchasable);
    const subtotal = purchasable.reduce((s, l) => s + l.unitPriceVnd * l.quantity, 0);

    let applied: QuoteDto['coupon'] = null;
    let couponIssue: QuoteDto['couponIssue'] = null;
    const discounts: AppliedDiscount[] = [];
    const code = owner ? (await this.carts.find(this.db.pool, owner))?.coupon_code : null;
    if (code && subtotal > 0) {
      const outcome = await this.coupons.evaluate(this.db.pool, code, customer, subtotal);
      if (outcome.ok) {
        applied = outcome.applied;
        if (outcome.discountVnd > 0)
          discounts.push({
            source: 'COUPON',
            label: `Mã ${outcome.coupon.code}`,
            amountVnd: outcome.discountVnd,
          });
      } else {
        couponIssue = { code: outcome.issue, message: outcome.message };
      }
    }
    const pricing = priceOrder({
      lines: purchasable.map((l) => ({ unitPriceVnd: l.unitPriceVnd, quantity: l.quantity })),
      discounts,
      waiveShipping: applied?.freeShipping,
      shipping,
    });
    const checkout = await this.settings.getCheckoutRules();
    return {
      ...this.toQuote(cart, pricing, applied, couponIssue, shipping),
      phoneVerificationRequired: checkout.requirePhoneVerification,
    };
  }

  private toQuote(
    cart: CartDto,
    pricing: PricingResult,
    coupon: QuoteDto['coupon'],
    couponIssue: QuoteDto['couponIssue'],
    shipping: ResolvedShipping,
  ): QuoteDto {
    const blockers: QuoteDto['blockers'] =
      cart.lines.length === 0
        ? [{ code: 'CART_EMPTY', lineId: null, message: 'Giỏ hàng đang trống.' }]
        : [];
    for (const l of cart.lines) {
      if (l.issue)
        blockers.push({
          code: l.issue,
          lineId: l.id,
          message: `${l.productName}: ${blockerText(l.issue, l.availableQuantity)}`,
        });
    }
    const { shippingWaivedVnd: _w, ...price } = pricing;
    return {
      lines: cart.lines,
      ...price,
      canCheckout: blockers.length === 0,
      blockers,
      coupon,
      couponIssue,
      shippingZone: shipping.zoneName,
      phoneVerificationRequired: false,
    };
  }

  // ---- place order ------------------------------------------------------------------------------

  async place(
    owner: Owner | null,
    user: { id: string; email: string } | null,
    key: string,
    input: PlaceOrderInput,
    ip?: string,
  ) {
    if (!owner) throw new AppError('CART_EMPTY', 409, 'Giỏ hàng đang trống.');
    const email = user?.email ?? input.contactEmail;
    if (!email)
      throw AppError.validation({
        issues: [
          { path: 'contactEmail', message: 'Vui lòng nhập email để nhận xác nhận đơn hàng' },
        ],
      });

    const idemOwner: IdempotencyOwner =
      'userId' in owner ? { userId: owner.userId } : { scope: `g:${hashToken(owner.guestToken)}` };
    // The key is bound to (owner, operation, request hash); a retry replays the stored response.
    return this.idempotency.run(idemOwner, 'orders.place', key, input, 201, (client) =>
      this.placeInTransaction(client, owner, user, email, key, input, clientIp(ip)),
    );
  }

  private async placeInTransaction(
    c: pg.PoolClient,
    owner: Owner,
    user: { id: string; email: string } | null,
    email: string,
    key: string,
    input: PlaceOrderInput,
    ip: string,
  ): Promise<OrderDto> {
    const cart = await this.carts.find(c, owner, true);
    if (!cart) throw new AppError('CART_EMPTY', 409, 'Giỏ hàng đang trống.');
    const allLines = await this.repo.lockLines(c, cart.id);
    const lines = input.lineIds
      ? allLines.filter((l) => input.lineIds!.includes(l.cartItemId))
      : allLines;
    if (lines.length === 0)
      throw new AppError('CART_EMPTY', 409, 'Chưa có sản phẩm nào được chọn để thanh toán.');

    const address = await this.resolveAddress(c, user?.id ?? null, input);
    if ((await this.settings.getCheckoutRules(c as never)).requirePhoneVerification) {
      const phone = normalizeVnPhone(address.phone ?? '');
      if (!phone || !(await this.phones.isVerified(c, owner, phone)))
        throw new AppError(
          'PHONE_NOT_VERIFIED',
          409,
          'Vui lòng xác thực số điện thoại nhận hàng bằng mã OTP trước khi đặt hàng.',
          { phone: phone ?? null },
        );
    }
    const rules = await this.settings.getShippingRules(c as never);
    const shipping = resolveShipping(rules, address.province);

    // Everything below is judged against the rows we have just locked: nothing the browser said is trusted.
    const designBad = (l: (typeof lines)[number]) =>
      Boolean(l.designVersionId) && l.designStatus !== 'APPROVED' && l.designStatus !== 'SUBMITTED';
    const problems = lines.filter(
      (l) => !l.active || !l.published || designBad(l) || l.available < l.quantity,
    );
    if (problems.length) {
      throw new AppError(
        'INVENTORY_INSUFFICIENT',
        409,
        'Một số sản phẩm không còn đủ số lượng. Vui lòng cập nhật giỏ hàng.',
        {
          items: problems.map((l) => ({
            sku: l.sku,
            productName: l.productName,
            requested: l.quantity,
            available: l.active && l.published && !designBad(l) ? Math.max(l.available, 0) : 0,
            reason:
              !l.active || !l.published
                ? 'UNAVAILABLE'
                : designBad(l)
                  ? 'DESIGN_UNAVAILABLE'
                  : l.available <= 0
                    ? 'OUT_OF_STOCK'
                    : 'INSUFFICIENT_STOCK',
          })),
        },
      );
    }

    // Coupon: re-evaluated here, under a lock on the coupon row, so usage limits cannot be raced.
    const customer: Customer = { userId: user?.id ?? null, email };
    const goods = lines.reduce((s, l) => s + l.unitPriceVnd * l.quantity, 0);
    let couponIssue: { code: string; message: string } | null = null;
    const discounts: AppliedDiscount[] = [];
    let appliedCoupon: Awaited<ReturnType<CouponsService['evaluate']>> | null = null;
    if (cart.coupon_code) {
      const outcome = await this.coupons.evaluate(c, cart.coupon_code, customer, goods, {
        lock: true,
      });
      if (outcome.ok) {
        appliedCoupon = outcome;
        if (outcome.discountVnd > 0)
          discounts.push({
            source: 'COUPON',
            label: `Mã ${outcome.coupon.code}`,
            amountVnd: outcome.discountVnd,
          });
      } else {
        couponIssue = { code: outcome.issue, message: outcome.message };
      }
    }

    const pricing = priceOrder({
      lines: lines.map((l) => ({ unitPriceVnd: l.unitPriceVnd, quantity: l.quantity })),
      discounts,
      waiveShipping: appliedCoupon?.ok ? appliedCoupon.freeShipping : false,
      shipping,
    });
    if (pricing.totalVnd !== input.expectedTotalVnd) {
      throw new AppError(
        'PRICE_CHANGED',
        409,
        'Giá hoặc phí vận chuyển đã thay đổi. Vui lòng kiểm tra lại tổng tiền.',
        {
          expectedTotalVnd: input.expectedTotalVnd,
          currentTotalVnd: pricing.totalVnd,
          subtotalVnd: pricing.subtotalVnd,
          discountVnd: pricing.discountVnd,
          shippingFeeVnd: pricing.shippingFeeVnd,
          couponIssue,
        },
      );
    }

    const online = input.paymentMethod === 'VNPAY';
    const expiresAt = online
      ? new Date(
          Date.now() +
            (await this.settings.getCheckoutRules(c as never)).paymentWindowMinutes * 60_000,
        )
      : null;
    const order = await this.insertWithUniqueCode(c, {
      userId: user?.id ?? null,
      email,
      pricing,
      address,
      note: input.customerNote?.trim() || null,
      method: input.paymentMethod,
      status: online ? 'PENDING_PAYMENT' : 'CONFIRMED',
      paymentExpiresAt: expiresAt,
      couponCode: appliedCoupon?.ok ? appliedCoupon.coupon.code : null,
    });
    for (const l of lines) {
      // Customised items carry an immutable snapshot of the approved design (readable names, price breakdown).
      const customization = l.designVersionId
        ? await this.designs.snapshot(c, l.designVersionId, email)
        : null;
      await this.repo.insertItem(c, order.id, l, customization);
    }

    if (appliedCoupon?.ok) {
      const { coupon } = appliedCoupon;
      const rule = {
        type: coupon.type,
        value: coupon.value,
        minOrderVnd: coupon.minOrderVnd,
        maxDiscountVnd: coupon.maxDiscountVnd,
        version: coupon.version,
      };
      if (pricing.discountVnd > 0)
        await this.repo.insertDiscount(c, {
          orderId: order.id,
          source: 'COUPON',
          reference: coupon.code,
          label: `Mã ${coupon.code}`,
          appliesTo: 'GOODS',
          amountVnd: pricing.discountVnd,
          rule,
        });
      if (pricing.shippingWaivedVnd > 0)
        await this.repo.insertDiscount(c, {
          orderId: order.id,
          source: 'COUPON',
          reference: coupon.code,
          label: `Mã ${coupon.code} (miễn phí vận chuyển)`,
          appliesTo: 'SHIPPING',
          amountVnd: pricing.shippingWaivedVnd,
          rule,
        });
      await this.coupons.recordUsage(
        c,
        coupon,
        order.id,
        customer,
        pricing.discountVnd + pricing.shippingWaivedVnd,
      );
    }

    let paymentUrl: string | null = null;
    if (online) {
      const attempt = this.gateway.createPayment({
        orderCode: order.public_code,
        attempt: 1,
        amountVnd: pricing.totalVnd,
        ip,
        expiresAt: expiresAt!,
      });
      await this.repo.insertPayment(c, {
        orderId: order.id,
        provider: 'VNPAY',
        amountVnd: pricing.totalVnd,
        providerRef: attempt.txnRef,
        idempotencyKey: key,
      });
      await this.repo.reserve(c, order.id, lines, expiresAt!);
      await this.repo.insertHistory(c, {
        orderId: order.id,
        from: null,
        to: 'PENDING_PAYMENT',
        actorType: user ? 'CUSTOMER' : 'GUEST',
        actorId: user?.id,
        metadata: { ip },
      });
      paymentUrl = attempt.url;
    } else {
      await this.repo.insertPayment(c, {
        orderId: order.id,
        provider: 'COD',
        amountVnd: pricing.totalVnd,
        providerRef: null,
        idempotencyKey: key,
      });
      await this.repo.commitSale(c, order.id, order.public_code, lines);
      await this.repo.insertHistory(c, {
        orderId: order.id,
        from: null,
        to: 'CONFIRMED',
        actorType: user ? 'CUSTOMER' : 'GUEST',
        actorId: user?.id,
        metadata: { ip },
      });
    }
    await this.repo.clearCart(
      c,
      cart.id,
      lines.map((l) => l.cartItemId),
      lines.length === allLines.length,
    );

    const dto = await this.load(c, order, { userId: user?.id }, paymentUrl);
    // Online orders are confirmed by email only once the payment is verified.
    if (!online)
      await enqueueOutbox(
        c,
        'order.placed',
        orderPlacedPayload(order, (await this.repo.details(c, order.id)).items),
      );
    return dto;
  }

  private async insertWithUniqueCode(
    c: pg.PoolClient,
    o: {
      userId: string | null;
      email: string;
      pricing: PricingResult;
      address: Record<string, string>;
      note: string | null;
      method: 'COD' | 'VNPAY';
      status: 'CONFIRMED' | 'PENDING_PAYMENT';
      paymentExpiresAt: Date | null;
      couponCode: string | null;
    },
  ): Promise<OrderRow> {
    for (let attempt = 0; attempt < 5; attempt++) {
      await c.query('SAVEPOINT order_code');
      try {
        const row = await this.repo.insertOrder(c, {
          code: generateOrderCode(),
          userId: o.userId,
          email: o.email,
          status: o.status,
          paymentMethod: o.method,
          subtotalVnd: o.pricing.subtotalVnd,
          discountVnd: o.pricing.discountVnd,
          shippingFeeVnd: o.pricing.shippingFeeVnd,
          totalVnd: o.pricing.totalVnd,
          address: o.address,
          note: o.note,
          paymentExpiresAt: o.paymentExpiresAt,
          couponCode: o.couponCode,
        });
        await c.query('RELEASE SAVEPOINT order_code');
        return row;
      } catch (error) {
        await c.query('ROLLBACK TO SAVEPOINT order_code');
        if ((error as { constraint?: string }).constraint !== 'orders_public_code_key') throw error;
      }
    }
    throw new AppError('INTERNAL_ERROR', 500, 'Không thể tạo mã đơn hàng. Vui lòng thử lại.');
  }

  private async resolveAddress(
    c: pg.PoolClient,
    userId: string | null,
    input: PlaceOrderInput,
  ): Promise<Record<string, string>> {
    if (input.shippingAddress) {
      const a = input.shippingAddress;
      return {
        fullName: a.fullName,
        phone: a.phone,
        line1: a.line1,
        ward: a.ward,
        district: a.district,
        province: a.province,
      };
    }
    if (!userId)
      throw AppError.validation({
        issues: [{ path: 'addressId', message: 'Vui lòng nhập địa chỉ giao hàng' }],
      });
    const { rows } = await c.query(
      'SELECT full_name, phone, line1, ward, district, province FROM addresses WHERE id = $1 AND user_id = $2',
      [input.addressId, userId],
    );
    if (!rows[0]) throw AppError.notFound('Không tìm thấy địa chỉ đã chọn.');
    return {
      fullName: rows[0].full_name,
      phone: rows[0].phone,
      line1: rows[0].line1,
      ward: rows[0].ward,
      district: rows[0].district,
      province: rows[0].province,
    };
  }

  // ---- reads ------------------------------------------------------------------------------------

  private async load(
    q: Pick<pg.Pool, 'query'>,
    order: OrderRow,
    viewer: Viewer,
    paymentUrl: string | null = null,
  ): Promise<OrderDto> {
    const d = await this.repo.details(q, order.id);
    return toOrderDto(order, d, {
      isOwner: Boolean(viewer.userId && viewer.userId === order.user_id),
      mediaBase: this.mediaBase,
      paymentUrl,
    });
  }

  /** Capability lookup by code. The owner sees everything; anyone else gets contact details masked. */
  async getByCode(code: string, viewer: Viewer): Promise<OrderDto> {
    const order = await this.repo.findByCode(this.db.pool, code);
    if (!order) throw AppError.notFound('Không tìm thấy đơn hàng.');
    return this.load(this.db.pool, order, viewer);
  }

  async listMine(userId: string, page: number, pageSize: number) {
    const { rows, total } = await this.repo.listByUser(userId, page, pageSize);
    return {
      items: rows.map((r) => ({
        code: r.public_code as string,
        status: r.status,
        totalVnd: Number(r.total_vnd),
        itemCount: r.item_count as number,
        placedAt: (r.placed_at as Date).toISOString(),
      })),
      meta: { page, pageSize, total },
    };
  }

  // ---- cancel (customer) ------------------------------------------------------------------------

  async cancelOwn(code: string, userId: string): Promise<OrderDto> {
    const { dto, refundId } = await this.db.transaction(async (c) => {
      const order = await this.repo.lockByCode(c, code);
      if (!order || order.user_id !== userId) throw AppError.notFound('Không tìm thấy đơn hàng.');
      if (!customerCanCancel(order.status)) {
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          409,
          'Đơn hàng đã được cửa hàng xử lý nên không thể tự hủy. Vui lòng liên hệ cửa hàng.',
          { status: order.status, cancellableFrom: [...CUSTOMER_CANCELLABLE] },
        );
      }
      const res = await cancelOrderInTx(this.repo, this.refunds, c, order, {
        actorType: 'CUSTOMER',
        actorId: userId,
        reason: 'Khách hàng hủy đơn',
      });
      return { dto: await this.load(c, res.order, { userId }), refundId: res.refundId };
    });
    if (refundId) await this.refunds.process(refundId).catch(() => undefined); // failures are visible to finance; the cancellation stands
    return dto;
  }
}

export function blockerText(
  issue: 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'DESIGN_UNAVAILABLE',
  available: number,
): string {
  if (issue === 'UNAVAILABLE') return 'không còn bán.';
  if (issue === 'DESIGN_UNAVAILABLE') return 'thiết kế chưa được duyệt hoặc không còn khả dụng.';
  if (issue === 'OUT_OF_STOCK') return 'đã hết hàng.';
  return `chỉ còn ${available} sản phẩm.`;
}
