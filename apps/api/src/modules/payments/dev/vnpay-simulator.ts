import { randomInt } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import {
  canonicalQuery,
  formatVnpayDate,
  hmacSha512,
  signCallback,
  signResponse,
  verifyCallback,
} from '@nona/payments';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { PaymentGateway } from '../application/payment-gateway';
import { SettlementService, type Ack } from '../application/settlement.service';

interface SimTxn {
  txnRef: string;
  amountVnd: number;
  orderInfo: string;
  createdAt: Date;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  transactionNo: string | null;
  payDate: string | null;
  refundedVnd: number;
  ipn: Record<string, string> | null;
}
export type SimMode = 'ok' | 'error';

/**
 * A stand-in for VNPay that speaks the same protocol: a payment page (served by the web app), the IPN
 * callback, and the merchant API (query/refund). It exists so the whole flow runs locally without
 * credentials. Only reachable when PAYMENTS_MODE=simulator; the environment schema forbids that in production.
 */
@Controller('dev/vnpay')
export class VnpaySimulatorController {
  private readonly txns = new Map<string, SimTxn>();
  private modes: { query: SimMode; refund: SimMode } = { query: 'ok', refund: 'ok' };

  constructor(
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
    @Inject(SettlementService) private readonly settlement: SettlementService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private assertEnabled() {
    if (!this.gateway.simulated || this.env.NODE_ENV === 'production') throw AppError.notFound();
  }
  private get cfg() {
    return this.gateway.config;
  }

  /** The "payment page" asks for the details of the transaction encoded in the payment URL. */
  @Get('transaction')
  transaction(@Query() query: Record<string, string>) {
    this.assertEnabled();
    if (!verifyCallback(this.cfg, query))
      throw AppError.validation({
        issues: [{ path: 'signature', message: 'Chữ ký không hợp lệ' }],
      });
    const txnRef = query.vnp_TxnRef!;
    let txn = this.txns.get(txnRef);
    if (!txn) {
      txn = {
        txnRef,
        amountVnd: Number(query.vnp_Amount) / 100,
        orderInfo: query.vnp_OrderInfo ?? '',
        createdAt: new Date(),
        status: 'PENDING',
        transactionNo: null,
        payDate: null,
        refundedVnd: 0,
        ipn: null,
      };
      this.txns.set(txnRef, txn);
    }
    return {
      txnRef,
      amountVnd: txn.amountVnd,
      orderInfo: txn.orderInfo,
      status: txn.status,
      expireDate: query.vnp_ExpireDate ?? null,
    };
  }

  /** The shopper pressed a button on the simulated page. Mirrors what VNPay does: IPN to us, then redirect. */
  @Post('decide')
  @HttpCode(200)
  async decide(
    @Body() body: { txnRef?: string; outcome?: 'SUCCESS' | 'FAILED'; deliverIpn?: boolean },
  ) {
    this.assertEnabled();
    const txn = body.txnRef ? this.txns.get(body.txnRef) : undefined;
    if (!txn) throw AppError.notFound('Không tìm thấy giao dịch giả lập.');
    const success = body.outcome === 'SUCCESS';
    const payDate = formatVnpayDate(new Date());
    const transactionNo = success ? String(randomInt(10_000_000, 99_999_999)) : '0';
    const params = signCallback(this.cfg, {
      vnp_TmnCode: this.cfg.tmnCode,
      vnp_Amount: txn.amountVnd * 100,
      vnp_BankCode: 'NCB',
      vnp_BankTranNo: success ? `NCB${transactionNo}` : '',
      vnp_CardType: 'ATM',
      vnp_OrderInfo: txn.orderInfo,
      vnp_PayDate: payDate,
      vnp_ResponseCode: success ? '00' : '24',
      vnp_TransactionNo: transactionNo,
      vnp_TransactionStatus: success ? '00' : '02',
      vnp_TxnRef: txn.txnRef,
    });
    txn.status = success ? 'SUCCESS' : 'FAILED';
    txn.transactionNo = success ? transactionNo : null;
    txn.payDate = payDate;
    txn.ipn = params;
    // deliverIpn=false models a lost webhook: the provider knows the result, we do not (reconciliation must find it).
    const ack: Ack | null =
      body.deliverIpn === false ? null : await this.settlement.handleIpn(params);
    return {
      ack,
      returnUrl: `${this.cfg.returnUrl}?${canonicalQuery(params)}&vnp_SecureHash=${params.vnp_SecureHash}`,
    };
  }

  /** Re-sends the last callback, as VNPay does when it did not get an acknowledgement. */
  @Post('replay-ipn')
  @HttpCode(200)
  async replay(@Body() body: { txnRef?: string }): Promise<{ ack: Ack }> {
    this.assertEnabled();
    const txn = body.txnRef ? this.txns.get(body.txnRef) : undefined;
    if (!txn?.ipn) throw AppError.notFound('Chưa có callback để gửi lại.');
    return { ack: await this.settlement.handleIpn(txn.ipn) };
  }

  /** Test/diagnostic control: make the merchant API fail like a flaky provider. */
  @Post('control')
  @HttpCode(200)
  control(@Body() body: { query?: SimMode; refund?: SimMode }) {
    this.assertEnabled();
    this.modes = {
      query: body.query ?? this.modes.query,
      refund: body.refund ?? this.modes.refund,
    };
    return this.modes;
  }

  /** The merchant API: querydr + refund, signed in both directions like the real thing. */
  @Post('merchant_webapi/api/transaction')
  @HttpCode(200)
  merchant(@Body() b: Record<string, string>) {
    this.assertEnabled();
    const cmd = b.vnp_Command;
    if (cmd !== 'querydr' && cmd !== 'refund')
      throw AppError.validation({ issues: [{ path: 'vnp_Command', message: 'unsupported' }] });
    if (this.modes[cmd === 'querydr' ? 'query' : 'refund'] === 'error')
      throw new AppError('INTERNAL_ERROR', 500, 'simulated provider failure');

    const requestFields =
      cmd === 'querydr'
        ? [
            b.vnp_RequestId,
            b.vnp_Version,
            cmd,
            b.vnp_TmnCode,
            b.vnp_TxnRef,
            b.vnp_TransactionDate,
            b.vnp_CreateDate,
            b.vnp_IpAddr,
            b.vnp_OrderInfo,
          ]
        : [
            b.vnp_RequestId,
            b.vnp_Version,
            cmd,
            b.vnp_TmnCode,
            b.vnp_TransactionType,
            b.vnp_TxnRef,
            b.vnp_Amount,
            b.vnp_TransactionNo,
            b.vnp_TransactionDate,
            b.vnp_CreateBy,
            b.vnp_CreateDate,
            b.vnp_IpAddr,
            b.vnp_OrderInfo,
          ];
    const valid =
      b.vnp_SecureHash?.toLowerCase() ===
      hmacSha512(this.cfg.hashSecret, requestFields.map((v) => v ?? '').join('|')).toLowerCase();
    const txn = this.txns.get(b.vnp_TxnRef ?? '');

    const respond = (code: string, message: string, extra: Record<string, string> = {}) => {
      const fields: Record<string, string> = {
        vnp_ResponseId: String(randomInt(1e9)),
        vnp_Command: cmd,
        vnp_ResponseCode: code,
        vnp_Message: message,
        vnp_TmnCode: this.cfg.tmnCode,
        vnp_TxnRef: b.vnp_TxnRef ?? '',
        vnp_Amount: txn ? String(txn.amountVnd * 100) : '',
        vnp_BankCode: txn ? 'NCB' : '',
        vnp_PayDate: txn?.payDate ?? '',
        vnp_TransactionNo: txn?.transactionNo ?? '',
        vnp_TransactionType: cmd === 'refund' ? (b.vnp_TransactionType ?? '') : '01',
        vnp_TransactionStatus: '',
        vnp_OrderInfo: b.vnp_OrderInfo ?? '',
        vnp_PromotionCode: '',
        vnp_PromotionAmount: '',
        ...extra,
      };
      return { ...fields, vnp_SecureHash: signResponse(this.cfg, cmd, fields) };
    };

    if (!valid) return respond('97', 'Invalid signature');
    if (!txn) return respond('91', 'Unable to find the transaction');
    if (cmd === 'querydr')
      return respond('00', 'QueryDR Success', {
        vnp_TransactionStatus:
          txn.status === 'SUCCESS' ? '00' : txn.status === 'PENDING' ? '01' : '02',
      });
    const amount = Number(b.vnp_Amount) / 100;
    if (txn.status !== 'SUCCESS') return respond('94', 'Transaction was not successful');
    if (amount + txn.refundedVnd > txn.amountVnd)
      return respond('02', 'Refund amount exceeds the transaction');
    txn.refundedVnd += amount;
    return respond('00', 'Refund Success', { vnp_TransactionStatus: '05' });
  }
}
