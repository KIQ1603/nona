'use client';

import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { useCustomer } from '@/lib/customer-client';

export function CancelOrderButton({ code }: { code: string }) {
  const { request } = useCustomer();
  const router = useRouter();
  const toast = useToast();
  const { pending, error, run } = useAction();
  const cancel = async () => {
    if (!window.confirm('Bạn chắc chắn muốn hủy đơn hàng này?')) return;
    const ok = await run(async () => {
      await request('POST', `/orders/${code}/cancel`);
      return true;
    });
    if (ok) {
      toast('Đã hủy đơn hàng');
      router.refresh();
    }
  };
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="btn btn-outline-site btn-sm-site"
        type="button"
        disabled={pending}
        onClick={cancel}
      >
        Hủy đơn hàng
      </button>
      <p className="fine-print">Bạn có thể tự hủy trước khi cửa hàng bắt đầu chuẩn bị đơn.</p>
    </>
  );
}
