'use client';

import { DESIGN_STATUS_LABELS, formatVnd, type AdminDesignDetail } from '@nona/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';

export function DesignReview({ initial }: { initial: AdminDesignDetail }) {
  const { request, can } = useAdmin();
  const toast = useToast();
  const [d, setD] = useState(initial);
  const [note, setNote] = useState('');
  const [reject, setReject] = useState<string[]>([]);
  const act = useAction();
  const v = d.latest;
  const canReview = can('designs:review') && v.status === 'SUBMITTED';

  const decide = async (decision: 'APPROVE' | 'REQUEST_REVISION', e?: FormEvent) => {
    e?.preventDefault();
    const res = await act.run(() =>
      request<AdminDesignDetail>('POST', `/admin/designs/versions/${v.id}/review`, {
        decision,
        note: note.trim() || undefined,
        rejectAssetIds: decision === 'REQUEST_REVISION' ? reject : [],
      }),
    );
    if (res) {
      setD(res);
      toast(
        decision === 'APPROVE'
          ? 'Đã duyệt thiết kế. Khách sẽ nhận email.'
          : 'Đã yêu cầu chỉnh sửa. Khách sẽ nhận email.',
      );
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p>
            <Link href="/admin/designs">← Thiết kế riêng</Link>
          </p>
          <h1 className="row-inline">
            {d.title}{' '}
            <span className={`pill pill-d-${v.status.toLowerCase()}`}>
              {DESIGN_STATUS_LABELS[v.status]}
            </span>
          </h1>
          <p>
            Phiên bản {v.versionNo} ·{' '}
            {d.ownerKind === 'GUEST' ? 'Khách chưa đăng nhập' : 'Tài khoản'}: {d.owner}
          </p>
        </div>
      </div>
      <div className="design-review-grid">
        <div className="admin-card">
          {v.hasPreview ? (
            <img
              className="design-review-preview"
              src={`/api/custom-designs/versions/${v.id}/preview`}
              alt="Bản xem trước thiết kế"
            />
          ) : (
            <p>Chưa có ảnh xem trước (bản nháp).</p>
          )}
        </div>
        <div>
          <div className="admin-card">
            <h2>Thông số sản xuất</h2>
            <p>
              <strong>Nón nền:</strong> {d.product.name} — {d.product.variantName} (
              {formatVnd(d.product.basePriceVnd)})
            </p>
            <ol>
              {v.layers.map((l) => (
                <li key={l.id}>
                  {l.kind === 'TEXT' && (
                    <>
                      Chữ “{l.text}” · kiểu {l.fontId}
                    </>
                  )}
                  {l.kind === 'MOTIF' && <>Charm mã {l.motifId}</>}
                  {l.kind === 'IMAGE' && <>Ảnh riêng</>}
                  <small>
                    {' '}
                    · vị trí ({l.x.toFixed(2)}, {l.y.toFixed(2)}) · xoay {l.rotation}°
                    {l.kind === 'TEXT'
                      ? ` · ×${l.scale.toFixed(2)}`
                      : ' · kích thước cố định theo tỉ lệ nón'}
                  </small>
                </li>
              ))}
              {v.layers.length === 0 && <li>Không có lớp thiết kế.</li>}
            </ol>
            <h3>
              Phụ thu {v.priceAdditionVnd != null ? formatVnd(v.priceAdditionVnd) : '(chưa chốt)'}
            </h3>
            <ul>
              {d.priceLines.map((l, i) => (
                <li key={`${l.label}-${i}`}>
                  {l.label}: {formatVnd(l.amountVnd)}
                </li>
              ))}
            </ul>
          </div>

          {d.assets.length > 0 && (
            <div className="admin-card">
              <h2>Ảnh khách tải lên</h2>
              <div className="design-assets">
                {d.assets.map((a) => (
                  <figure key={a.id}>
                    <a
                      href={`/api/custom-designs/assets/${a.id}/content`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={`/api/custom-designs/assets/${a.id}/content`}
                        alt=""
                        width={120}
                        height={120}
                      />
                    </a>
                    <figcaption>
                      {a.status === 'APPROVED'
                        ? 'Đã duyệt'
                        : a.status === 'REJECTED'
                          ? 'Đã từ chối'
                          : 'Chờ duyệt'}
                      {canReview && a.status !== 'REJECTED' && (
                        <label className="row-inline">
                          <input
                            type="checkbox"
                            checked={reject.includes(a.id)}
                            onChange={(e) =>
                              setReject(
                                e.target.checked
                                  ? [...reject, a.id]
                                  : reject.filter((x) => x !== a.id),
                              )
                            }
                          />{' '}
                          Từ chối ảnh
                        </label>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {v.reviewNote && v.status !== 'SUBMITTED' && (
            <div className="admin-card">
              <strong>Ghi chú đã gửi khách:</strong> {v.reviewNote}
            </div>
          )}

          {canReview && (
            <form className="admin-card" onSubmit={(e) => decide('REQUEST_REVISION', e)}>
              <h2>Duyệt thiết kế</h2>
              <label className="field">
                <span>Ghi chú cho khách (bắt buộc khi yêu cầu chỉnh sửa)</span>
                <textarea
                  value={note}
                  maxLength={500}
                  rows={3}
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
                  type="button"
                  className="btn btn-primary"
                  disabled={act.pending || reject.length > 0}
                  onClick={() => decide('APPROVE')}
                >
                  Duyệt
                </button>
                <button
                  type="submit"
                  className="btn btn-outline"
                  disabled={act.pending || note.trim() === ''}
                >
                  Yêu cầu chỉnh sửa
                </button>
              </div>
            </form>
          )}
          <div className="admin-card">
            <h2>Các phiên bản</h2>
            <ul>
              {d.versions.map((x) => (
                <li key={x.id}>
                  v{x.versionNo} — {DESIGN_STATUS_LABELS[x.status]} (
                  {new Date(x.createdAt).toLocaleDateString('vi-VN')})
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
