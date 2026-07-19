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
    for (const u of data.users) {
      if (u.email === 'admin@xpack.in') continue;
      console.log('Deleting user:', u.email);
      await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
        method: 'DELETE',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      });
    }
    console.log('Finished removing mock users.');
  } else {
    console.log(data);
  }
}
run();
