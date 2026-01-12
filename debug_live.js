async function verify() {
    const loginUrl = 'https://gurukrupabackend-3h94.onrender.com/auth/login';

    try {
        console.log(`Connecting to ${loginUrl}...`);
        // Testing with Franchise account since that has an agreementEndDate
        const loginRes = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'franchise@gurupra.com', password: '123456' })
        });

        if (!loginRes.ok) {
            console.error('Login Failed:', loginRes.status, await loginRes.text());
            return;
        }

        const loginData = await loginRes.json();
        console.log('Login Success!');
        console.log('User Data:', JSON.stringify(loginData.user, null, 2));

        const endDate = loginData.user.agreementEndDate;
        console.log('agreementEndDate Value:', endDate);
        console.log('agreementEndDate Type:', typeof endDate);

        if (typeof endDate === 'object' && endDate !== null) {
            console.log('FAIL: It is still an Object (Map). Render has NOT updated yet.');
        } else if (typeof endDate === 'string') {
            console.log('PASS: It is a String (ISO). Render updated successfully.');
        }

    } catch (e) {
        console.error('Debug Error:', e);
    }
}

verify();
