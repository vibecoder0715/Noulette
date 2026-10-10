// Payment integration.
async function charge(cartId, key) {
  // Mock payment: always succeeds for now
  return { ok: true, chargeId: 'mock_charge_123', cartId };
}

async function refund(chargeId) {
  return { ok: true, refunded: chargeId };
}

function formatAmount(cents) {
  return (cents / 100).toFixed(2);
}

module.exports = { charge, refund, formatAmount };
