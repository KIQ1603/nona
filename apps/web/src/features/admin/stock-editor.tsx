'use client';

import { useState } from 'react';

/**
 * Quick stock change: shows the current stock and takes the quantity to ADD (or remove). One button press
 * sends one request with that quantity.
 */
export function StockEditor({
  stock,
  label,
  busy,
  onApply,
}: {
  stock: number;
  label: string;
  busy: boolean;
  /** Receives the signed change (+ to add, - to remove). */
  onApply: (delta: number) => Promise<boolean> | boolean;
}) {
  const [amount, setAmount] = useState('');
  const n = Math.floor(Number(amount)) || 0;

  const apply = async (sign: 1 | -1) => {
    if (n <= 0 || busy) return;
    if (await onApply(sign * n)) setAmount('');
  };

  return (
    <span className="stock-stepper" role="group" aria-label={`Tồn kho ${label}`}>
      <span className="stock-now">
        Hiện có <b className={stock <= 0 ? 'out' : ''}>{stock}</b>
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        className="stock-input"
        aria-label={`Số lượng cần thêm cho ${label}`}
        placeholder="Số lượng"
        value={amount}
        disabled={busy}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void apply(1);
          }
        }}
      />
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={busy || n <= 0}
        onClick={() => void apply(1)}
      >
        + Thêm
      </button>
      <button
        type="button"
        className="btn btn-sm btn-outline"
        disabled={busy || n <= 0 || n > stock}
        title={n > stock ? 'Không thể trừ nhiều hơn số đang có' : undefined}
        onClick={() => void apply(-1)}
      >
        − Trừ
      </button>
    </span>
  );
}
