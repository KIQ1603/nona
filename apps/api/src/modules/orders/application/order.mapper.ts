import type { OrderDto, OrderStatus } from '@nona/contracts';
import { customerCanCancel } from '../domain/order-state';
import type { OrderRow } from '../infrastructure/orders.repository';

interface Details {
  items: Record<string, unknown>[];
  paymentStatus: string;
  refundedVnd?: number;
  shipment: Record<string, unknown> | null;
  history: Record<string, unknown>[];
}

const maskPhone = (p: string) => `${'•'.repeat(Math.max(p.length - 3, 0))}${p.slice(-3)}`;
const maskEmail = (e: string) => {
  const [name = '', domain = ''] = e.split('@');
  return `${name.slice(0, 1)}${'•'.repeat(Math.max(name.length - 1, 1))}@${domain}`;
};

/** Projects DB rows to the public order DTO. Non-owners (capability-link viewers) get contact data masked. */
/** Customers may print names or messages on a hat: only the owner (and staff) see the design text on an order. */
function redactCustomization(c: OrderDto['items'][number]['customization'], isOwner: boolean) {
  if (!c || isOwner) return c;
  return { ...c, title: 'Thiết kế riêng', layers: [], priceLines: [] };
}

export function toOrderDto(
  order: OrderRow,
  d: Details,
  ctx: { isOwner: boolean; mediaBase: string; paymentUrl?: string | null },
): OrderDto {
  const a = order.shipping_address;
  return {
    code: order.public_code,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentStatus: d.paymentStatus as OrderDto['paymentStatus'],
    paymentExpiresAt: order.payment_expires_at ? order.payment_expires_at.toISOString() : null,
    couponCode: order.coupon_code,
    refundedVnd: d.refundedVnd ?? 0,
    paymentUrl: ctx.paymentUrl ?? null,
    subtotalVnd: Number(order.subtotal_vnd),
    discountVnd: Number(order.discount_vnd),
    shippingFeeVnd: Number(order.shipping_fee_vnd),
    totalVnd: Number(order.total_vnd),
    placedAt: order.placed_at.toISOString(),
    customerEmail: !order.customer_email
      ? null
      : ctx.isOwner
        ? order.customer_email
        : maskEmail(order.customer_email),
    customerNote: ctx.isOwner ? order.customer_note : null,
    items: d.items.map((i) => ({
      productSlug: i.product_slug as string,
      productName: i.product_name as string,
      variantName: i.variant_name as string,
      sku: i.sku as string,
      unitPriceVnd: Number(i.unit_price_vnd),
      quantity: i.quantity as number,
      lineTotalVnd: Number(i.line_total_vnd),
      imageUrl: i.image_key ? `${ctx.mediaBase}/${i.image_key as string}` : null,
      customization: redactCustomization(
        (i.customization as OrderDto['items'][number]['customization']) ?? null,
        ctx.isOwner,
      ),
    })),
    shippingAddress: ctx.isOwner ? a : { ...a, phone: maskPhone(a.phone), line1: '••••••' },
    isOwner: ctx.isOwner,
    canCancel: ctx.isOwner && customerCanCancel(order.status),
    history: d.history.map((h) => ({
      status: h.to_status as OrderStatus,
      at: (h.created_at as Date).toISOString(),
    })),
    shipment: d.shipment
      ? {
          carrier: d.shipment.carrier as string,
          trackingCode: (d.shipment.tracking_code as string | null) ?? null,
          status: d.shipment.status as string,
          shippedAt: (d.shipment.shipped_at as Date).toISOString(),
        }
      : null,
  };
}
