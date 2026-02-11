import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { Client } from 'pg'
import { getErrorAsync } from 'return-style'
import { migrate, IMigration } from '@src/migrate.js'
import { createNewClient, resetDatabase, connect, disconnect, getClient } from '@test/utils.js'

beforeEach(async () => {
  await resetDatabase()
  await connect()
})
afterEach(disconnect)

const migrations: IMigration[] = [
  {
    version: 1
  , up: `
      CREATE TABLE test (
        id INTEGER PRIMARY KEY
      );
    `
  , down: `
      DROP TABLE test;
    `
  }
, {
    version: 2
  , async up(client) {
      await client.query(`
        ALTER TABLE test
          ADD COLUMN name TEXT;
      `)
    }
  , async down(client) {
      await client.query(`
        ALTER TABLE test
         DROP COLUMN name;
      `)
    }
  }
]

describe('migrate', () => {
  describe('The maxmium known migration version < database schema version', () => {
    test('throwOnNewerVersion = false', async () => {
      const client = getClient()
      await setDatabaseVersion(client, 999)

      await migrate(client, migrations, {
        targetVersion: 999
      , throwOnNewerVersion: false
      })

      const version = await getDatabaseVersion(client)
      expect(version).toBe(999)
    })

    test('throwOnNewerVersion = true', async () => {
      const client = getClient()
      await setDatabaseVersion(client, 999)

      const error = await getErrorAsync(() => migrate(client, migrations, {
        targetVersion: 999
      , throwOnNewerVersion: true
      }))

      expect(error).toBeInstanceOf(Error)
      const version = await getDatabaseVersion(client)
      expect(version).toBe(999)
    })
  })

  test('migrate in parallel', async () => {
    const client = getClient()
    const client1 = createNewClient()
    const client2 = createNewClient()
    client1.connect()
    client2.connect()

    try {
      const versionBefore = await getDatabaseVersion(client)
      await Promise.all([
        migrate(client1, migrations, { targetVersion: 2 })
      , migrate(client2, migrations, { targetVersion: 2 })
      ])
      const versionAfter = await getDatabaseVersion(client)

      expect(versionBefore).toBe(0)
      expect(versionAfter).toBe(2)
      const tables = await getDatabaseTables(client)
      expect(tables).toEqual(['test'])
      const schema = await getTableSchema(client, 'test')
      expect(schema).toMatchObject([
        {
          name: 'id'
        , type: 'integer'
        }
      , {
          name: 'name'
        , type: 'text'
        }
      ])
    } finally {
      await client1.end()
      await client2.end()
    }
  })

  test('upgrade', async () => {
    const client = getClient()

    const versionBefore = await getDatabaseVersion(client)
    await migrate(client, migrations, { targetVersion: 2 })
    const versionAfter = await getDatabaseVersion(client)

    expect(versionBefore).toBe(0)
    expect(versionAfter).toBe(2)
    const tables = await getDatabaseTables(client)
    expect(tables).toEqual(['test'])
    const schema = await getTableSchema(client, 'test')
    expect(schema).toMatchObject([
      {
        name: 'id'
      , type: 'integer'
      }
    , {
        name: 'name'
      , type: 'text'
      }
    ])
  })

  test('downgrade', async () => {
    const client = getClient()
    await migrate(client, migrations, { targetVersion: 2 })

    const versionBefore = await getDatabaseVersion(client)
    await migrate(client, migrations, { targetVersion: 0 })
    const versionAfter = await getDatabaseVersion(client)

    expect(versionBefore).toBe(2)
    expect(versionAfter).toBe(0)
    const tables = await getDatabaseTables(client)
    expect(tables).toEqual([])
  })

  test('edge: empty migrations', async () => {
    const client = getClient()

    const versionBefore = await getDatabaseVersion(client)
    await migrate(client, [])
    const versionAfter = await getDatabaseVersion(client)

    expect(versionBefore).toBe(0)
    expect(versionAfter).toBe(0)
  })
})

async function getDatabaseVersion(
  client: Client
, migrationTable = 'migrations'
): Promise<number> {
  try {
    const result = await client.query<{ schema_version: number }>(`
      SELECT schema_version
        FROM "${migrationTable}";
    `)
    return result.rows[0].schema_version
  } catch {
    return 0
  }
}

async function setDatabaseVersion(
  client: Client
, version: number
, migrationTable = 'migrations'
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${migrationTable}" (
      schema_version INTEGER NOT NULL
    );
  `)

  await client.query(`
    DELETE FROM "${migrationTable}";
  `)

  await client.query(`
    INSERT INTO "${migrationTable}" (schema_version)
    VALUES ($1);
  `, [version])
}

async function getTableSchema(
  client: Client
, tableName: string
): Promise<Array<{
  name: string
  type: string
}>> {
  const result = await client.query<{ column_name: string, data_type: string }>(`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_name = $1;
  `, [tableName])

  return result.rows.map(x => ({
    name: x.column_name
  , type: x.data_type
  }))
}

async function getDatabaseTables(
  client: Client
, excludes: string[] = ['migrations']
): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE';
  `)
  return result.rows
    .map(x => x.table_name)
    .filter(tableName => !excludes.includes(tableName))
}
