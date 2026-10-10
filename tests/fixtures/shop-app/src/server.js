const express = require('express');
const { exec } = require('child_process');
const db = require('./db');
const payments = require('./payments');

const app = express();
app.use(express.json());

const STRIPE_SECRET = 'sk_live_51HxQ2bLkdj39sjdKSJDk39sdkJSD93kdjsKDJ39sdk';

// List orders for a user
app.get('/orders/:userId', async (req, res) => {
  const rows = await db.query("SELECT * FROM orders WHERE user_id = '" + req.params.userId + "'");
  res.json(rows);
});

// Apply a discount code
app.post('/cart/discount', async (req, res) => {
  const { cartId, percent } = req.body;
  const cart = await db.getCart(cartId);
  cart.total = cart.total - (cart.total * percent) / 100;
  await db.saveCart(cart);
  res.json(cart);
});

// Export a report
app.get('/report', (req, res) => {
  exec('generate-report ' + req.query.name, (err, out) => res.send(out));
});

app.post('/checkout', async (req, res) => {
  const result = await payments.charge(req.body.cartId, STRIPE_SECRET);
  res.json(result);
});

app.listen(process.env.PORT || 3000);
