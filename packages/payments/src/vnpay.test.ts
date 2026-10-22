import { describe, expect, it } from 'vitest';
import {
  asciiOrderInfo,
  buildPaymentUrl,
  canonicalQuery,
  formatVnpayDate,
  hmacSha512,
  makeTxnRef,
  orderCodeFromTxnRef,
  parseCallback,
  queryTransaction,
  refundTransaction,
  signCallback,
  signResponse,
  verifyCallback,
  type VnpayConfig,
} from './vnpay';

const cfg: VnpayConfig = {
  tmnCode: 'TESTTMN1',
  hashSecret: 'super-secret-key',
  payUrl: 'https://pay.test/vpc',
  apiUrl: 'https://api.test/tx',
  returnUrl: 'https://nona.vn/thanh-toan/ket-qua',
};
const at = new Date('2026-10-10T08:30:15Z'); // 15:30:15 in GMT+7

describe('encoding and dates', () => {
  it('formats dates in GMT+7', () => {
    expect(formatVnpayDate(at)).toBe('20261010153015');
    expect(formatVnpayDate(new Date('2026-12-31T20:00:00Z'))).toBe('20270101030000');
  });
  it('builds a sorted, VNPay-encoded query and drops empty values', () => {
    expect(canonicalQuery({ b: 'x y', a: 'é&=', c: '', d: undefined })).toBe(
      'a=%C3%A9%26%3D&b=x+y',
    );
  });
  it('strips diacritics from order info', () => {
    expect(asciiOrderInfo('Thanh toán đơn hàng Nón Lá #1!')).toBe('Thanh toan don hang Non La 1');
  });
  it('derives unique per-attempt references and parses the order code back', () => {
    expect(makeTxnRef('AB12CD34EF56', 3)).toBe('AB12CD34EF5603');
    expect(orderCodeFromTxnRef('AB12CD34EF5603')).toBe('AB12CD34EF56');
    expect(orderCodeFromTxnRef('bad')).toBeNull();
  });
});

describe('payment url', () => {
  const url = new URL(
    buildPaymentUrl(cfg, {
      txnRef: 'AB12CD34EF5601',
      amountVnd: 1_230_000,
      orderInfo: 'Thanh toán NONA',
      ipAddr: '1.2.3.4',
      createdAt: at,
      expiresAt: new Date(at.getTime() + 1_800_000),
    }),
  );
  it('carries amount x100, currency, return url and expiry', () => {
    const p = url.searchParams;
    expect(url.origin + url.pathname).toBe('https://pay.test/vpc');
    expect(p.get('vnp_Amount')).toBe('123000000');
    expect(p.get('vnp_CurrCode')).toBe('VND');
    expect(p.get('vnp_ReturnUrl')).toBe(cfg.returnUrl);
    expect(p.get('vnp_CreateDate')).toBe('20261010153015');
    expect(p.get('vnp_ExpireDate')).toBe('20261010160015');
    expect(p.get('vnp_TmnCode')).toBe('TESTTMN1');
  });
  it('is signed such that the provider-side verification passes, and any tampering fails', () => {
    const params = Object.fromEntries(url.searchParams);
    expect(verifyCallback(cfg, params)).toBe(true);
    expect(verifyCallback(cfg, { ...params, vnp_Amount: '100' })).toBe(false);
    expect(verifyCallback({ hashSecret: 'other' }, params)).toBe(false);
    expect(verifyCallback(cfg, { ...params, vnp_SecureHash: undefined })).toBe(false);
  });
  it('rejects non-integer or non-positive amounts', () => {
    const bad = (amountVnd: number) => () =>
      buildPaymentUrl(cfg, {
        txnRef: 'X',
        amountVnd,
        orderInfo: 'x',
        ipAddr: '1.1.1.1',
        createdAt: at,
        expiresAt: at,
      });
    expect(bad(0)).toThrow(RangeError);
    expect(bad(10.5)).toThrow(RangeError);
    expect(bad(-1)).toThrow(RangeError);
  });
});

describe('callbacks', () => {
  const ipn = signCallback(cfg, {
    vnp_TmnCode: 'TESTTMN1',
    vnp_Amount: 5_000_000,
    vnp_TxnRef: 'AB12CD34EF5601',
    vnp_ResponseCode: '00',
    vnp_TransactionStatus: '00',
    vnp_TransactionNo: '14000001',
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261010153200',
    vnp_OrderInfo: 'Thanh toan',
  });
  it('verifies a genuine callback and parses amounts back to VND', () => {
    expect(verifyCallback(cfg, ipn)).toBe(true);
    expect(parseCallback(ipn)).toMatchObject({
      txnRef: 'AB12CD34EF5601',
      amountVnd: 50_000,
      success: true,
      transactionNo: '14000001',
    });
  });
  it('ignores vnp_SecureHashType when verifying', () => {
    expect(verifyCallback(cfg, { ...ipn, vnp_SecureHashType: 'HmacSHA512' })).toBe(true);
  });
  it('rejects forged amounts, statuses and swapped references', () => {
    expect(verifyCallback(cfg, { ...ipn, vnp_Amount: '100' })).toBe(false);
    expect(verifyCallback(cfg, { ...ipn, vnp_ResponseCode: '24' })).toBe(false);
    expect(verifyCallback(cfg, { ...ipn, vnp_TxnRef: 'ZZ12CD34EF5601' })).toBe(false);
  });
  it('treats only 00/00 as success and refuses fractional or missing amounts', () => {
    expect(parseCallback({ ...ipn, vnp_ResponseCode: '24' }).success).toBe(false);
    expect(parseCallback({ ...ipn, vnp_TransactionStatus: '02' }).success).toBe(false);
    expect(parseCallback({ ...ipn, vnp_Amount: '12345' }).amountVnd).toBeNull();
    expect(parseCallback({ ...ipn, vnp_Amount: undefined }).amountVnd).toBeNull();
  });
});

function fakeApi(
  respond: (body: Record<string, string>) => Record<string, string> | null,
  status = 200,
) {
  const calls: Record<string, string>[] = [];
  const fetchImpl = async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, string>;
    calls.push(body);
    const out = respond(body);
    return { ok: status === 200, status, json: async () => out };
  };
  return { fetchImpl, calls };
}
const signedResponse = (kind: 'querydr' | 'refund', fields: Record<string, string>) => ({
  ...fields,
  vnp_SecureHash: signResponse(cfg, kind, fields),
});
const base = {
  vnp_ResponseId: 'r1',
  vnp_Command: 'querydr',
  vnp_TmnCode: 'TESTTMN1',
  vnp_TxnRef: 'AB12CD34EF5601',
  vnp_Amount: '5000000',
  vnp_Message: 'OK',
};

describe('query (reconciliation)', () => {
  const q = {
    txnRef: 'AB12CD34EF5601',
    transactionDate: at,
    orderInfo: 'x',
    ipAddr: '1.1.1.1',
    now: at,
  };
  it('signs the request with the documented pipe-joined fields', async () => {
    const api = fakeApi(() =>
      signedResponse('querydr', {
        ...base,
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
        vnp_TransactionNo: '1',
      }),
    );
    await queryTransaction(cfg, q, api.fetchImpl);
    const b = api.calls[0]!;
    const expected = hmacSha512(
      cfg.hashSecret,
      [
        b.vnp_RequestId,
        '2.1.0',
        'querydr',
        'TESTTMN1',
        'AB12CD34EF5601',
        '20261010153015',
        '20261010153015',
        '1.1.1.1',
        'x',
      ].join('|'),
    );
    expect(b.vnp_SecureHash).toBe(expected);
  });
  it('maps provider states', async () => {
    const run = async (fields: Record<string, string>) =>
      (
        await queryTransaction(
          cfg,
          q,
          fakeApi(() => signedResponse('querydr', { ...base, ...fields })).fetchImpl,
        )
      ).status;
    expect(await run({ vnp_ResponseCode: '00', vnp_TransactionStatus: '00' })).toBe('SUCCESS');
    expect(await run({ vnp_ResponseCode: '00', vnp_TransactionStatus: '01' })).toBe('PENDING');
    expect(await run({ vnp_ResponseCode: '00', vnp_TransactionStatus: '02' })).toBe('FAILED');
    expect(await run({ vnp_ResponseCode: '91' })).toBe('NOT_FOUND');
    expect(await run({ vnp_ResponseCode: '99' })).toBe('UNKNOWN');
  });
  it('never reports success for an unsigned/forged response, HTTP error or network failure', async () => {
    const forged = fakeApi(() => ({
      ...base,
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_SecureHash: 'deadbeef',
    }));
    expect((await queryTransaction(cfg, q, forged.fetchImpl)).status).toBe('UNKNOWN');
    expect((await queryTransaction(cfg, q, fakeApi(() => null, 500).fetchImpl)).status).toBe(
      'UNKNOWN',
    );
    expect(
      (
        await queryTransaction(cfg, q, async () => {
          throw new Error('ECONNRESET');
        })
      ).status,
    ).toBe('UNKNOWN');
  });
});

describe('refund', () => {
  const r = {
    txnRef: 'AB12CD34EF5601',
    amountVnd: 50_000,
    full: true,
    transactionNo: '14000001',
    transactionDate: at,
    createdBy: 'admin@nona.vn',
    orderInfo: 'Hoan tien',
    ipAddr: '1.1.1.1',
    now: at,
  };
  const ok = (extra: Record<string, string> = {}) =>
    fakeApi(() =>
      signedResponse('refund', {
        ...base,
        vnp_Command: 'refund',
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '05',
        vnp_TransactionNo: '14000099',
        ...extra,
      }),
    );
  it('sends VND x100, the right transaction type and a verifiable signature', async () => {
    const api = ok();
    const res = await refundTransaction(cfg, r, api.fetchImpl);
    expect(res).toMatchObject({ ok: true, uncertain: false, providerRef: '14000099' });
    expect(api.calls[0]).toMatchObject({
      vnp_Command: 'refund',
      vnp_TransactionType: '02',
      vnp_Amount: '5000000',
    });
    expect((await refundTransaction(cfg, { ...r, full: false }, ok().fetchImpl)).ok).toBe(true);
    expect(ok().calls).toHaveLength(0);
  });
  it('reports a definite failure when the provider refuses', async () => {
    const res = await refundTransaction(
      cfg,
      r,
      ok({ vnp_ResponseCode: '94', vnp_TransactionStatus: '' }).fetchImpl,
    );
    expect(res).toMatchObject({ ok: false, uncertain: false });
  });
  it('flags an uncertain outcome (timeout / bad signature) so callers never blindly retry', async () => {
    expect(
      await refundTransaction(cfg, r, async () => {
        throw new Error('timeout');
      }),
    ).toMatchObject({ ok: false, uncertain: true });
    expect(
      await refundTransaction(
        cfg,
        r,
        fakeApi(() => ({ ...base, vnp_ResponseCode: '00', vnp_SecureHash: 'bad' })).fetchImpl,
      ),
    ).toMatchObject({ ok: false, uncertain: true });
  });
});
