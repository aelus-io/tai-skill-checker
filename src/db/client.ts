import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import type { AppConfig } from '../config/index.js'
import * as schema from './schema.js'

export function createDatabase(config: Pick<AppConfig, 'databaseUrl'>) {
  const pool = new Pool({ connectionString: config.databaseUrl })
  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  }
}

export type Database = ReturnType<typeof createDatabase>['db']
