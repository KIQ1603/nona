'use client';

import { DESIGN_STATUS_LABELS, type AdminDesignDetail, type DesignStatus } from '@nona/contracts';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnchoredMenu } from '@/components/admin/anchored-menu';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';

export interface DesignRow {
  designId: string;
  versionId: string;
  versionNo: number;
  title: string;
  status: DesignStatus;
  owner: string;
  productName: string;
  submittedAt: string | null;
  hasPreview: boolean;
}

const TONE: Record<DesignStatus, string> = {
  DRAFT: 'muted',
  SUBMITTED: 'amber',
  APPROVED: 'green',
  REVISION_REQUIRED: 'orange',
  ARCHIVED: 'muted',
};
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/** Status of a design; a design waiting for review can be approved right from here. */
function StatusCell({
  row,
  canReview,
  onChanged,
}: {
  row: DesignRow;
  canReview: boolean;
  onChanged: (status: DesignStatus) => void;
}) {
  const { request } = useAdmin();
  const toast = useToast();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction();
  const badge = (
    <span className={`st-badge st-${TONE[row.status]}`}>{DESIGN_STATUS_LABELS[row.status]}</span>
  );
  if (!canReview || row.status !== 'SUBMITTED') return badge;

  const decide = async (decision: 'APPROVE' | 'REQUEST_REVISION') => {
    const res = await act.run(() =>
      request<AdminDesignDetail>('POST', `/admin/designs/versions/${row.versionId}/review`, {
        decision,
        ...(decision === 'REQUEST_REVISION' ? { note: note.trim() } : {}),
      }),
    );
    if (res) {
      onChanged(res.latest.status);
      setAsking(false);
      setNote('');
      toast(decision === 'APPROVE' ? 'Đã duyệt thiết kế' : 'Đã yêu cầu khách chỉnh sửa');
    }
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`st-badge st-${TONE[row.status]} st-trigger`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={act.pending}
        onClick={() => setOpen(!open)}
      >
        {DESIGN_STATUS_LABELS[row.status]}
        <span className="st-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <AnchoredMenu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        label="Duyệt thiết kế"
      >
        <div className="am-title">Chuyển sang</div>
        <button
          type="button"
          role="menuitem"
          className="am-item"
          onClick={() => {
            setOpen(false);
            void decide('APPROVE');
          }}
        >
          <span className="st-dot st-green" aria-hidden="true" />
          <span>Duyệt</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="am-item"
          onClick={() => {
            setOpen(false);
            setAsking(true);
          }}
        >
          <span className="st-dot st-orange" aria-hidden="true" />
          <span>Yêu cầu chỉnh sửa…</span>
        </button>
      </AnchoredMenu>
      {act.error && !asking && (
        <span className="st-error" role="alert">
          {act.error}
        </span>
      )}
      {asking &&
        createPortal(
          <div className="admin-root admin-portal">
            <div
              className="modal-backdrop"
              role="presentation"
              onMouseDown={(e) => e.target === e.currentTarget && setAsking(false)}
            >
              <form
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="revise-title"
                onSubmit={(e) => {
                  e.preventDefault();
                  void decide('REQUEST_REVISION');
                }}
                onKeyDown={(e) => e.key === 'Escape' && setAsking(false)}
              >
                <h3 id="revise-title">Yêu cầu khách chỉnh sửa</h3>
                <p>
                  Khách nhận email kèm ghi chú này. “{row.title}” · {row.owner}
                </p>
                <label className="field">
                  <span>Cần chỉnh gì? *</span>
                  <textarea
                    required
                    autoFocus
                    rows={3}
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                {act.error && (
                  <p className="form-error" role="alert">
                    {act.error}
                  </p>
                )}
                <div className="form-actions">
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={act.pending || !note.trim()}
                  >
                    Gửi yêu cầu
                  </button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={() => setAsking(false)}
                  >
                    Đóng
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function RowMenu({ row }: { row: DesignRow }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="row-more"
        aria-label={`Thao tác cho thiết kế ${row.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      <AnchoredMenu
        open={open}
        anchor={anchor}
        align="right"
        onClose={() => setOpen(false)}
        label="Thao tác"
      >
        <Link
          className="am-item"
          role="menuitem"
          href={`/admin/designs/${row.designId}`}
          onClick={() => setOpen(false)}
        >
          <span aria-hidden="true">👁</span>
          <span>Xem chi tiết</span>
        </Link>
      </AnchoredMenu>
    </>
  );
}

export function DesignsTable({ initial }: { initial: DesignRow[] }) {
  const { can } = useAdmin();
  const [rows, setRows] = useState(initial);
  const canReview = can('designs:review');
  return (
    <div className="table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Xem trước</th>
            <th>Thiết kế</th>
            <th>Khách</th>
            <th>Nón nền</th>
            <th>Trạng thái</th>
            <th>Gửi lúc</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.versionId}>
              <td>
                {d.hasPreview && (
                  <img
                    src={`/api/custom-designs/versions/${d.versionId}/preview`}
                    alt=""
                    width={48}
                    height={60}
                    loading="lazy"
                    style={{ borderRadius: 8, objectFit: 'cover' }}
                  />
                )}
              </td>
              <td className="wrap">
                <Link href={`/admin/designs/${d.designId}`}>
                  <strong>{d.title}</strong>
                </Link>
                <br />
                <small>phiên bản {d.versionNo}</small>
              </td>
              <td className="wrap">{d.owner}</td>
              <td className="wrap">{d.productName}</td>
              <td>
                <StatusCell
                  row={d}
                  canReview={canReview}
                  onChanged={(status) =>
                    setRows((rs) =>
                      rs.map((r) => (r.versionId === d.versionId ? { ...r, status } : r)),
                    )
                  }
                />
              </td>
              <td>{when(d.submittedAt)}</td>
              <td className="row-actions">
                <RowMenu row={d} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7}>Không có thiết kế phù hợp.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
