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

let serviceAccount;
try {
  // Try local file first
  serviceAccount = require('./serviceAccountKey.json');
} catch (e) {
  // If file missing, look for Environment Variable (for Render)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (parseError) {
      console.error('Error parsing FIREBASE_SERVICE_ACCOUNT env var:', parseError);
    }
  }
}

if (!serviceAccount) {
  console.error('CRITICAL: serviceAccountKey.json not found and FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
  process.exit(1);
}

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
  try {
    console.log('Fetching all products from Firestore...');
    const snapshot = await productsRef.get();
    if (snapshot.empty) {
      console.log('NOTICE: No products found in Firestore "products" collection.');
      return [];
    }
    const products = snapshot.docs.map(d => {
      const data = d.data();
      // Ensure id exists and is a number if possible
      return { docId: d.id, ...data, id: Number(data.id) || 0 };
    });
    console.log(`Success: Fetched ${products.length} products.`);
    return products.sort((a, b) => a.id - b.id);
  } catch (e) {
    console.error('CRITICAL ERROR in getAllProducts:', e);
    return []; // Return empty array instead of throwing to prevent 500
  }
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
        franchiseId: user.franchiseId, // Standard camelCase
        franchise_id: user.franchiseId, // Maintain underscore for compatibility
        token: token,
        agreementEndDate: user.agreementEndDate && user.agreementEndDate.toDate ? user.agreementEndDate.toDate().toISOString() : user.agreementEndDate
      }
    });
  } catch (e) {
    console.error('Login Error:', e);
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
      franchises.push({
        id: doc.id,
        ...data,
        agreementEndDate: data.agreementEndDate && data.agreementEndDate.toDate ? data.agreementEndDate.toDate().toISOString() : data.agreementEndDate
      });
    });
    res.json(franchises);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Products list (All)
app.get('/products', authenticateToken, async (req, res) => {
  try {
    const products = await getAllProducts();
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3a. Active Products (for Franchise)
app.get('/products/active', authenticateToken, async (req, res) => {
  try {
    console.log(`Fetching active products for user: ${req.user.email}`);
    const products = await getAllProducts();
    // Return products that are NOT explicitly inactive
    const activeProducts = products.filter(p => p.isActive !== false);
    console.log(`Returning ${activeProducts.length} active products.`);
    res.json(activeProducts);
  } catch (e) {
    console.error('Error in /products/active:', e);
    res.status(500).json({ error: e.message });
  }
});

// 3b. Franchise Agreement Status
app.get('/franchise/agreement', authenticateToken, async (req, res) => {
  if (req.user.role !== 'franchise_owner') return res.sendStatus(403);
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Handle Firestore Timestamp or Date object
    const toDate = (ts) => ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);

    const start = toDate(user.agreementStartDate);
    const end = toDate(user.agreementEndDate);
    const now = new Date();

    const status = (!end || end < now) ? 'Expired' : 'Active';

    res.json({
      startDate: start ? start.toISOString() : null,
      endDate: end ? end.toISOString() : null,
      status: status
    });
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
      updates.basePrice = Number(price);
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
      const added = Number(addStock);
      // ATOMIC INCREMENT
      updates.currentStock = admin.firestore.FieldValue.increment(added);

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
        quantity: added,
        performedBy: `Manager (${req.user.email})`,
        reference: 'Manual Stock In'
      });
    }

    // Apply updates
    await productsRef.doc(product.docId).update(updates);

    // Return the updated product state
    const finalProductSnap = await productsRef.doc(product.docId).get();
    const finalData = finalProductSnap.data();
    res.json({
      success: true,
      product: { docId: product.docId, ...finalData, id: finalData.id },
      currentStock: finalData.currentStock || 0
    });
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
      // Cannot use orderBy with where without a composite index. Sorting in memory instead.
      snapshot = await ordersRef.where('franchiseId', '==', query.franchiseId).get();
    } else {
      snapshot = await ordersRef.orderBy('id', 'desc').get();
    }
    const orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));

    // Sort in memory (descending by id)
    orders.sort((a, b) => b.id - a.id);

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
      const toDate = (ts) => ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      const endDate = toDate(user.agreementEndDate);
      if (!endDate || endDate < new Date()) {
        return res.status(403).json({ message: 'Agreement Expired. Cannot place order.' });
      }
    }
    const { items } = req.body; // items: { productId: qty, ... }
    if (!items || Object.keys(items).length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item.' });
    }

    let totalAmount = 0;
    let itemsCount = 0;
    const itemNames = [];
    const lineItems = [];

    for (const [productId, qty] of Object.entries(items)) {
      if (qty <= 0) continue;
      const prodSnap = await productsRef.where('id', '==', Number(productId)).limit(1).get();
      if (!prodSnap.empty) {
        const prod = prodSnap.docs[0].data();
        const lineTotal = prod.basePrice * qty;
        totalAmount += lineTotal;
        itemsCount++;
        itemNames.push(`${prod.name} x${qty}`);

        // Lock Price Logic
        lineItems.push({
          productId: prod.id,
          name: prod.name,
          unit: prod.unit,
          quantity: Number(qty),
          unitPrice: prod.basePrice, // LOCKED HERE
          totalPrice: lineTotal
        });
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
      items, // Keep for backward compatibility if needed
      lineItems, // New robust structure
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
      // 1. Agreement Check
      if (order.franchiseId) {

        const franchiseSnap = await usersRef.where('franchiseId', '==', order.franchiseId).limit(1).get();
        if (!franchiseSnap.empty) {
          const fUser = franchiseSnap.docs[0].data();
          const toDate = (ts) => ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
          const endDate = toDate(fUser.agreementEndDate);
          if (!endDate || endDate < new Date()) {
            return res.status(403).json({ message: 'Franchise Agreement Expired. Cannot Dispatch.' });
          }
        }
      }

      // 2. Stock check and ledger updates
      if (order.items) {
        for (const [pid, qty] of Object.entries(order.items)) {
          // Use product.currentStock as the source of truth
          const prodSnap = await productsRef.where('id', '==', Number(pid)).limit(1).get();
          if (prodSnap.empty) {
            return res.status(400).json({ message: `Product ID ${pid} not found` });
          }
          const prodData = prodSnap.docs[0].data();
          const available = prodData.currentStock || 0; // Fallback to 0 if undefined

          if (available < qty) {
            return res.status(400).json({ message: `Insufficient stock for ${prodData.name}. Available: ${available}, Required: ${qty}` });
          }
        }

        // Create OUT ledger entries and update product stock
        for (const [pid, qty] of Object.entries(order.items)) {
          const prodSnap = await productsRef.where('id', '==', Number(pid)).limit(1).get();
          const prodDoc = prodSnap.docs[0];
          const prodData = prodDoc.data();

          const ledgerSnap = await ledgerRef.orderBy('id', 'desc').limit(1).get();
          const lastLedger = ledgerSnap.empty ? null : ledgerSnap.docs[0].data();
          const nextLedgerId = lastLedger ? lastLedger.id + 1 : 1;

          await ledgerRef.add({
            id: nextLedgerId,
            date: new Date().toISOString().substring(0, 16),
            productId: Number(pid),
            productName: prodData.name,
            type: 'OUT',
            quantity: Number(qty),
            performedBy: `System (Order #${order.id})`,
            reference: `Dispatch Order #${order.id}`
          });

          // Update Stock: ATOMIC DECREMENT
          await prodDoc.ref.update({
            currentStock: admin.firestore.FieldValue.increment(-Number(qty))
          });
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

// 10. Upload Challan (Mock/Flag)
app.put('/orders/:id/challan', authenticateToken, async (req, res) => {
  if (req.user.role !== 'warehouse_manager') return res.sendStatus(403);
  const { id } = req.params;
  try {
    const snap = await ordersRef.where('id', '==', Number(id)).limit(1).get();
    if (snap.empty) return res.status(404).json({ message: 'Order not found' });
    const orderDoc = snap.docs[0];
    const order = orderDoc.data();

    if (order.challanUploaded) {
      return res.status(400).json({ message: 'Challan already uploaded. Documents are immutable.' });
    }

    // In a real app, we would store the file URL here. 
    // For this master-data/logic flow, we assume the file is "uploaded" and we lock the record.
    await orderDoc.ref.update({
      challanUploaded: true,
      challanDate: new Date().toISOString()
    });

    res.json({ success: true, message: 'Challan marked as uploaded' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
