const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let key = match[1];
      let value = match[2] ? match[2].trim() : '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
  try {
    const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260803000000_add_password_and_stats.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Applying migration: 20260803000000_add_password_and_stats.sql');
    
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      console.error('Migration failed:', error);
      
      // Try alternative approach - execute statements one by one
      console.log('\nTrying alternative approach...');
      const statements = sql.split(';').filter(s => s.trim());
      
      for (const statement of statements) {
        if (statement.trim()) {
          const { error: stmtError } = await supabase.rpc('exec_sql', { sql_query: statement + ';' });
          if (stmtError) {
            console.error('Statement failed:', statement.substring(0, 100) + '...');
            console.error('Error:', stmtError);
          }
        }
      }
    } else {
      console.log('✓ Migration applied successfully!');
    }
    
    // Verify tables exist
    const { data: tables, error: tablesError } = await supabase
      .from('daily_statistics')
      .select('count')
      .limit(1);
    
    if (!tablesError) {
      console.log('✓ daily_statistics table is accessible');
    }
    
    const { data: logs, error: logsError } = await supabase
      .from('activity_logs')
      .select('count')
      .limit(1);
    
    if (!logsError) {
      console.log('✓ activity_logs table is accessible');
    }
    
  } catch (err) {
    console.error('Error:', err);
  }
}

applyMigration();
