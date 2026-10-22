import { formatVnd } from '@nona/contracts';

interface PriceProps {
  priceVnd: number;
  compareAtPriceVnd?: number | null;
  /** Show a "Từ" prefix when the product has variants at different prices. */
  from?: boolean;
  className?: string;
}

export function Price({ priceVnd, compareAtPriceVnd, from, className }: PriceProps) {
  return (
    <p className={`price${className ? ` ${className}` : ''}`}>
      {from && <span className="price-from">Từ</span>}
      {formatVnd(priceVnd)}
      {compareAtPriceVnd ? (
        <del>
          <span className="sr-only">Giá gốc </span>
          {formatVnd(compareAtPriceVnd)}
        </del>
      ) : null}
    </p>
  );
}
