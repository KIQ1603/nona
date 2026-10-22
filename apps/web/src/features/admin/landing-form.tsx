'use client';

import type { AdminSettings } from '@nona/contracts';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';

type Landing = AdminSettings['landing'];
type Content = Omit<Landing, 'version'>;

function Field({
  label,
  value,
  onChange,
  max,
  multiline,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="admin-card">
    <h2>{title}</h2>
    {children}
  </div>
);

export function LandingForm({ initial }: { initial: Landing }) {
  const { request } = useAdmin();
  const toast = useToast();
  const [version, setVersion] = useState(initial.version);
  const [c, setC] = useState<Content>(() => {
    const { version: _v, ...rest } = initial;
    return rest;
  });
  const act = useAction();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const clean: Content = {
      ...c,
      story: { ...c.story, imageUrl: c.story.imageUrl?.trim() || null },
      testimonials: {
        ...c.testimonials,
        items: c.testimonials.items.map((t) => ({ ...t, imageUrl: t.imageUrl?.trim() || null })),
      },
    };
    const res = await act.run(() =>
      request<AdminSettings>('PATCH', '/admin/settings/landing', { version, value: clean }),
    );
    if (res) {
      const { version: v, ...rest } = res.landing;
      setVersion(v);
      setC(rest);
      toast('Đã lưu nội dung trang chủ. Cửa hàng cập nhật ngay.');
    }
  };

  const setHero = (p: Partial<Content['hero']>) => setC({ ...c, hero: { ...c.hero, ...p } });
  const setStory = (p: Partial<Content['story']>) => setC({ ...c, story: { ...c.story, ...p } });
  const setProcess = (p: Partial<Content['process']>) =>
    setC({ ...c, process: { ...c.process, ...p } });
  const setTesti = (p: Partial<Content['testimonials']>) =>
    setC({ ...c, testimonials: { ...c.testimonials, ...p } });
  const setOrder = (p: Partial<Content['order']>) => setC({ ...c, order: { ...c.order, ...p } });
  const patchAt = <T,>(list: T[], i: number, p: Partial<T>) =>
    list.map((x, j) => (j === i ? { ...x, ...p } : x));

  return (
    <form onSubmit={save}>
      <Card title="1. Đầu trang">
        <Field
          label="Dòng nhỏ phía trên"
          value={c.hero.eyebrow}
          max={80}
          onChange={(v) => setHero({ eyebrow: v })}
        />
        <div className="form-row">
          <Field
            label="Tiêu đề (dòng 1)"
            value={c.hero.titleTop}
            max={40}
            onChange={(v) => setHero({ titleTop: v })}
          />
          <Field
            label="Tiêu đề (dòng 2, nhấn màu)"
            value={c.hero.titleAccent}
            max={40}
            onChange={(v) => setHero({ titleAccent: v })}
          />
        </div>
        <Field
          label="Mô tả"
          value={c.hero.text}
          max={400}
          multiline
          onChange={(v) => setHero({ text: v })}
        />
        <div className="form-row">
          <Field
            label="Nút chính"
            value={c.hero.primaryCta}
            max={40}
            onChange={(v) => setHero({ primaryCta: v })}
          />
          <Field
            label="Nút phụ"
            value={c.hero.secondaryCta}
            max={40}
            onChange={(v) => setHero({ secondaryCta: v })}
          />
        </div>
      </Card>

      <Card title="2. Câu chuyện">
        <Field
          label="Dòng nhỏ"
          value={c.story.eyebrow}
          max={40}
          onChange={(v) => setStory({ eyebrow: v })}
        />
        <div className="form-row">
          <Field
            label="Tiêu đề: phần đầu"
            value={c.story.title.before}
            max={120}
            onChange={(v) => setStory({ title: { ...c.story.title, before: v } })}
          />
          <Field
            label="Từ nhấn (chữ nghiêng, màu vàng)"
            value={c.story.title.accent}
            max={80}
            onChange={(v) => setStory({ title: { ...c.story.title, accent: v } })}
          />
          <Field
            label="Tiêu đề: phần cuối"
            value={c.story.title.after}
            max={120}
            onChange={(v) => setStory({ title: { ...c.story.title, after: v } })}
          />
        </div>
        <Field
          label="Nội dung"
          value={c.story.text}
          max={700}
          multiline
          onChange={(v) => setStory({ text: v })}
        />
        <div className="form-row">
          <Field
            label="Số lớn chìm ở nền"
            value={c.story.bigWord}
            max={8}
            onChange={(v) => setStory({ bigWord: v })}
          />
          <Field
            label="Chữ quanh con dấu tròn"
            value={c.story.badgeText}
            max={60}
            onChange={(v) => setStory({ badgeText: v })}
          />
        </div>
        <div className="form-row">
          <Field
            label="Ảnh (liên kết https://)"
            value={c.story.imageUrl ?? ''}
            max={500}
            onChange={(v) => setStory({ imageUrl: v })}
            hint="Dùng ảnh bạn có quyền sử dụng."
          />
          <Field
            label="Mô tả ảnh"
            value={c.story.imageAlt}
            max={120}
            onChange={(v) => setStory({ imageAlt: v })}
          />
        </div>
        <h3>Con số nổi bật</h3>
        {c.story.stats.map((s, i) => (
          <div className="form-row" key={i}>
            <label className="field">
              <span>Số</span>
              <input
                type="number"
                min={0}
                value={s.value}
                onChange={(e) =>
                  setStory({
                    stats: patchAt(c.story.stats, i, {
                      value: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    }),
                  })
                }
              />
            </label>
            <Field
              label="Hậu tố (vd +)"
              value={s.suffix}
              max={4}
              onChange={(v) => setStory({ stats: patchAt(c.story.stats, i, { suffix: v }) })}
            />
            <Field
              label="Nhãn"
              value={s.label}
              max={40}
              onChange={(v) => setStory({ stats: patchAt(c.story.stats, i, { label: v }) })}
            />
            <button
              type="button"
              className="btn btn-sm btn-danger-outline"
              onClick={() => setStory({ stats: c.story.stats.filter((_, j) => j !== i) })}
            >
              Xóa
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-outline"
          disabled={c.story.stats.length >= 4}
          onClick={() =>
            setStory({ stats: [...c.story.stats, { value: 0, suffix: '', label: 'Nhãn mới' }] })
          }
        >
          + Thêm con số
        </button>
      </Card>

      <Card title="3. Quy trình">
        <Field
          label="Dòng nhỏ"
          value={c.process.eyebrow}
          max={40}
          onChange={(v) => setProcess({ eyebrow: v })}
        />
        <div className="form-row">
          <Field
            label="Tiêu đề: phần đầu"
            value={c.process.title.before}
            max={120}
            onChange={(v) => setProcess({ title: { ...c.process.title, before: v } })}
          />
          <Field
            label="Từ nhấn"
            value={c.process.title.accent}
            max={80}
            onChange={(v) => setProcess({ title: { ...c.process.title, accent: v } })}
          />
          <Field
            label="Tiêu đề: phần cuối"
            value={c.process.title.after}
            max={120}
            onChange={(v) => setProcess({ title: { ...c.process.title, after: v } })}
          />
        </div>
        {c.process.steps.map((s, i) => (
          <fieldset className="admin-subcard" key={i}>
            <legend>Bước {i + 1}</legend>
            <div className="form-row">
              <Field
                label="Biểu tượng (emoji)"
                value={s.icon}
                max={8}
                onChange={(v) => setProcess({ steps: patchAt(c.process.steps, i, { icon: v }) })}
              />
              <Field
                label="Tên bước"
                value={s.title}
                max={60}
                onChange={(v) => setProcess({ steps: patchAt(c.process.steps, i, { title: v }) })}
              />
              <Field
                label="Thời gian"
                value={s.duration}
                max={30}
                onChange={(v) =>
                  setProcess({ steps: patchAt(c.process.steps, i, { duration: v }) })
                }
              />
            </div>
            <Field
              label="Mô tả"
              value={s.text}
              max={240}
              multiline
              onChange={(v) => setProcess({ steps: patchAt(c.process.steps, i, { text: v }) })}
            />
            <button
              type="button"
              className="btn btn-sm btn-danger-outline"
              onClick={() => setProcess({ steps: c.process.steps.filter((_, j) => j !== i) })}
            >
              Xóa bước
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn btn-outline"
          disabled={c.process.steps.length >= 8}
          onClick={() =>
            setProcess({
              steps: [
                ...c.process.steps,
                { icon: '✨', title: 'Bước mới', text: '', duration: '' },
              ],
            })
          }
        >
          + Thêm bước
        </button>
      </Card>

      <Card title="4. Khách hàng nói gì">
        <p>
          <small>
            Chỉ đăng đánh giá thật của khách, có sự đồng ý của họ. Dữ liệu mẫu ban đầu cần được thay
            thế.
          </small>
        </p>
        <Field
          label="Dòng nhỏ"
          value={c.testimonials.eyebrow}
          max={40}
          onChange={(v) => setTesti({ eyebrow: v })}
        />
        {c.testimonials.items.map((t, i) => (
          <fieldset className="admin-subcard" key={i}>
            <legend>Đánh giá {i + 1}</legend>
            <Field
              label="Nội dung"
              value={t.quote}
              max={300}
              multiline
              onChange={(v) => setTesti({ items: patchAt(c.testimonials.items, i, { quote: v }) })}
            />
            <div className="form-row">
              <Field
                label="Tên khách"
                value={t.name}
                max={60}
                onChange={(v) => setTesti({ items: patchAt(c.testimonials.items, i, { name: v }) })}
              />
              <Field
                label="Nơi ở · sản phẩm"
                value={t.where}
                max={80}
                onChange={(v) =>
                  setTesti({ items: patchAt(c.testimonials.items, i, { where: v }) })
                }
              />
            </div>
            <div className="form-row">
              <Field
                label="Ảnh (https://)"
                value={t.imageUrl ?? ''}
                max={500}
                onChange={(v) =>
                  setTesti({ items: patchAt(c.testimonials.items, i, { imageUrl: v }) })
                }
              />
              <Field
                label="Chú thích ảnh"
                value={t.caption}
                max={80}
                onChange={(v) =>
                  setTesti({ items: patchAt(c.testimonials.items, i, { caption: v }) })
                }
              />
            </div>
            <button
              type="button"
              className="btn btn-sm btn-danger-outline"
              onClick={() => setTesti({ items: c.testimonials.items.filter((_, j) => j !== i) })}
            >
              Xóa đánh giá
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn btn-outline"
          disabled={c.testimonials.items.length >= 8}
          onClick={() =>
            setTesti({
              items: [
                ...c.testimonials.items,
                { quote: '', name: '', where: '', imageUrl: null, caption: '' },
              ],
            })
          }
        >
          + Thêm đánh giá
        </button>
      </Card>

      <Card title="5. Đặt hàng">
        <p>
          <small>
            Địa chỉ, giờ làm việc và các kênh liên hệ lấy từ “Liên hệ &amp; kênh chat”; câu miễn phí
            vận chuyển lấy từ cấu hình vận chuyển.
          </small>
        </p>
        <Field
          label="Dòng nhỏ"
          value={c.order.eyebrow}
          max={40}
          onChange={(v) => setOrder({ eyebrow: v })}
        />
        <div className="form-row">
          <Field
            label="Tiêu đề (dòng 1)"
            value={c.order.titleTop}
            max={60}
            onChange={(v) => setOrder({ titleTop: v })}
          />
          <Field
            label="Từ nhấn"
            value={c.order.titleAccent}
            max={60}
            onChange={(v) => setOrder({ titleAccent: v })}
          />
          <Field
            label="Tiêu đề (cuối)"
            value={c.order.titleBottom}
            max={60}
            onChange={(v) => setOrder({ titleBottom: v })}
          />
        </div>
        <Field
          label="Mô tả"
          value={c.order.text}
          max={400}
          multiline
          onChange={(v) => setOrder({ text: v })}
        />
      </Card>

      {act.error && (
        <p className="form-error" role="alert">
          {act.error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={act.pending}>
        {act.pending ? 'Đang lưu…' : 'Lưu nội dung trang chủ'}
      </button>
    </form>
  );
}
