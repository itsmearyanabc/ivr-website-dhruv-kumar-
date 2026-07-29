const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function wipeCustomers() {
  console.log("Fetching users from Supabase Auth...");
  
  // Get all users
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  
  if (listError) {
    console.error("Error fetching users:", listError);
    return;
  }
  
  console.log(`Found ${users.length} users. Deleting...`);
  
  let deleted = 0;
  for (const user of users) {
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error(`Failed to delete user ${user.id}:`, deleteError);
    } else {
      deleted++;
    }
  }
  
  console.log(`Successfully deleted ${deleted} users. The database is now fresh.`);
}

wipeCustomers();
