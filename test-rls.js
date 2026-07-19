const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...rest] = line.split('=');
  if (key) acc[key.trim()] = rest.join('=').trim().replace(/['"]/g, '');
  return acc;
}, {});

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

async function run() {
  const { data, error } = await supabase.from('broadcasts').select('*').limit(1);
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Success! RLS works.');
  }
}
run();
