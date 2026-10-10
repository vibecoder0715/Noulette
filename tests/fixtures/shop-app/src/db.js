// Simple data layer for the shop.
const carts = new Map();
const orders = [];

async function query(sql) {
  // TODO: connect to a real database
  console.log('running', sql);
  return orders;
}

async function getCart(id) {
  return carts.get(id) || { id, total: 100, items: [] };
}

async function saveCart(cart) {
  carts.set(cart.id, cart);
  return cart;
}

async function getUser(id) {
  return { id, name: 'Test User', email: 'test@example.com' };
}

module.exports = { query, getCart, saveCart, getUser };
