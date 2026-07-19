const TARGET_URL = 'http://localhost:3000/login'; // Testing the login page which usually does SSR or static rendering
const CONCURRENT_USERS = 200;

async function runWebLoadTest() {
  console.log(`--- Starting Web Frontend Load Test ---`);
  console.log(`Simulating ${CONCURRENT_USERS} concurrent requests to ${TARGET_URL}`);
  
  const start = Date.now();
  const promises = [];

  for (let i = 0; i < CONCURRENT_USERS; i++) {
    const reqStart = Date.now();
    promises.push(
      fetch(TARGET_URL, {
        headers: {
          'User-Agent': 'LoadTest/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml',
        }
      })
      .then(async (res) => {
        // We need to consume the body to complete the request
        await res.text();
        return {
          success: res.ok,
          status: res.status,
          duration: Date.now() - reqStart
        };
      })
      .catch((err) => {
        return {
          success: false,
          status: err.message || 'error',
          duration: Date.now() - reqStart
        };
      })
    );
  }

  const results = await Promise.all(promises);
  const totalDuration = Date.now() - start;

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  const durations = successful.map(r => r.duration);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
  const minDuration = durations.length > 0 ? Math.min(...durations) : 0;

  console.log('\n--- Web Load Test Results ---');
  console.log(`Total Requests: ${CONCURRENT_USERS}`);
  console.log(`Successful (200 OK): ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  
  if (failed.length > 0) {
    console.log('\nSample errors:');
    failed.slice(0, 5).forEach(f => console.log(`- Status: ${f.status}, Time: ${f.duration}ms`));
  }

  console.log(`\nTotal Execution Time: ${totalDuration}ms`);
  console.log(`Average Response Time: ${avgDuration.toFixed(2)}ms`);
  console.log(`Min Response Time: ${minDuration}ms`);
  console.log(`Max Response Time: ${maxDuration}ms`);

  if (failed.length === 0) {
    console.log('\n✅ Web server handled 200 concurrent requests successfully!');
  } else {
    console.log(`\n⚠️ Web server struggled, ${failed.length} requests failed.`);
  }
}

runWebLoadTest().catch(console.error);
