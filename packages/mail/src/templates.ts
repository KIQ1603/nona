export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}
export interface RenderContext {
  /** Public web origin used to build links, e.g. https://nona.vn */
  webOrigin: string;
}

const vnd = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;
const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const group = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');

const STATUS_COPY: Record<string, { subject: string; lead: string }> = {
  SHIPPING: {
    subject: 'đang được giao',
    lead: 'Đơn hàng của bạn đã được bàn giao cho đơn vị vận chuyển.',
  },
  COMPLETED: {
    subject: 'đã giao thành công',
    lead: 'Đơn hàng của bạn đã được giao. Cảm ơn bạn đã chọn NONA!',
  },
  CANCELLED: { subject: 'đã được hủy', lead: 'Đơn hàng của bạn đã được hủy.' },
  REFUND_PENDING: {
    subject: 'đang được hoàn tiền',
    lead: 'Chúng tôi đang hoàn tiền cho đơn hàng của bạn. Tiền sẽ về tài khoản/ thẻ đã thanh toán theo thời gian xử lý của ngân hàng.',
  },
  REFUNDED: { subject: 'đã được hoàn tiền', lead: 'Đơn hàng của bạn đã được hoàn tiền đầy đủ.' },
  PARTIALLY_REFUNDED: {
    subject: 'đã được hoàn tiền một phần',
    lead: 'Chúng tôi đã hoàn tiền một phần cho đơn hàng của bạn.',
  },
};

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="vi"><body style="margin:0;background:#faf9f5;font-family:Arial,Helvetica,sans-serif;color:#21352d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;padding:28px">
<tr><td><div style="font:22px Georgia,serif;letter-spacing:.14em;color:#a83b2e">NONA</div>
<h1 style="font:400 22px Georgia,serif;margin:18px 0 12px">${esc(title)}</h1>${bodyHtml}
<p style="margin:26px 0 0;color:#6e756f;font-size:12px">NONA — Nón Việt, dấu ấn riêng.</p></td></tr></table></td></tr></table></body></html>`;
}

interface OrderPlaced {
  orderCode: string;
  customerName: string;
  paymentMethod: string;
  items: { name: string; variant: string; quantity: number; lineTotalVnd: number }[];
  subtotalVnd: number;
  discountVnd: number;
  shippingFeeVnd: number;
  totalVnd: number;
  address: {
    fullName: string;
    phone: string;
    line1: string;
    ward: string;
    district: string;
    province: string;
  };
}

/** Turns an outbox event into an email. All dynamic values are HTML-escaped. Returns null for unknown types. */
export function renderEmail(
  type: string,
  payload: Record<string, unknown>,
  ctx: RenderContext,
): RenderedEmail | null {
  const origin = ctx.webOrigin.replace(/\/$/, '');

  /** The big code box shared by the one-time-code emails. */
  const codeBox = (code: unknown) =>
    `<p style="margin:18px 0"><span style="display:inline-block;background:#f5efe0;border-radius:14px;padding:14px 26px;font:700 32px Arial,Helvetica,sans-serif;letter-spacing:.35em;color:#21352d">${esc(code)}</span></p>`;

  if (type === 'auth.welcome') {
    const url = `${origin}/tai-khoan`;
    const text = [
      `Xin chào ${payload.fullName},`,
      '',
      'Chào mừng bạn đến với NONA! Tài khoản của bạn đã được tạo thành công.',
      ...(payload.code
        ? [
            '',
            `Mã xác thực email của bạn: ${payload.code} (hiệu lực ${payload.ttlMinutes ?? 10} phút).`,
            `Nhập mã tại: ${url}`,
          ]
        : []),
      '',
      'Nếu bạn không tạo tài khoản này, hãy bỏ qua email này.',
    ].join('\n');
    const html = layout(
      'Chào mừng bạn đến với NONA',
      `<p>Xin chào ${esc(payload.fullName)}, tài khoản NONA của bạn đã được tạo thành công.</p>${
        payload.code
          ? `<p>Để xác nhận email này là của bạn, hãy nhập mã sau trong trang tài khoản (hiệu lực ${esc(payload.ttlMinutes ?? 10)} phút):</p>${codeBox(payload.code)}<p><a href="${esc(url)}" style="display:inline-block;background:#a83b2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:99px">Mở trang tài khoản</a></p>`
          : ''
      }<p style="color:#6e756f;font-size:13px">Nếu bạn không tạo tài khoản này, hãy bỏ qua email này.</p>`,
    );
    return { subject: 'NONA — Chào mừng bạn! Đăng ký thành công', text, html };
  }

  if (type === 'auth.email_otp') {
    const text = [
      `Xin chào ${payload.fullName},`,
      '',
      `Mã xác thực email NONA của bạn: ${payload.code}`,
      `Mã có hiệu lực ${payload.ttlMinutes ?? 10} phút. Không chia sẻ mã này cho bất kỳ ai.`,
      '',
      'Nếu bạn không yêu cầu mã này, hãy bỏ qua email.',
    ].join('\n');
    const html = layout(
      'Mã xác thực email',
      `<p>Xin chào ${esc(payload.fullName)}, đây là mã xác thực email của bạn:</p>${codeBox(payload.code)}<p style="font-size:14px">Mã có hiệu lực ${esc(payload.ttlMinutes ?? 10)} phút. Không chia sẻ mã này cho bất kỳ ai.</p><p style="color:#6e756f;font-size:13px">Nếu bạn không yêu cầu mã này, hãy bỏ qua email.</p>`,
    );
    return { subject: `NONA — Mã xác thực email: ${payload.code}`, text, html };
  }

  if (type === 'auth.password_changed') {
    const url = `${origin}/quen-mat-khau`;
    const how = payload.how === 'reset' ? 'đặt lại' : 'đổi';
    const text = [
      `Xin chào ${payload.fullName},`,
      '',
      `Mật khẩu tài khoản NONA của bạn vừa được ${how}. Mọi thiết bị khác đã bị đăng xuất.`,
      '',
      `Nếu không phải bạn, hãy đặt lại mật khẩu ngay: ${url} và liên hệ NONA.`,
    ].join('\n');
    const html = layout(
      'Mật khẩu đã được thay đổi',
      `<p>Xin chào ${esc(payload.fullName)}, mật khẩu tài khoản NONA của bạn vừa được ${how}. Mọi thiết bị khác đã bị đăng xuất.</p><p><strong>Không phải bạn?</strong> Hãy đặt lại mật khẩu ngay và liên hệ NONA.</p><p><a href="${esc(url)}" style="display:inline-block;background:#a83b2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:99px">Đặt lại mật khẩu</a></p>`,
    );
    return { subject: 'NONA — Mật khẩu của bạn đã được thay đổi', text, html };
  }

  if (type === 'order.placed') {
    const p = payload as unknown as OrderPlaced;
    const url = `${origin}/don-hang/${p.orderCode}`;
    const lines = p.items.map(
      (i) =>
        `${i.name}${i.variant !== 'Tiêu chuẩn' ? ` (${i.variant})` : ''} × ${i.quantity} — ${vnd(i.lineTotalVnd)}`,
    );
    const a = p.address;
    const text = [
      `Xin chào ${p.customerName},`,
      '',
      `Cảm ơn bạn đã đặt hàng tại NONA. Mã đơn hàng: ${group(p.orderCode)}`,
      '',
      ...lines,
      '',
      `Tạm tính: ${vnd(p.subtotalVnd)}`,
      ...(p.discountVnd > 0 ? [`Giảm giá: -${vnd(p.discountVnd)}`] : []),
      `Phí vận chuyển: ${p.shippingFeeVnd === 0 ? 'Miễn phí' : vnd(p.shippingFeeVnd)}`,
      `Tổng cộng: ${vnd(p.totalVnd)}`,
      `Thanh toán: ${p.paymentMethod === 'COD' ? 'Khi nhận hàng (COD)' : p.paymentMethod}`,
      '',
      `Giao đến: ${a.fullName}, ${a.phone}, ${a.line1}, ${a.ward}, ${a.district}, ${a.province}`,
      '',
      `Theo dõi đơn hàng: ${url}`,
    ].join('\n');
    const rows = p.items
      .map(
        (i) =>
          `<tr><td style="padding:6px 0">${esc(i.name)}${i.variant !== 'Tiêu chuẩn' ? ` <span style="color:#6e756f">(${esc(i.variant)})</span>` : ''} × ${esc(i.quantity)}</td><td align="right" style="padding:6px 0">${esc(vnd(i.lineTotalVnd))}</td></tr>`,
      )
      .join('');
    const html = layout(
      'Cảm ơn bạn đã đặt hàng!',
      `<p>Xin chào ${esc(p.customerName)}, mã đơn hàng của bạn là <strong>${esc(group(p.orderCode))}</strong>.</p>
<table role="presentation" width="100%" style="border-top:1px solid #e6e2d6;border-bottom:1px solid #e6e2d6;margin:14px 0;font-size:14px">${rows}</table>
<p style="font-size:14px;line-height:1.7">Tạm tính: ${esc(vnd(p.subtotalVnd))}<br>Phí vận chuyển: ${p.shippingFeeVnd === 0 ? 'Miễn phí' : esc(vnd(p.shippingFeeVnd))}<br><strong>Tổng cộng: ${esc(vnd(p.totalVnd))}</strong><br>Thanh toán khi nhận hàng (COD)</p>
<p style="font-size:14px">Giao đến: ${esc(a.fullName)}, ${esc(a.phone)}, ${esc(a.line1)}, ${esc(a.ward)}, ${esc(a.district)}, ${esc(a.province)}</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#a83b2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:99px">Theo dõi đơn hàng</a></p>`,
    );
    return { subject: `NONA — Xác nhận đơn hàng ${group(p.orderCode)}`, text, html };
  }

  if (type === 'order.status_changed') {
    const code = String(payload.orderCode);
    const status = String(payload.status);
    const copy = STATUS_COPY[status];
    if (!copy) return null;
    const url = `${origin}/don-hang/${code}`;
    const extra: string[] = [];
    if (status === 'SHIPPING' && payload.carrier)
      extra.push(
        `Đơn vị vận chuyển: ${payload.carrier}${payload.trackingCode ? ` — mã vận đơn ${payload.trackingCode}` : ''}`,
      );
    if (status === 'CANCELLED' && payload.reason) extra.push(`Lý do: ${payload.reason}`);
    const text = [
      `Xin chào ${payload.customerName},`,
      '',
      `Đơn hàng ${group(code)} ${copy.subject}.`,
      copy.lead,
      ...extra,
      '',
      `Chi tiết: ${url}`,
    ].join('\n');
    const html = layout(
      `Đơn hàng ${group(code)} ${copy.subject}`,
      `<p>Xin chào ${esc(payload.customerName)},</p><p>${esc(copy.lead)}</p>${extra.map((e) => `<p style="color:#6e756f">${esc(e)}</p>`).join('')}<p><a href="${esc(url)}" style="display:inline-block;background:#a83b2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:99px">Xem đơn hàng</a></p>`,
    );
    return { subject: `NONA — Đơn hàng ${group(code)} ${copy.subject}`, text, html };
  }

  if (type === 'design.reviewed') {
    const approved = payload.decision === 'APPROVED';
    const url = `${origin}/thiet-ke-non/${String(payload.designId)}`;
    const title = String(payload.designTitle);
    const note = payload.note ? String(payload.note) : '';
    const lead = approved
      ? 'Thiết kế của bạn đã được duyệt. Bạn có thể thêm vào giỏ hàng và đặt hàng ngay.'
      : 'Nghệ nhân cần bạn chỉnh sửa thiết kế một chút trước khi sản xuất.';
    const text = [
      `Xin chào,`,
      '',
      `Thiết kế "${title}" (phiên bản ${payload.versionNo}) ${approved ? 'đã được duyệt' : 'cần chỉnh sửa'}.`,
      lead,
      ...(note ? [`Ghi chú từ NONA: ${note}`] : []),
      '',
      `Mở thiết kế: ${url}`,
    ].join('\n');
    const html = layout(
      approved ? 'Thiết kế đã được duyệt' : 'Thiết kế cần chỉnh sửa',
      `<p>Thiết kế <strong>${esc(title)}</strong> (phiên bản ${esc(payload.versionNo)}) ${approved ? 'đã được duyệt' : 'cần chỉnh sửa'}.</p><p>${esc(lead)}</p>${note ? `<p style="padding:12px 16px;background:#faf8f2;border-radius:10px">${esc(note)}</p>` : ''}<p><a href="${esc(url)}" style="display:inline-block;background:#a83b2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:99px">Mở thiết kế</a></p>`,
    );
    return {
      subject: `NONA — Thiết kế "${title}" ${approved ? 'đã được duyệt' : 'cần chỉnh sửa'}`,
      text,
      html,
    };
  }

  if (type === 'auth.password_reset') {
    const url = `${origin}${String(payload.resetPath)}`;
    const text = [
      `Xin chào ${payload.fullName},`,
      '',
      'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản NONA của bạn.',
      `Đặt lại mật khẩu (hiệu lực 1 giờ): ${url}`,
      '',
      'Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu của bạn vẫn an toàn.',
    ].join('\n');
    const html = layout(
      'Đặt lại mật khẩu',
      `<p>Xin chào ${esc(payload.fullName)},</p><p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản NONA của bạn. Liên kết có hiệu lực trong 1 giờ.</p><p><a href="${esc(url)}" style="display:inline-block;background:#a83b2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:99px">Đặt lại mật khẩu</a></p><p style="color:#6e756f;font-size:13px">Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu của bạn vẫn an toàn.</p>`,
    );
    return { subject: 'NONA — Đặt lại mật khẩu', text, html };
  }
  return null;
}
