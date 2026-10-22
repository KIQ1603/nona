const LABELS = { DRAFT: 'Nháp', PUBLISHED: 'Đang bán', ARCHIVED: 'Lưu trữ' } as const;

export function StatusPill({ status }: { status: keyof typeof LABELS }) {
  return <span className={`pill pill-${status.toLowerCase()}`}>{LABELS[status]}</span>;
}
