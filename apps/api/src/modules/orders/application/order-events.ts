import type { OrderRow } from '../infrastructure/orders.repository';

/**
 * Snapshot used by the confirmation email. Built from the order rows so COD (at creation) and online
 * payments (when the payment is confirmed) send identical content.
 */
export function orderPlacedPayload(order: OrderRow, items: Record<string, unknown>[]) {
  return {
    orderCode: order.public_code,
    email: order.customer_email,
    customerName: order.shipping_address.fullName,
    paymentMethod: order.payment_method,
    items: items.map((i) => ({
      name: i.product_name as string,
      variant: i.variant_name as string,
      quantity: i.quantity as number,
      lineTotalVnd: Number(i.line_total_vnd),
    })),
    subtotalVnd: Number(order.subtotal_vnd),
    discountVnd: Number(order.discount_vnd),
    shippingFeeVnd: Number(order.shipping_fee_vnd),
    totalVnd: Number(order.total_vnd),
    address: order.shipping_address,
    placedAt: order.placed_at.toISOString(),
  };
}
