import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * VNPay (API 2.1.0) adapter: pure functions, no framework or database. Provider payloads never leave
 * this package: callers get normalized results. All VNPay-specific encoding/signing lives here.
 *
 * NOTE: written against VNPay's published 2.1.0 contract. Before going live, verify field lists and
 * signing rules against the current VNPay documentation using real sandbox credentials.
 */
export interface VnpayConfig {
  tmnCode: string;
  hashSecret: string;
  /** Hosted payment page, e.g. https://sandbox.vnpayment.vn/paymentv2/vpcpay.html */
  payUrl: string;
  /** Merchant API (query/refund), e.g. https://sandbox.vnpayment.vn/merchant_webapi/api/transaction */
  apiUrl: string;
  /** Where VNPay sends the shopper's browser after payment. Display only: never marks anything paid. */
  returnUrl: string;
  locale?: 'vn' | 'en';
}

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const VERSION = '2.1.0';
const encode = (v: string) => encodeURIComponent(v).replace(/%20/g, '+');

/** Alphabetical `key=value&...` with VNPay's encoding; empty values are omitted. */
export function canonicalQuery(params: Record<string, string | number | null | undefined>): string {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && String(params[k]) !== '')
    .sort()
    .map((k) => `${encode(k)}=${encode(String(params[k]))}`)
    .join('&');
}

export const hmacSha512 = (secret: string, data: string) =>
  createHmac('sha512', secret).update(Buffer.from(data, 'utf-8')).digest('hex');

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase());
  const y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}

/** yyyyMMddHHmmss in Vietnam time (GMT+7), the format VNPay expects. */
export function formatVnpayDate(date: Date): string {
  const t = new Date(date.getTime() + 7 * 3_600_000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`;
}

/** VNPay rejects diacritics/special characters in order info. */
export function asciiOrderInfo(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^A-Za-z0-9 .,_-]/g, '')
    .slice(0, 255);
}

/** TxnRef is unique per attempt: the 12-char order code + a 2-digit attempt number. */
export const makeTxnRef = (orderCode: string, attempt: number) =>
  `${orderCode}${String(attempt).padStart(2, '0')}`;
export const orderCodeFromTxnRef = (txnRef: string) =>
  /^[0-9A-Z]{14}$/.test(txnRef) ? txnRef.slice(0, 12) : null;

export interface PaymentRequest {
  txnRef: string;
  amountVnd: number;
  orderInfo: string;
  ipAddr: string;
  createdAt: Date;
  expiresAt: Date;
}

export function buildPaymentUrl(cfg: VnpayConfig, req: PaymentRequest): string {
  if (!Number.isSafeInteger(req.amountVnd) || req.amountVnd <= 0)
    throw new RangeError('amount must be a positive integer of VND');
  const params = {
    vnp_Version: VERSION,
    vnp_Command: 'pay',
    vnp_TmnCode: cfg.tmnCode,
    vnp_Amount: req.amountVnd * 100, // VNPay expresses VND x 100
    vnp_CreateDate: formatVnpayDate(req.createdAt),
    vnp_CurrCode: 'VND',
    vnp_IpAddr: req.ipAddr,
    vnp_Locale: cfg.locale ?? 'vn',
    vnp_OrderInfo: asciiOrderInfo(req.orderInfo),
    vnp_OrderType: 'other',
    vnp_ReturnUrl: cfg.returnUrl,
    vnp_TxnRef: req.txnRef,
    vnp_ExpireDate: formatVnpayDate(req.expiresAt),
  };
  const query = canonicalQuery(params);
  return `${cfg.payUrl}?${query}&vnp_SecureHash=${hmacSha512(cfg.hashSecret, query)}`;
}

/** Signs a set of params the way VNPay does (used by the simulator to produce IPN/return callbacks). */
export function signCallback(
  cfg: Pick<VnpayConfig, 'hashSecret'>,
  params: Record<string, string | number>,
): Record<string, string> {
  const clean = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return { ...clean, vnp_SecureHash: hmacSha512(cfg.hashSecret, canonicalQuery(clean)) };
}

/** True only if the signature matches. Everything else about the payload is untrusted until this passes. */
export function verifyCallback(
  cfg: Pick<VnpayConfig, 'hashSecret'>,
  params: Record<string, string | undefined>,
): boolean {
  const received = params.vnp_SecureHash;
  if (!received) return false;
  const { vnp_SecureHash: _h, vnp_SecureHashType: _t, ...rest } = params;
  const data = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  return safeEqualHex(received, hmacSha512(cfg.hashSecret, canonicalQuery(data)));
}

export interface CallbackResult {
  txnRef: string;
  tmnCode: string;
  amountVnd: number | null;
  responseCode: string;
  transactionStatus: string;
  transactionNo: string | null;
  bankCode: string | null;
  payDate: string | null;
  /** The provider says money moved. Still must be checked against our own records before acting. */
  success: boolean;
}

export function parseCallback(params: Record<string, string | undefined>): CallbackResult {
  const raw = Number(params.vnp_Amount);
  const amount = Number.isFinite(raw) && raw % 100 === 0 && raw > 0 ? raw / 100 : null;
  const responseCode = params.vnp_ResponseCode ?? '';
  const transactionStatus = params.vnp_TransactionStatus ?? '';
  return {
    txnRef: params.vnp_TxnRef ?? '',
    tmnCode: params.vnp_TmnCode ?? '',
    amountVnd: amount,
    responseCode,
    transactionStatus,
    transactionNo: params.vnp_TransactionNo || null,
    bankCode: params.vnp_BankCode || null,
    payDate: params.vnp_PayDate || null,
    success: responseCode === '00' && transactionStatus === '00',
  };
}

export type ProviderStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'NOT_FOUND' | 'UNKNOWN';
export interface QueryResult {
  status: ProviderStatus;
  amountVnd: number | null;
  transactionNo: string | null;
  message: string;
}

async function post(
  cfg: VnpayConfig,
  body: Record<string, string>,
  fetchImpl: Fetch,
): Promise<Record<string, string> | null> {
  const res = await fetchImpl(cfg.apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as Record<string, string> | null;
  return json && typeof json === 'object' ? json : null;
}

const pipe = (o: Record<string, string | undefined>, keys: string[]) =>
  keys.map((k) => o[k] ?? '').join('|');
const QUERY_RESPONSE_FIELDS = [
  'vnp_ResponseId',
  'vnp_Command',
  'vnp_ResponseCode',
  'vnp_Message',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_BankCode',
  'vnp_PayDate',
  'vnp_TransactionNo',
  'vnp_TransactionType',
  'vnp_TransactionStatus',
  'vnp_OrderInfo',
  'vnp_PromotionCode',
  'vnp_PromotionAmount',
];
const REFUND_RESPONSE_FIELDS = [
  'vnp_ResponseId',
  'vnp_Command',
  'vnp_ResponseCode',
  'vnp_Message',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_BankCode',
  'vnp_PayDate',
  'vnp_TransactionNo',
  'vnp_TransactionType',
  'vnp_TransactionStatus',
  'vnp_OrderInfo',
];

export function signResponse(
  cfg: Pick<VnpayConfig, 'hashSecret'>,
  kind: 'querydr' | 'refund',
  fields: Record<string, string>,
): string {
  return hmacSha512(
    cfg.hashSecret,
    pipe(fields, kind === 'querydr' ? QUERY_RESPONSE_FIELDS : REFUND_RESPONSE_FIELDS),
  );
}
const verifyResponse = (cfg: VnpayConfig, kind: 'querydr' | 'refund', r: Record<string, string>) =>
  Boolean(r.vnp_SecureHash) && safeEqualHex(r.vnp_SecureHash!, signResponse(cfg, kind, r));

/**
 * Asks VNPay for the authoritative state of a transaction (reconciliation). A response with a bad
 * signature, an HTTP error or a network failure yields UNKNOWN: never a guess, never "paid".
 */
export async function queryTransaction(
  cfg: VnpayConfig,
  q: { txnRef: string; transactionDate: Date; orderInfo: string; ipAddr: string; now?: Date },
  fetchImpl: Fetch = fetch as unknown as Fetch,
): Promise<QueryResult> {
  const requestId = randomUUID().replace(/-/g, '');
  const createDate = formatVnpayDate(q.now ?? new Date());
  const transactionDate = formatVnpayDate(q.transactionDate);
  const orderInfo = asciiOrderInfo(q.orderInfo);
  const body: Record<string, string> = {
    vnp_RequestId: requestId,
    vnp_Version: VERSION,
    vnp_Command: 'querydr',
    vnp_TmnCode: cfg.tmnCode,
    vnp_TxnRef: q.txnRef,
    vnp_OrderInfo: orderInfo,
    vnp_TransactionDate: transactionDate,
    vnp_CreateDate: createDate,
    vnp_IpAddr: q.ipAddr,
  };
  body.vnp_SecureHash = hmacSha512(
    cfg.hashSecret,
    [
      requestId,
      VERSION,
      'querydr',
      cfg.tmnCode,
      q.txnRef,
      transactionDate,
      createDate,
      q.ipAddr,
      orderInfo,
    ].join('|'),
  );
  try {
    const r = await post(cfg, body, fetchImpl);
    if (!r)
      return { status: 'UNKNOWN', amountVnd: null, transactionNo: null, message: 'no response' };
    if (!verifyResponse(cfg, 'querydr', r))
      return {
        status: 'UNKNOWN',
        amountVnd: null,
        transactionNo: null,
        message: 'invalid response signature',
      };
    const amount = Number(r.vnp_Amount);
    const base = {
      amountVnd: Number.isFinite(amount) && amount > 0 ? amount / 100 : null,
      transactionNo: r.vnp_TransactionNo || null,
      message: r.vnp_Message ?? '',
    };
    if (r.vnp_ResponseCode === '91') return { status: 'NOT_FOUND', ...base };
    if (r.vnp_ResponseCode !== '00') return { status: 'UNKNOWN', ...base };
    if (r.vnp_TransactionStatus === '00') return { status: 'SUCCESS', ...base };
    if (r.vnp_TransactionStatus === '01') return { status: 'PENDING', ...base };
    return { status: 'FAILED', ...base };
  } catch (error) {
    return {
      status: 'UNKNOWN',
      amountVnd: null,
      transactionNo: null,
      message: (error as Error).message,
    };
  }
}

export interface RefundResult {
  ok: boolean;
  /** True when the outcome is not known (timeout/bad signature): the caller must NOT retry blindly. */
  uncertain: boolean;
  providerRef: string | null;
  message: string;
}

export async function refundTransaction(
  cfg: VnpayConfig,
  r: {
    txnRef: string;
    amountVnd: number;
    full: boolean;
    transactionNo: string;
    transactionDate: Date;
    createdBy: string;
    orderInfo: string;
    ipAddr: string;
    now?: Date;
  },
  fetchImpl: Fetch = fetch as unknown as Fetch,
): Promise<RefundResult> {
  const requestId = randomUUID().replace(/-/g, '');
  const createDate = formatVnpayDate(r.now ?? new Date());
  const transactionDate = formatVnpayDate(r.transactionDate);
  const orderInfo = asciiOrderInfo(r.orderInfo);
  const type = r.full ? '02' : '03';
  const amount = String(r.amountVnd * 100);
  const body: Record<string, string> = {
    vnp_RequestId: requestId,
    vnp_Version: VERSION,
    vnp_Command: 'refund',
    vnp_TmnCode: cfg.tmnCode,
    vnp_TransactionType: type,
    vnp_TxnRef: r.txnRef,
    vnp_Amount: amount,
    vnp_OrderInfo: orderInfo,
    vnp_TransactionNo: r.transactionNo,
    vnp_TransactionDate: transactionDate,
    vnp_CreateBy: r.createdBy,
    vnp_CreateDate: createDate,
    vnp_IpAddr: r.ipAddr,
  };
  body.vnp_SecureHash = hmacSha512(
    cfg.hashSecret,
    [
      requestId,
      VERSION,
      'refund',
      cfg.tmnCode,
      type,
      r.txnRef,
      amount,
      r.transactionNo,
      transactionDate,
      r.createdBy,
      createDate,
      r.ipAddr,
      orderInfo,
    ].join('|'),
  );
  try {
    const res = await post(cfg, body, fetchImpl);
    if (!res) return { ok: false, uncertain: true, providerRef: null, message: 'no response' };
    if (!verifyResponse(cfg, 'refund', res))
      return {
        ok: false,
        uncertain: true,
        providerRef: null,
        message: 'invalid response signature',
      };
    const ok =
      res.vnp_ResponseCode === '00' &&
      (res.vnp_TransactionStatus === '05' ||
        res.vnp_TransactionStatus === '06' ||
        res.vnp_TransactionStatus === '00');
    return {
      ok,
      uncertain: false,
      providerRef: res.vnp_TransactionNo || null,
      message: res.vnp_Message ?? '',
    };
  } catch (error) {
    return { ok: false, uncertain: true, providerRef: null, message: (error as Error).message };
  }
}
