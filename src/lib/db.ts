import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
// In a real app, this should throw an error if connectionString is missing,
// but for development flexibility, we just let it fail at query time.
export const sql = postgres(connectionString || 'postgres://placeholder', {
  idle_timeout: 20,
  max_lifetime: 60 * 30,
})
