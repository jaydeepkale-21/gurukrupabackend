const fetch = require('node-fetch');

async function test() {
    const loginUrl = 'http://localhost:3002/auth/login';
    const productsUrl = 'http://localhost:3002/products/active';

    try {
        console.log('Logging in...');
        const loginRes = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'franchise@gurupra.com', password: '123456' })
        });
        const loginData = await loginRes.json();
        const token = loginData.user.token;
        console.log('Login success, token obtained.');

        console.log('Fetching active products...');
        const prodRes = await fetch(productsUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const prods = await prodRes.json();
        console.log('Products found:', prods.length);
        console.log(JSON.stringify(prods, null, 2));

    } catch (e) {
        console.error('Test Error:', e);
    }
}

test();
