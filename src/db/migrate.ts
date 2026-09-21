import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'
import { loadConfig } from '../config/index.js'

const config = loadConfig()
await migrate(drizzle(neon(config.databaseUrl)), { migrationsFolder: './drizzle' })
console.log('Database migrations completed')
