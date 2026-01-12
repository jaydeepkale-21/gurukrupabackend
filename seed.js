const admin = require('firebase-admin');
const bcrypt = require('bcryptjs'); // Import bcrypt
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function seed() {
    const hashedPassword = await bcrypt.hash('123456', 10); // Hash '123456'

    // Users
    const usersRef = db.collection('users');
    await usersRef.doc('manager').set({
        email: 'manager@gurupra.com',
        password: hashedPassword,
        role: 'warehouse_manager',
        franchiseId: null,
        outletName: null,
        agreementStartDate: null,
        agreementEndDate: null
    });
    await usersRef.doc('franchise1').set({
        email: 'franchise@gurupra.com',
        password: hashedPassword,
        role: 'franchise_owner',
        franchiseId: 101,
        outletName: 'Mumbai Central',
        agreementStartDate: admin.firestore.Timestamp.fromDate(new Date()),
        agreementEndDate: admin.firestore.Timestamp.fromDate(new Date(new Date().setFullYear(new Date().getFullYear() + 1)))
    });

    // Products
    const productsRef = db.collection('products');
    const sampleProducts = [
        { id: 1, name: 'Tea Powder (Gold)', unit: 'kg', basePrice: 450.0, currentStock: 120, minLevel: 100, criticalLevel: 50 },
        { id: 2, name: 'Sugar', unit: 'kg', basePrice: 42.0, currentStock: 180, minLevel: 100, criticalLevel: 50 },
        { id: 3, name: 'Paper Cups (100ml)', unit: 'pkt 100pc', basePrice: 65.0, currentStock: 500, minLevel: 100, criticalLevel: 50 },
        { id: 4, name: 'Cardamom (Elaichi)', unit: 'g', basePrice: 3.5, currentStock: 800, minLevel: 100, criticalLevel: 50 },
        { id: 5, name: 'Ginger', unit: 'kg', basePrice: 120.0, currentStock: 40, minLevel: 100, criticalLevel: 50 }
    ];
    for (const p of sampleProducts) {
        await productsRef.doc(`product_${p.id}`).set(p);
    }

    console.log('Seeding completed');
}

seed().then(() => process.exit()).catch(err => { console.error(err); process.exit(1); });
