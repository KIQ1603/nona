import { z } from 'zod';
import { addressInputSchema, passwordSchema } from './account';
import { cartLineSchema } from './cart';
import { appliedCouponSchema } from './coupons';
import { orderCustomizationSchema } from './design';
import { refundSchema } from './payments';

export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'EXPIRED',
  'PAID',
  'CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
  'SHIPPING',
  'COMPLETED',
  'CANCELLATION_REQUESTED',
  'CANCELLED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Nháp',
  PENDING_PAYMENT: 'Chờ thanh toán',
  PAYMENT_FAILED: 'Thanh toán thất bại',
  EXPIRED: 'Hết hạn',
  PAID: 'Đã thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PROCESSING: 'Đang chuẩn bị',
  READY_TO_SHIP: 'Sẵn sàng giao',
  SHIPPING: 'Đang giao',
  COMPLETED: 'Hoàn tất',
  CANCELLATION_REQUESTED: 'Yêu cầu hủy',
  CANCELLED: 'Đã hủy',
  REFUND_PENDING: 'Chờ hoàn tiền',
  PARTIALLY_REFUNDED: 'Hoàn tiền một phần',
  REFUNDED: 'Đã hoàn tiền',
};

/**
 * Forward transitions the shop can make today (COD flow). Every move is validated server-side;
 * the admin UI only uses this to decide which buttons to show. PAID/refund paths arrive with online payments.
 */
export const ORDER_TRANSITIONS: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP: ['SHIPPING', 'CANCELLED'],
  SHIPPING: ['COMPLETED'],
};
/** Statuses from which a customer may cancel their own order (before the shop starts preparing it). */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED'];

export const PAYMENT_METHODS = ['COD', 'VNPAY'] as const;
export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'] as const;

export const shippingAddressInputSchema = addressInputSchema.omit({ isDefault: true });
export const shippingAddressSchema = z.object({
  fullName: z.string(),
  phone: z.string(),
  line1: z.string(),
  ward: z.string(),
  district: z.string(),
  province: z.string(),
});

export const placeOrderSchema = z
  .object({
    addressId: z.string().uuid().optional(),
    shippingAddress: shippingAddressInputSchema.optional(),
    /** Required for guests; ignored for signed-in users (their account email is used). */
    contactEmail: z.string().trim().toLowerCase().email().max(254).optional(),
    customerNote: z.string().trim().max(500).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    /** Cart lines to buy now. Omitted = the whole cart; lines not listed stay in the cart. */
    lineIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    /** The total the shopper saw. If the live total differs the server answers 409 PRICE_CHANGED instead of charging more. */
    expectedTotalVnd: z.number().int().nonnegative(),
  })
  .refine((v) => Boolean(v.addressId) !== Boolean(v.shippingAddress), {
    message: 'Cần chọn một địa chỉ đã lưu hoặc nhập địa chỉ mới',
    path: ['shippingAddress'],
  });

export const quoteBlockerSchema = z.object({
  code: z.enum([
    'CART_EMPTY',
    'UNAVAILABLE',
    'OUT_OF_STOCK',
    'INSUFFICIENT_STOCK',
    'DESIGN_UNAVAILABLE',
  ]),
  lineId: z.string().nullable(),
  message: z.string(),
});
export const quoteSchema = z.object({
  lines: z.array(cartLineSchema),
  subtotalVnd: z.number().int().nonnegative(),
  discountVnd: z.number().int().nonnegative(),
  discounts: z.array(
    z.object({ source: z.string(), label: z.string(), amountVnd: z.number().int().nonnegative() }),
  ),
  shippingFeeVnd: z.number().int().nonnegative(),
  totalVnd: z.number().int().nonnegative(),
  freeShipping: z.object({
    thresholdVnd: z.number().int().nullable(),
    remainingVnd: z.number().int().nullable(),
    applied: z.boolean(),
  }),
  canCheckout: z.boolean(),
  blockers: z.array(quoteBlockerSchema),
  coupon: appliedCouponSchema.nullable().default(null),
  /** Set when the coupon in the cart was refused (and therefore NOT applied). */
  couponIssue: z.object({ code: z.string(), message: z.string() }).nullable().default(null),
  /** Name of the shipping zone whose rate was used, if any. */
  shippingZone: z.string().nullable().default(null),
  /** The receiving phone must be confirmed with an OTP before the order can be placed (admin setting). */
  phoneVerificationRequired: z.boolean().default(false),
});
export const quoteRequestSchema = z
  .object({
    province: z.string().trim().max(100).optional(),
    /** Price only these cart lines (the shopper ticked them). Omitted = the whole cart. */
    lineIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  })
  .default({});
export type QuoteDto = z.infer<typeof quoteSchema>;

export const orderItemSchema = z.object({
  productSlug: z.string(),
  productName: z.string(),
  variantName: z.string(),
  sku: z.string(),
  unitPriceVnd: z.number().int(),
  quantity: z.number().int(),
  lineTotalVnd: z.number().int(),
  imageUrl: z.string().nullable(),
  /** Immutable snapshot of the approved design this item was made from (null for ordinary items). */
  customization: orderCustomizationSchema.nullable().default(null),
});
export const orderSchema = z.object({
  code: z.string(),
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  paymentExpiresAt: z.string().nullable().default(null),
  couponCode: z.string().nullable().default(null),
  refundedVnd: z.number().int().default(0),
  /** Only present in the response that creates an online-payment order. */
  paymentUrl: z.string().nullable().default(null),
  subtotalVnd: z.number().int(),
  discountVnd: z.number().int(),
  shippingFeeVnd: z.number().int(),
  totalVnd: z.number().int(),
  placedAt: z.string(),
  customerEmail: z.string().nullable().default(null),
  customerNote: z.string().nullable(),
  items: z.array(orderItemSchema),
  shippingAddress: shippingAddressSchema,
  /** True when the viewer is the account owner; capability-link viewers get the phone number masked. */
  isOwner: z.boolean(),
  canCancel: z.boolean(),
  history: z.array(z.object({ status: z.enum(ORDER_STATUSES), at: z.string() })),
  shipment: z
    .object({
      carrier: z.string(),
      trackingCode: z.string().nullable(),
      status: z.string(),
      shippedAt: z.string(),
    })
    .nullable(),
});
export type OrderDto = z.infer<typeof orderSchema>;
export const orderListSchema = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      status: z.enum(ORDER_STATUSES),
      totalVnd: z.number().int(),
      itemCount: z.number().int(),
      placedAt: z.string(),
    }),
  ),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});

export const adminOrderListQuerySchema = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const adminOrderListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      status: z.enum(ORDER_STATUSES),
      customerEmail: z.string().nullable().default(null),
      customerName: z.string(),
      totalVnd: z.number().int(),
      itemCount: z.number().int(),
      paymentMethod: z.string(),
      paymentStatus: z.string(),
      placedAt: z.string(),
      /** For changing the status straight from the list (optimistic lock + what is allowed next). */
      version: z.number().int(),
      allowedTransitions: z.array(z.enum(ORDER_STATUSES)),
      /** Custom designs still waiting for approval (production cannot start until 0). */
      pendingDesigns: z.number().int(),
    }),
  ),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});
export const adminOrderDetailSchema = orderSchema.extend({
  id: z.string(),
  version: z.number().int(),
  userId: z.string().nullable(),
  refunds: z.array(refundSchema).default([]),
  /** Remaining amount that can still be refunded on the online payment (0 for COD / unpaid). */
  refundableVnd: z.number().int().default(0),
  allowedTransitions: z.array(z.enum(ORDER_STATUSES)),
  /** Custom designs on this order that are not approved yet: production cannot start until they are. */
  pendingDesigns: z
    .array(
      z.object({
        designId: z.string(),
        versionId: z.string(),
        versionNo: z.number().int(),
        status: z.string(),
      }),
    )
    .default([]),
  history: z.array(
    z.object({
      status: z.enum(ORDER_STATUSES),
      from: z.enum(ORDER_STATUSES).nullable(),
      at: z.string(),
      actorType: z.string(),
      actorEmail: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;

export const updateOrderStatusSchema = z.object({
  to: z.enum(ORDER_STATUSES),
  version: z.number().int().min(1),
  reason: z.string().trim().min(1).max(300).optional(),
  shipment: z
    .object({
      carrier: z.string().trim().min(1).max(80),
      trackingCode: z.string().trim().max(80).optional(),
    })
    .optional(),
});

/** An email (a reset link is mailed) or a mobile number (a code is sent by SMS). `email` is the older field name. */
export const forgotPasswordSchema = z
  .object({
    identifier: z.string().trim().max(254).optional(),
    email: z.string().trim().max(254).optional(),
  })
  .refine((v) => Boolean(v.identifier ?? v.email), {
    message: 'Vui lòng nhập email hoặc số điện thoại',
  })
  .transform((v) => ({ identifier: (v.identifier ?? v.email)! }));
/** Phone reset, step 2: the SMS code plus the new password (typed twice). */
export const resetPasswordByPhoneSchema = z
  .object({
    token: z.string().uuid(),
    /** The SMS code we sent, or (when Firebase Phone Auth is on) the Firebase ID token instead. */
    code: z
      .string()
      .trim()
      .regex(/^[0-9]{6}$/, 'Mã gồm 6 chữ số')
      .optional(),
    idToken: z.string().min(100).max(4096).optional(),
    newPassword: passwordSchema,
    confirmPassword: z.string().max(200),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.idToken), {
    message: 'Cần mã xác thực',
    path: ['code'],
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Mật khẩu nhập lại không khớp',
    path: ['confirmPassword'],
  });
export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    newPassword: passwordSchema,
    confirmPassword: z.string().max(200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Mật khẩu nhập lại không khớp',
    path: ['confirmPassword'],
  });
