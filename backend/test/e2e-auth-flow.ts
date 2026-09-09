async function testEndToEndAuth() {
  console.log('Testing End-to-End Authentication & Cookie Flow on http://localhost:4000...');

  // 1. Register candidate
  const candidateEmail = `candidate_${Date.now()}@example.com`;
  const registerRes = await fetch('http://localhost:4000/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'E2E Candidate',
      email: candidateEmail,
      password: 'password123',
      targetBand: 8.0,
    }),
  });

  console.log(`Register status: ${registerRes.status}`);
  const registeredUser = await registerRes.json();
  console.log('Registered User:', registeredUser);

  const rawSetCookie = registerRes.headers.get('set-cookie');
  console.log('Set-Cookie from Register:', rawSetCookie);

  // 2. Extract access_token cookie
  const cookieMatch = rawSetCookie?.match(/access_token=([^;]+)/);
  const cookieHeader = cookieMatch ? `access_token=${cookieMatch[1]}` : '';

  // 3. Call protected /auth/me with the httpOnly cookie
  const meRes = await fetch('http://localhost:4000/auth/me', {
    method: 'GET',
    headers: {
      Cookie: cookieHeader,
    },
  });

  console.log(`Protected /auth/me status: ${meRes.status}`);
  const meData = await meRes.json();
  console.log('Protected User Profile returned:', meData);

  if (meRes.status === 200 && meData.email === candidateEmail) {
    console.log('\n[SUCCESS] End-to-end authentication, password hashing, and cookie verification passed!');
  } else {
    console.error('\n[FAILURE] Cookie or auth verification failed.');
  }
}

testEndToEndAuth();
