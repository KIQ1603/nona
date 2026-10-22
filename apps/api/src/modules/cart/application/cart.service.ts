import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MAX_LINE_QUANTITY, type CartDto, type CartLine } from '@nona/contracts';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { DesignsService } from '../../designs/application/designs.service';
import type { DesignOwner } from '../../designs/infrastructure/designs.repository';
import { DatabaseService } from '../../../platform/database/database.service';
import { CartRepository, type CartLineRow, type Owner } from '../infrastructure/cart.repository';

type Notice = CartDto['notices'][number];
export interface CartResult {
  cart: CartDto;
  /** Set when a brand-new guest cart was created and the browser needs its cookie. */
  newGuestToken?: string;
}

const EMPTY: CartDto = {
  lines: [],
  itemCount: 0,
  subtotalVnd: 0,
  hasPriceChanges: false,
  hasUnavailable: false,
  notices: [],
};

@Injectable()
export class CartService {
  private readonly mediaBase: string;
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CartRepository) private readonly repo: CartRepository,
    @Inject(DesignsService) private readonly designs: DesignsService,
    @Inject(ENV) env: Env,
  ) {
    this.mediaBase = env.MEDIA_BASE_URL.replace(/\/$/, '');
  }

  /** Pure projection from rows to the public cart: prices and availability are always the live values. */
  private present(rows: CartLineRow[], notices: Notice[] = []): CartDto {
    const lines: CartLine[] = rows.map((r) => {
      const issue =
        !r.active || !r.published
          ? 'UNAVAILABLE'
          : r.design && r.design.status !== 'APPROVED' && r.design.status !== 'SUBMITTED'
            ? 'DESIGN_UNAVAILABLE'
            : r.stock <= 0
              ? 'OUT_OF_STOCK'
              : r.stock < r.quantity
                ? 'INSUFFICIENT_STOCK'
                : null;
      return {
        id: r.id,
        variantId: r.variantId,
        sku: r.sku,
        productSlug: r.productSlug,
        productName: r.productName,
        variantName: r.variantName,
        image: r.image
          ? {
              url: `${this.mediaBase}/${r.image.objectKey}`,
              alt: r.image.alt,
              width: r.image.width,
              height: r.image.height,
              variantId: null,
            }
          : null,
        unitPriceVnd: r.priceVnd,
        compareAtPriceVnd: r.compareAtPriceVnd,
        design: r.design
          ? {
              versionId: r.design.versionId,
              designId: r.design.designId,
              title: r.design.title,
              versionNo: r.design.versionNo,
            }
          : null,
        quantity: r.quantity,
        lineTotalVnd: r.priceVnd * r.quantity,
        purchasable: issue === null,
        issue,
        availableQuantity: Math.max(r.stock, 0),
        priceChange:
          r.seenPriceVnd !== r.priceVnd ? { previousUnitPriceVnd: r.seenPriceVnd } : null,
      };
    });
    return {
      lines,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      subtotalVnd: lines.filter((l) => l.purchasable).reduce((sum, l) => sum + l.lineTotalVnd, 0),
      hasPriceChanges: lines.some((l) => l.priceChange),
      hasUnavailable: lines.some((l) => !l.purchasable),
      notices,
    };
  }

  async get(owner: Owner | null): Promise<CartDto> {
    if (!owner) return EMPTY;
    const cart = await this.repo.find(this.db.pool, owner);
    return cart ? this.present(await this.repo.lines(this.db.pool, cart.id)) : EMPTY;
  }

  async addItem(
    owner: Owner | null,
    variantId: string,
    quantity: number,
    design?: { versionId: string; owner: DesignOwner | null },
  ): Promise<CartResult> {
    // A customised line is priced from its approved version (frozen at submission) and must belong to the shopper.
    const addition = design
      ? await this.designs.assertOrderable(design.versionId, variantId, design.owner)
      : null;
    const effective: Owner = owner ?? { guestToken: randomBytes(32).toString('base64url') };
    const newGuestToken = owner ? undefined : (effective as { guestToken: string }).guestToken;
    const cart = await this.db.transaction(async (c) => {
      const cartRow =
        (await this.repo.find(c, effective, true)) ?? (await this.repo.create(c, effective));
      const variant = await this.repo.variantForSale(c, variantId);
      if (!variant) throw AppError.notFound('Không tìm thấy sản phẩm.');
      if (!variant.sellable)
        throw new AppError('CONFLICT', 409, 'Sản phẩm này hiện không còn bán.', {
          reason: 'UNAVAILABLE',
        });
      if (variant.stock <= 0)
        throw new AppError('INVENTORY_INSUFFICIENT', 409, 'Sản phẩm đã hết hàng.', {
          availableQuantity: 0,
        });

      const versionId = design?.versionId ?? null;
      const desired =
        (await this.repo.itemQuantity(c, cartRow.id, variantId, versionId)) + quantity;
      const final = Math.min(desired, variant.stock, MAX_LINE_QUANTITY);
      const itemId = await this.repo.upsertItem(
        c,
        cartRow.id,
        variantId,
        final,
        variant.priceVnd + (addition?.priceAdditionVnd ?? 0),
        versionId,
      );
      await this.repo.touch(c, cartRow.id);
      const notices: Notice[] =
        final < desired ? [this.adjusted(final, variant.stock, itemId)] : [];
      return this.present(await this.repo.lines(c, cartRow.id), notices);
    });
    return { cart, newGuestToken };
  }

  async setQuantity(owner: Owner, itemId: string, quantity: number): Promise<CartDto> {
    return this.db.transaction(async (c) => {
      const cartRow = await this.repo.find(c, owner, true);
      const item = cartRow && (await this.repo.findItem(c, cartRow.id, itemId));
      if (!cartRow || !item) throw AppError.notFound('Không tìm thấy sản phẩm trong giỏ.');
      const variant = await this.repo.variantForSale(c, item.variant_id);
      if (!variant || !variant.sellable)
        throw new AppError('CONFLICT', 409, 'Sản phẩm này hiện không còn bán.', {
          reason: 'UNAVAILABLE',
        });
      if (variant.stock <= 0)
        throw new AppError('INVENTORY_INSUFFICIENT', 409, 'Sản phẩm đã hết hàng.', {
          availableQuantity: 0,
        });
      const final = Math.min(quantity, variant.stock, MAX_LINE_QUANTITY);
      await this.repo.upsertItem(
        c,
        cartRow.id,
        item.variant_id,
        final,
        variant.priceVnd + Number(item.addition),
        item.design_version_id,
      );
      await this.repo.touch(c, cartRow.id);
      return this.present(
        await this.repo.lines(c, cartRow.id),
        final < quantity ? [this.adjusted(final, variant.stock, itemId)] : [],
      );
    });
  }

  async removeItem(owner: Owner, itemId: string): Promise<CartDto> {
    return this.db.transaction(async (c) => {
      const cartRow = await this.repo.find(c, owner, true);
      if (!cartRow || !(await this.repo.deleteItem(c, cartRow.id, itemId)))
        throw AppError.notFound('Không tìm thấy sản phẩm trong giỏ.');
      await this.repo.touch(c, cartRow.id);
      return this.present(await this.repo.lines(c, cartRow.id));
    });
  }

  /** The shopper has seen the new prices: stop flagging them. */
  async acknowledgePriceChanges(owner: Owner): Promise<CartDto> {
    return this.db.transaction(async (c) => {
      const cartRow = await this.repo.find(c, owner, true);
      if (!cartRow) return EMPTY;
      await this.repo.acknowledgePrices(c, cartRow.id);
      return this.present(await this.repo.lines(c, cartRow.id));
    });
  }

  /**
   * On login: fold the anonymous cart into the user's cart. Quantities add up per variant and are
   * capped by current availability; unavailable lines are dropped. The guest cart is then deleted.
   */
  async mergeGuestCart(userId: string, guestToken: string): Promise<void> {
    await this.db.transaction(async (c) => {
      const guest = await this.repo.guestItems(c, guestToken);
      if (!guest) return;
      const guestCoupon = (await this.repo.find(c, { guestToken }, false))?.coupon_code ?? null;
      if (guest.items.length) {
        const target = (await this.repo.find(c, { userId }, true)) ?? {
          ...(await this.repo.create(c, { userId })),
          coupon_code: null as string | null,
        };
        for (const item of guest.items) {
          const variant = await this.repo.variantForSale(c, item.variant_id);
          if (!variant || !variant.sellable || variant.stock <= 0) continue;
          const total =
            (await this.repo.itemQuantity(c, target.id, item.variant_id, item.design_version_id)) +
            item.quantity;
          const addition = item.design_version_id
            ? Number(
                (
                  await c.query(
                    'SELECT price_addition_vnd FROM custom_design_versions WHERE id = $1',
                    [item.design_version_id],
                  )
                ).rows[0]?.price_addition_vnd ?? 0,
              )
            : 0;
          await this.repo.upsertItem(
            c,
            target.id,
            item.variant_id,
            Math.min(total, variant.stock, MAX_LINE_QUANTITY),
            variant.priceVnd + addition,
            item.design_version_id,
          );
        }
        await this.repo.touch(c, target.id);
        // carry the coupon over, but never replace one the account already chose
        if (guestCoupon && !target.coupon_code)
          await this.repo.setCoupon(c, target.id, guestCoupon);
      }
      await this.repo.deleteCart(c, guest.cartId);
    });
  }

  private adjusted(final: number, stock: number, itemId: string): Notice {
    return {
      code: 'QUANTITY_ADJUSTED',
      itemId,
      message:
        final === stock
          ? `Chỉ còn ${stock} sản phẩm, số lượng đã được điều chỉnh.`
          : `Số lượng tối đa mỗi sản phẩm là ${MAX_LINE_QUANTITY}.`,
    };
  }
}
