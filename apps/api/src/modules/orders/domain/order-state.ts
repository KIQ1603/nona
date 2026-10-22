import { CUSTOMER_CANCELLABLE, ORDER_TRANSITIONS, type OrderStatus } from '@nona/contracts';
import { AppError } from '../../../common/errors/app-error';

export const allowedTransitions = (from: OrderStatus): readonly OrderStatus[] =>
  ORDER_TRANSITIONS[from] ?? [];

/** Only listed transitions are legal; states are never skipped to simplify the UI. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!allowedTransitions(from).includes(to)) {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      409,
      `Không thể chuyển đơn hàng từ "${from}" sang "${to}".`,
      {
        from,
        to,
        allowed: [...allowedTransitions(from)],
      },
    );
  }
}

export const customerCanCancel = (status: OrderStatus) => CUSTOMER_CANCELLABLE.includes(status);
/** Statuses that hold sold stock which must be returned to the ledger if the order is cancelled. */
export const releasesStockOnCancel = (status: OrderStatus) =>
  ['CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'].includes(status);
