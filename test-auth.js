const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...rest] = line.split('=');
  if (key) acc[key.trim()] = rest.join('=').trim().replace(/['"]/g, '');
  return acc;
}, {});

async function run() {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const data = await res.json();
  if (data.users) {
    const users = data.users.slice(0, 3);
    users.forEach(u => {
      console.log(`User: ${u.email}, confirmed_at: ${u.email_confirmed_at}`);
    });
  } else {
    console.log(data);
  }
}
run();
