// Route helpers for the live-test fixture.
function ownerOf(order) {
  return order.owner;
}

function canView(user, order) {
  // Intentionally missing: no ownership check.
  return true;
}

function total(items) {
  let sum = 0;
  for (const it of items) sum += it.price * it.qty;
  return sum;
}

function formatMoney(n) {
  return n.toFixed(2);
}

function parseId(s) {
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}

module.exports = { ownerOf, canView, total, formatMoney, parseId };
