async function verify() {
    const loginUrl = 'https://gurukrupabackend-3h94.onrender.com/auth/login';
    const productsUrl = 'https://gurukrupabackend-3h94.onrender.com/products';

    try {
        console.log(`Connecting to ${loginUrl}...`);
        const loginRes = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'manager@gurupra.com', password: '123456' })
        });

        if (!loginRes.ok) {
            console.error('Login Failed:', loginRes.status, await loginRes.text());
            return;
        }

        const loginData = await loginRes.json();
        console.log('Login Success! Token received.');

        console.log(`Fetching products from ${productsUrl}...`);
        const productRes = await fetch(productsUrl, {
            headers: { 'Authorization': `Bearer ${loginData.user.token}` }
        });

        if (!productRes.ok) {
            console.error('Product Fetch Failed:', productRes.status, await productRes.text());
            return;
        }

        const products = await productRes.json();
        console.log(`SUCCESS: Retrieved ${products.length} products from Live Database.`);
        products.forEach(p => console.log(` - ${p.name} (Stock: ${p.currentStock})`));

    } catch (e) {
        console.error('Verification Error:', e);
    }
}

verify();
