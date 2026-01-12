async function verify() {
    const loginUrl = 'https://gurukrupabackend-3h94.onrender.com/auth/login';

    try {
        console.log(`Testing MANAGER Login...`);
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
        console.log('Login Success!');
        console.log('User Data:', JSON.stringify(loginData.user, null, 2));

        // Check types
        console.log('Type of id:', typeof loginData.user.id);
        console.log('Type of username:', typeof loginData.user.username);
        console.log('Type of role:', typeof loginData.user.role);
        console.log('Type of token:', typeof loginData.user.token);
        console.log('Type of franchise_id:', typeof loginData.user.franchise_id);
        console.log('Type of agreementEndDate:', typeof loginData.user.agreementEndDate);

    } catch (e) {
        console.error('Debug Error:', e);
    }
}

verify();
