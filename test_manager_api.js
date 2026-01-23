const fetch = require('node-fetch');

async function test() {
    const loginUrl = 'http://localhost:3002/auth/login';
    const productsUrl = 'http://localhost:3002/products';

    try {
        console.log('Logging in as manager...');
        const loginRes = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'manager@gurupra.com', password: '123456' })
        });
        const loginData = await loginRes.json();
        const token = loginData.user.token;
        console.log('Login success.');

        console.log('Fetching all products...');
        const prodRes = await fetch(productsUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const prods = await prodRes.json();
        console.log('Products found:', prods.length);

    } catch (e) {
        console.error('Test Error:', e);
    }
}

test();
