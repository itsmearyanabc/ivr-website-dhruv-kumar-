const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...rest] = line.split('=');
  if (key) acc[key.trim()] = rest.join('=').trim().replace(/['"]/g, '');
  return acc;
}, {});

const { createServerClient } = require('@supabase/ssr');

async function run() {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  
  // We don't have a real token here easily unless we sign in.
  const anonClient = createServerClient(supabaseUrl, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: () => {} }
  });
  
  const { data: signInData } = await anonClient.auth.signInWithPassword({
    email: 'admin@xpack.in',
    password: env.ADMIN_PASSWORD || 'admin123'
  });
  
  if (!signInData.session) {
    console.log('Failed to sign in', signInData);
    return;
  }
  
  const cookiesArr = [
    { name: 'sb-access-token', value: signInData.session.access_token },
    { name: 'sb-refresh-token', value: signInData.session.refresh_token }
  ];
  
  const adminClient = createServerClient(supabaseUrl, serviceKey, {
    cookies: { 
      getAll: () => cookiesArr, 
      setAll: () => {} 
    }
  });
  
  const { data, error } = await adminClient.auth.getUser();
  console.log('User with admin client + cookies:', data?.user?.id, 'Error:', error?.message);
}
run();
