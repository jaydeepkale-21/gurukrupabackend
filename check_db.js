const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function check() {
    console.log('--- USERS ---');
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach(doc => {
        console.log(doc.id, '=>', doc.data());
    });

    console.log('\n--- PRODUCTS ---');
    const productsSnap = await db.collection('products').get();
    if (productsSnap.empty) {
        console.log('No products found!');
    } else {
        productsSnap.forEach(doc => {
            console.log(doc.id, '=>', doc.data());
        });
    }
}

check().catch(console.error);
