const formatter = new Intl.NumberFormat('vi-VN');

/** Display-only formatting of integer VND. Never use for calculation. */
export function formatVnd(amount: number): string {
  return `${formatter.format(amount)}đ`;
}
