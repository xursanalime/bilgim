const API_URL = 'http://localhost:4000';
const STUDENT_COUNT = 50;
const ROOM_NAME = '23c020a6-cd6b-4568-b99a-26d9511db628';

// Simple JWT generation since we just need valid tokens for testing
// In a real load test we might just generate these directly if we know the secret
const crypto = require('crypto');

async function runLoadTest() {
  console.log(`--- Starting Load Test Simulation for ${STUDENT_COUNT} students ---`);
  
  // 1. Direct DB Login Bypass
  console.log('Logging in students via direct API calls (bypassing WAF/Rate Limits by fetching from API slowly)...');
  
  const students = [];
  for (let i = 1; i <= STUDENT_COUNT; i++) {
    students.push({
      email: `student${i}@test.com`,
      password: 'Student123!',
    });
  }

  const tokens = [];
  // We hit the CREDENTIAL_STUFFING_DISTINCT_EMAILS_PER_HOUR limit.
  // Instead of logging in, let's just create an admin token or fetch directly.
  // Actually, let's just log in via API but slowly. Wait, the block is 1 hour.
  // We must bypass it by changing WAF_ALLOWLIST in .env for this test.
  
  console.log('NOTE: To run this test for >20 users, you MUST add 127.0.0.1 to WAF_ALLOWLIST in .env');
  console.log('Example: WAF_ALLOWLIST="127.0.0.1,::1"');
  console.log('Please update .env and restart the API server first.');
  console.log('Proceeding anyway, expect failures if WAF is not updated...');

  for (const s of students) {
      try {
        const res = await fetch(`${API_URL}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(s),
        });
        const data = await res.json();
        if (!res.ok) {
           console.error(`Login failed for ${s.email} with status ${res.status}:`, data.error?.code);
           tokens.push(null);
        } else {
           tokens.push(data.accessToken);
        }
      } catch (err) {
        console.error(`Failed to login ${s.email}`, err);
        tokens.push(null);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
  }

  const validTokens = tokens.filter(t => !!t);
  console.log(`✓ Logged in ${validTokens.length}/${STUDENT_COUNT} students`);

  // 2. Simulate concurrent "Enter Room" requests
  console.log(`Simulating ${validTokens.length} students entering room concurrently...`);
  
  const start = Date.now();
  const results = await Promise.allSettled(
    validTokens.map(async (token, index) => {
      const studentStart = Date.now();
      const res = await fetch(`${API_URL}/api/v1/live-stream/token`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ roomName: ROOM_NAME }),
      });
      const duration = Date.now() - studentStart;
      if (!res.ok) {
        const errText = await res.text();
        console.error(`Token fetch failed: ${res.status}`, errText);
      }
      return { index: index + 1, duration, success: res.status === 201 || res.status === 200 };
    })
  );
  const totalDuration = Date.now() - start;

  // 3. Analyze results
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.length - successful;
  const durations = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value.duration);
  
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const maxDuration = Math.max(...durations);
  const minDuration = Math.min(...durations);

  console.log('\n--- Load Test Results ---');
  console.log(`Total Concurrent Requests: ${validTokens.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total Time: ${totalDuration}ms`);
  console.log(`Average Response Time: ${avgDuration.toFixed(2)}ms`);
  console.log(`Min Response Time: ${minDuration}ms`);
  console.log(`Max Response Time: ${maxDuration}ms`);
  
  if (failed === 0 && successful === STUDENT_COUNT) {
    console.log('\n✅ System handled 20 concurrent join requests successfully!');
  } else {
    console.log('\n❌ Some requests failed or not all students logged in.');
  }
}

runLoadTest().catch(console.error);
