// Product catalog helpers.
const products = [
  { id: 1, name: 'Candle', price: 1200, stock: 10 },
  { id: 2, name: 'Soap', price: 500, stock: 25 },
  { id: 3, name: 'Mug', price: 1800, stock: 5 }
];

function list() {
  return products.map((p) => ({ ...p }));
}

function find(id) {
  return products.find((p) => p.id === Number(id)) || null;
}

function inStock(id, qty) {
  const p = find(id);
  return !!p && p.stock >= qty;
}

function reserve(id, qty) {
  const p = find(id);
  if (!p || p.stock < qty) {
    throw new Error('Not enough stock');
  }
  p.stock -= qty;
  return p.stock;
}

function release(id, qty) {
  const p = find(id);
  if (p) {
    p.stock += qty;
  }
}

function search(term) {
  const t = String(term || '').toLowerCase();
  return products.filter((p) => p.name.toLowerCase().includes(t));
}

function priceOf(items) {
  let total = 0;
  for (const it of items) {
    const p = find(it.id);
    if (!p) continue;
    total += p.price * it.qty;
  }
  return total;
}

function sortBy(field) {
  return list().sort((a, b) => (a[field] > b[field] ? 1 : -1));
}

function lowStock(limit) {
  const n = Number(limit) || 3;
  return list().filter((p) => p.stock <= n);
}

function restock(id, qty) {
  const p = find(id);
  if (!p) return null;
  p.stock += Math.max(0, Number(qty) || 0);
  return p.stock;
}

module.exports = { list, find, inStock, reserve, release, search, priceOf, sortBy, lowStock, restock };
