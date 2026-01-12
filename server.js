const express = require('express');
const cors = require('cors');
// const mongoose = require('mongoose'); // Removed MongoDB
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '.env') });

if (!process.env.JWT_SECRET) {
  console.error('Error: JWT_SECRET is not defined in .env file');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

// Initialize Firebase Admin SDK
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Helper functions for Firestore operations
const usersRef = db.collection('users');
const productsRef = db.collection('products');
const ordersRef = db.collection('orders');
const ledgerRef = db.collection('ledger');

async function getUserByEmail(email) {
  const snapshot = await usersRef.where('email', '==', email).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function getUserById(id) {
  const doc = await usersRef.doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function getProductById(id) {
  const snapshot = await productsRef.where('id', '==', Number(id)).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { docId: doc.id, ...doc.data() };
}

async function getAllProducts() {
  const snapshot = await productsRef.orderBy('id').get();
  return snapshot.docs.map(d => ({ docId: d.id, ...d.data() }));
}

async function getDerivedStock(productId) {
  const snapshot = await ledgerRef.where('productId', '==', Number(productId)).get();
  let stock = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.type === 'IN') stock += data.quantity;
    if (data.type === 'OUT') stock -= data.quantity;
  });
  return stock;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user; // { id, role, email }
    next();
  });
};

// Routes
// 1. Login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  console.log(`Login attempt: email=${email}`);
  try {
    const user = await getUserByEmail(email);
    if (!user) {
      console.log(`Login failed: User not found for email ${email}`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log(`Login failed: Invalid password for user ${email}`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    console.log(`Login success: user=${email}, role=${user.role}`);
    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.email ? user.email.split('@')[0] : 'user',
        role: user.role,
        franchise_id: user.franchiseId,
        token: token,
        agreementEndDate: user.agreementEndDate
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 2. Get Franchises (warehouse manager only)
app.get('/franchises', authenticateToken, async (req, res) => {
  if (req.user.role !== 'warehouse_manager') return res.sendStatus(403);
  try {
    const snapshot = await usersRef.where('role', '==', 'franchise_owner').get();
    const franchises = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      delete data.password; // remove sensitive info
      franchises.push({ id: doc.id, ...data });
    });
    res.json(franchises);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Products list
app.get('/products', authenticateToken, async (req, res) => {
  try {
    const products = await getAllProducts();
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Update product (price, stock, thresholds)
app.post('/products/:id/update', authenticateToken, async (req, res) => {
  if (req.user.role !== 'warehouse_manager') return res.sendStatus(403);
  const { id } = req.params;
  const { price, addStock, minLevel, criticalLevel } = req.body;
  try {
    const product = await getProductById(id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const updates = {};
    if (minLevel !== undefined) updates.minLevel = Number(minLevel);
    if (criticalLevel !== undefined) updates.criticalLevel = Number(criticalLevel);
    if (price !== undefined) {
      const oldPrice = product.basePrice;
      updates.basePrice = price;
      // Log price update in ledger
      const ledgerSnap = await ledgerRef.orderBy('id', 'desc').limit(1).get();
      const lastLedger = ledgerSnap.empty ? null : ledgerSnap.docs[0].data();
      const nextId = lastLedger ? lastLedger.id + 1 : 1;
      await ledgerRef.add({
        id: nextId,
        date: new Date().toISOString().substring(0, 16),
        productId: product.id,
        productName: product.name,
        type: 'PRICE_UPDATE',
        quantity: 0,
        performedBy: `Manager (${req.user.email})`,
        reference: `Price updated: ₹${oldPrice} -> ₹${price}`
      });
    }
    if (addStock !== undefined) {
      // Add stock ledger entry
      const ledgerSnap = await ledgerRef.orderBy('id', 'desc').limit(1).get();
      const lastLedger = ledgerSnap.empty ? null : ledgerSnap.docs[0].data();
      const nextId = lastLedger ? lastLedger.id + 1 : 1;
      await ledgerRef.add({
        id: nextId,
        date: new Date().toISOString().substring(0, 16),
        productId: product.id,
        productName: product.name,
        type: 'IN',
        quantity: Number(addStock),
        performedBy: `Manager (${req.user.email})`,
        reference: 'Manual Stock In'
      });
    }
    // Apply updates
    await productsRef.doc(product.docId).update(updates);
    // Recalculate current stock if needed
    const updatedProductSnap = await productsRef.doc(product.docId).get();
    const updatedProduct = updatedProductSnap.data();
    const currentStock = await getDerivedStock(updatedProduct.id);
    await productsRef.doc(product.docId).update({ currentStock });
    const finalProductSnap = await productsRef.doc(product.docId).get();
    res.json({ success: true, product: { docId: product.docId, ...finalProductSnap.data() }, currentStock });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Ledger history
app.get('/ledger', authenticateToken, async (req, res) => {
  try {
    const snapshot = await ledgerRef.orderBy('id', 'desc').limit(50).get();
    const ledger = [];
    snapshot.forEach(doc => ledger.push({ id: doc.id, ...doc.data() }));
    res.json(ledger);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 6. Create new product
app.post('/products', authenticateToken, async (req, res) => {
  if (req.user.role !== 'warehouse_manager') return res.sendStatus(403);
  const { name, unit, basePrice } = req.body;
  if (!name || !unit || !basePrice) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  try {
    // Check for duplicate (case-insensitive)
    const dupSnap = await productsRef.where('name', '==', name.trim()).get();
    if (!dupSnap.empty) {
      return res.status(400).json({ success: false, message: `Product with name "${name}" already exists.` });
    }
    // Determine next id
    const idSnap = await productsRef.orderBy('id', 'desc').limit(1).get();
    const nextId = idSnap.empty ? 1 : (idSnap.docs[0].data().id + 1);
    const newProduct = {
      id: nextId,
      name: name.trim(),
      unit,
      basePrice,
      currentStock: 0,
      minLevel: 100,
      criticalLevel: 50
    };
    const docRef = await productsRef.add(newProduct);
    // Ledger entry for creation
    const ledgerSnap = await ledgerRef.orderBy('id', 'desc').limit(1).get();
    const lastLedger = ledgerSnap.empty ? null : ledgerSnap.docs[0].data();
    const ledgerId = lastLedger ? lastLedger.id + 1 : 1;
    await ledgerRef.add({
      id: ledgerId,
      date: new Date().toISOString().substring(0, 16),
      productId: nextId,
      productName: name.trim(),
      type: 'CREATE',
      quantity: 0,
      performedBy: `Manager (${req.user.email})`,
      reference: 'Initial Creation'
    });
    res.json({ success: true, product: { docId: docRef.id, ...newProduct } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 7. Get orders
app.get('/orders', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'franchise_owner') {
      const user = await getUserById(req.user.id);
      if (user && user.franchiseId) {
        query = { franchiseId: user.franchiseId };
      }
    }
    let snapshot;
    if (Object.keys(query).length) {
      snapshot = await ordersRef.where('franchiseId', '==', query.franchiseId).orderBy('id', 'desc').get();
    } else {
      snapshot = await ordersRef.orderBy('id', 'desc').get();
    }
    const orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8. Create order
app.post('/orders', authenticateToken, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'franchise_owner') {
      if (!user.agreementEndDate || new Date(user.agreementEndDate) < new Date()) {
        return res.status(403).json({ message: 'Agreement Expired. Cannot place order.' });
      }
    }
    const { items } = req.body;
    if (!items || Object.keys(items).length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item.' });
    }
    let totalAmount = 0;
    let itemsCount = 0;
    const itemNames = [];
    for (const [productId, qty] of Object.entries(items)) {
      const prodSnap = await productsRef.where('id', '==', Number(productId)).limit(1).get();
      if (!prodSnap.empty) {
        const prod = prodSnap.docs[0].data();
        totalAmount += prod.basePrice * qty;
        itemsCount++;
        itemNames.push(prod.name);
      }
    }
    let itemsSummary = itemNames.join(', ');
    if (itemsSummary.length > 35) itemsSummary = itemsSummary.substring(0, 32) + '...';
    const lastSnap = await ordersRef.orderBy('id', 'desc').limit(1).get();
    const nextId = lastSnap.empty ? 1001 : (lastSnap.docs[0].data().id + 1);
    const newOrder = {
      id: nextId,
      date: new Date().toISOString().substring(0, 16),
      status: 'Pending',
      totalAmount,
      itemsCount,
      itemsSummary,
      items,
      franchiseId: user.franchiseId,
      outletName: user.outletName || 'Franchise Outlet'
    };
    await ordersRef.add(newOrder);
    res.json({ success: true, order: newOrder });
  } catch (e) {
    console.error('Order Creation Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 9. Update order status
app.put('/orders/:id/status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  console.log(`Status update request: OrderID=${id}, NewStatus=${status}, User=${req.user.email}`);
  try {
    const snap = await ordersRef.where('id', '==', Number(id)).limit(1).get();
    if (snap.empty) {
      console.log(`Order NOT FOUND: ID=${id}`);
      return res.status(404).json({ message: 'Order not found' });
    }
    const orderDoc = snap.docs[0];
    const order = orderDoc.data();
    console.log(`Current order status: ${order.status}`);
    if (status === 'Delivered') {
      console.log('Delivering order...');
      await orderDoc.ref.update({ status: 'Delivered' });
      return res.json({ success: true, order: { ...order, status: 'Delivered' } });
    }
    if (order.status === 'Delivered' || order.status === 'Cancelled') {
      console.log(`Update BLOCKED: Order is already ${order.status}`);
      return res.status(403).json({ message: `Order is already ${order.status} and cannot be modified.` });
    }
    if (status === 'Approved') {
      await orderDoc.ref.update({ status: 'Approved' });
    } else if (status === 'Dispatched') {
      // Stock check and ledger updates
      if (order.items) {
        for (const [pid, qty] of Object.entries(order.items)) {
          const available = await getDerivedStock(pid);
          if (available < qty) {
            const prodSnap = await productsRef.where('id', '==', Number(pid)).limit(1).get();
            const prodName = prodSnap.empty ? `ID ${pid}` : prodSnap.docs[0].data().name;
            return res.status(400).json({ message: `Insufficient stock for ${prodName}` });
          }
        }
        // Create OUT ledger entries and update product stock
        for (const [pid, qty] of Object.entries(order.items)) {
          const prodSnap = await productsRef.where('id', '==', Number(pid)).limit(1).get();
          const prod = prodSnap.docs[0];
          const ledgerSnap = await ledgerRef.orderBy('id', 'desc').limit(1).get();
          const lastLedger = ledgerSnap.empty ? null : ledgerSnap.docs[0].data();
          const nextLedgerId = lastLedger ? lastLedger.id + 1 : 1;
          await ledgerRef.add({
            id: nextLedgerId,
            date: new Date().toISOString().substring(0, 16),
            productId: Number(pid),
            productName: prod.data().name,
            type: 'OUT',
            quantity: Number(qty),
            performedBy: `System (Order #${order.id})`,
            reference: `Dispatch Order #${order.id}`
          });
          const newStock = await getDerivedStock(pid);
          await prod.ref.update({ currentStock: newStock });
        }
      }
      await orderDoc.ref.update({ status: 'Dispatched' });
    } else if (status === 'Cancelled') {
      if (order.status === 'Pending' || order.status === 'Approved') {
        await orderDoc.ref.update({ status: 'Cancelled' });
      } else {
        return res.status(400).json({ message: 'Cannot cancel an order after dispatch.' });
      }
    }
    const updatedSnap = await orderDoc.ref.get();
    res.json({ success: true, order: updatedSnap.data() });
  } catch (e) {
    console.error('Status Update Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
