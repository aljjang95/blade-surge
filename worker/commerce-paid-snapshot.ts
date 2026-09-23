/**
 * A read-only screen for the immutable fields of a disabled web order.
 * Callers must obtain the payment independently from PortOne and the binding
 * from Blade's approved account. A match is never permission to grant goods.
 */
export type PaidSnapshotAssessment = {
  frozenFieldsMatch: boolean;
  reason: string;
  grantReady: false;
};

const inicisProviders = new Set(['HTML5_INICIS', 'INICIS', 'INICIS_UNIFIED', 'INICIS_V2']);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function reject(reason: string): PaidSnapshotAssessment {
  return { frozenFieldsMatch: false, reason, grantReady: false };
}

export function assessPortOnePaidSnapshot(
  storedOrder: unknown,
  providerPayment: unknown,
  approvedAccountBinding: unknown,
): PaidSnapshotAssessment {
  const order = object(storedOrder);
  const payment = object(providerPayment);
  const approved = object(approvedAccountBinding);
  if (!order || !payment || !approved) return reject('missing-input');

  if (order.state !== 'PREPARED' || order.sales_channel !== 'WEB'
    || !nonblank(order.order_id) || !nonblank(order.player_id)
    || !nonblank(order.catalog_version) || !nonblank(order.sku)
    || !nonblank(order.payment_id) || !nonblank(order.store_id)
    || !nonblank(order.channel_key) || order.currency !== 'KRW'
    || !Number.isSafeInteger(order.amount_krw) || (order.amount_krw as number) <= 0) return reject('order-snapshot');
  if (!nonblank(order.merchant_id)) return reject('merchant-unbound');

  if (!nonblank(approved.storeId) || !nonblank(approved.merchantId)
    || !nonblank(approved.channelKey) || !nonblank(approved.pgMerchantId)
    || (approved.channelType !== 'TEST' && approved.channelType !== 'LIVE')
    || !inicisProviders.has(approved.pgProvider as string)) return reject('account-binding');
  if (order.store_id !== approved.storeId || order.merchant_id !== approved.merchantId
    || order.channel_key !== approved.channelKey) return reject('order-account-mismatch');

  const channel = object(payment.channel);
  const amount = object(payment.amount);
  if (payment.status !== 'PAID' || payment.version !== 'V2') return reject('payment-state');
  if (payment.id !== order.payment_id || payment.merchantId !== order.merchant_id
    || payment.storeId !== order.store_id || payment.currency !== 'KRW') return reject('payment-identity');
  // The V2 channel key is optional in the provider schema. Its absence is not
  // evidence that another channel ID or PG merchant may be substituted.
  if (!channel || !nonblank(channel.key) || channel.key !== order.channel_key
    || channel.type !== approved.channelType || channel.pgProvider !== approved.pgProvider
    || channel.pgMerchantId !== approved.pgMerchantId) return reject('payment-channel');

  // Blade has not approved discounted checkout. Reject any discount/cancellation
  // and any integer outside JavaScript's exact representation before comparing.
  if (!amount || !Number.isSafeInteger(amount.total) || !Number.isSafeInteger(amount.paid)
    || !Number.isSafeInteger(amount.discount) || !Number.isSafeInteger(amount.cancelled)
    || amount.total !== order.amount_krw || amount.paid !== order.amount_krw
    || amount.discount !== 0 || amount.cancelled !== 0) return reject('payment-amount');

  return { frozenFieldsMatch: true, reason: 'frozen-fields-only', grantReady: false };
}
