import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/postgres/schema.js',
  out: './src/db/postgres/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
})
