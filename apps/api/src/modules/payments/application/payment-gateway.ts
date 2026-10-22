import { Inject, Injectable } from '@nestjs/common';
import {
  buildPaymentUrl,
  makeTxnRef,
  parseCallback,
  queryTransaction,
  refundTransaction,
  verifyCallback,
  type CallbackResult,
  type QueryResult,
  type RefundResult,
  type VnpayConfig,
} from '@nona/payments';
import { ENV, type Env } from '../../../config/env';

/**
 * The only place that knows how to talk to the payment provider. Everything outside speaks in orders,
 * amounts in VND and normalized results; provider payloads never leave this class.
 */
@Injectable()
export class PaymentGateway {
  readonly config: VnpayConfig;
  readonly simulated: boolean;

  constructor(@Inject(ENV) env: Env) {
    this.simulated = env.PAYMENTS_MODE === 'simulator';
    this.config = {
      tmnCode: env.VNPAY_TMN_CODE,
      hashSecret: env.VNPAY_HASH_SECRET,
      payUrl: env.VNPAY_PAY_URL,
      apiUrl: env.VNPAY_API_URL,
      returnUrl: `${env.WEB_ORIGIN.replace(/\/$/, '')}/thanh-toan/ket-qua`,
    };
  }

  createPayment(input: {
    orderCode: string;
    attempt: number;
    amountVnd: number;
    ip: string;
    expiresAt: Date;
    now?: Date;
  }) {
    const txnRef = makeTxnRef(input.orderCode, input.attempt);
    const url = buildPaymentUrl(this.config, {
      txnRef,
      amountVnd: input.amountVnd,
      orderInfo: `Thanh toan don hang ${input.orderCode}`,
      ipAddr: input.ip,
      createdAt: input.now ?? new Date(),
      expiresAt: input.expiresAt,
    });
    return { txnRef, url };
  }

  /** Signature must verify before anything else about a callback is believed. */
  verify(params: Record<string, string | undefined>): boolean {
    return verifyCallback(this.config, params);
  }
  parse(params: Record<string, string | undefined>): CallbackResult {
    return parseCallback(params);
  }

  query(txnRef: string, createdAt: Date, orderCode: string): Promise<QueryResult> {
    return queryTransaction(this.config, {
      txnRef,
      transactionDate: createdAt,
      orderInfo: `Thanh toan don hang ${orderCode}`,
      ipAddr: '127.0.0.1',
    });
  }

  refund(r: {
    txnRef: string;
    amountVnd: number;
    full: boolean;
    transactionNo: string;
    paidAt: Date;
    requestedBy: string;
    orderCode: string;
  }): Promise<RefundResult> {
    return refundTransaction(this.config, {
      txnRef: r.txnRef,
      amountVnd: r.amountVnd,
      full: r.full,
      transactionNo: r.transactionNo,
      transactionDate: r.paidAt,
      createdBy: r.requestedBy,
      orderInfo: `Hoan tien don hang ${r.orderCode}`,
      ipAddr: '127.0.0.1',
    });
  }
}
