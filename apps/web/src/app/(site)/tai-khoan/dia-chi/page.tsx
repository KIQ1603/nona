import { addressListSchema } from '@nona/contracts';
import { AddressManager } from '@/features/account/address-manager';
import { userGet } from '@/lib/session-server';

export default async function AddressesPage() {
  const list = await userGet('/me/addresses', addressListSchema, '/tai-khoan/dia-chi');
  return (
    <>
      <h1>Địa chỉ giao hàng</h1>
      <p className="lead">Lưu tối đa 10 địa chỉ để thanh toán nhanh hơn.</p>
      <AddressManager initial={list.items} />
    </>
  );
}
