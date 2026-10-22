/**
 * Order pricing, in the order mandated by domain-rules.md:
 *   base variant price -> customization additions -> item promotion -> order promotion -> shipping -> total.
 * Pure and integer-only (VND): no floating point, no I/O, so it is trivially testable and shared by the
 * quote and by order creation (which recomputes inside the transaction).
 */
export interface PricedLine {
  unitPriceVnd: number;
  quantity: number;
}
export interface AppliedDiscount {
  source: string;
  label: string;
  amountVnd: number;
}
export interface ShippingRules {
  /** Net subtotal at/above which shipping is free. null = no free-shipping offer. */
  freeThresholdVnd: number | null;
  flatFeeVnd: number;
}
export interface PricingResult {
  subtotalVnd: number;
  discountVnd: number;
  discounts: AppliedDiscount[];
  shippingFeeVnd: number;
  totalVnd: number;
  /** Shipping fee that a free-shipping coupon waived (0 when none was waived). */
  shippingWaivedVnd: number;
  freeShipping: { thresholdVnd: number | null; remainingVnd: number | null; applied: boolean };
}

export function priceOrder(input: {
  lines: PricedLine[];
  discounts?: AppliedDiscount[];
  /** A free-shipping coupon was applied: the fee that would be charged is waived (and reported). */
  waiveShipping?: boolean;
  shipping: ShippingRules;
}): PricingResult {
  for (const l of input.lines) {
    if (
      !Number.isSafeInteger(l.unitPriceVnd) ||
      l.unitPriceVnd < 0 ||
      !Number.isSafeInteger(l.quantity) ||
      l.quantity < 1
    ) {
      throw new RangeError('invalid line for pricing');
    }
  }
  const subtotalVnd = input.lines.reduce((sum, l) => sum + l.unitPriceVnd * l.quantity, 0);

  // Discounts can never push the goods total below zero; each is capped by what is left.
  let remaining = subtotalVnd;
  const discounts: AppliedDiscount[] = [];
  for (const d of input.discounts ?? []) {
    const amount = Math.min(Math.max(0, Math.floor(d.amountVnd)), remaining);
    if (amount > 0) {
      discounts.push({ ...d, amountVnd: amount });
      remaining -= amount;
    }
  }
  const discountVnd = subtotalVnd - remaining;
  const net = remaining;

  const { freeThresholdVnd, flatFeeVnd } = input.shipping;
  const qualifies = freeThresholdVnd !== null && net >= freeThresholdVnd;
  const baseFee = input.lines.length === 0 || qualifies ? 0 : flatFeeVnd;
  const shippingWaivedVnd = input.waiveShipping ? baseFee : 0;
  const shippingFeeVnd = baseFee - shippingWaivedVnd;
  const applied = qualifies || flatFeeVnd === 0 || Boolean(input.waiveShipping);

  return {
    subtotalVnd,
    discountVnd,
    discounts,
    shippingFeeVnd,
    shippingWaivedVnd,
    totalVnd: net + shippingFeeVnd,
    freeShipping: {
      thresholdVnd: freeThresholdVnd,
      remainingVnd:
        freeThresholdVnd !== null && !qualifies && !input.waiveShipping
          ? freeThresholdVnd - net
          : null,
      applied,
    },
  };
}
