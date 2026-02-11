import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { Client } from 'pg'
import { migrate, IMigration } from '@src/migrate'
import { createNewClient, resetDatabase, connect, disconnect, getClient } from '@test/utils'

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
  test('migrate in parallel', async () => {
    const client = getClient()
    const client1 = createNewClient()
    const client2 = createNewClient()
    client1.connect()
    client2.connect()

    try {
      const versionBefore = await getDatabaseVersion(client)
      await Promise.all([
        migrate(client1, migrations, 2)
      , migrate(client2, migrations, 2)
      ])
      const versionAfter = await getDatabaseVersion(client)
      const tables = await getDatabaseTables(client)
      const schema = await getTableSchema(client, 'test')

      expect(versionBefore).toBe(0)
      expect(versionAfter).toBe(2)
      expect(tables).toEqual(['test'])
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
    await migrate(client, migrations, 2)
    const versionAfter = await getDatabaseVersion(client)
    const tables = await getDatabaseTables(client)
    const schema = await getTableSchema(client, 'test')

    expect(versionBefore).toBe(0)
    expect(versionAfter).toBe(2)
    expect(tables).toEqual(['test'])
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
    await migrate(client, migrations, 2)

    const versionBefore = await getDatabaseVersion(client)
    await migrate(client, migrations, 0)
    const versionAfter = await getDatabaseVersion(client)
    const tables = await getDatabaseTables(client)

    expect(versionBefore).toBe(2)
    expect(versionAfter).toBe(0)
    expect(tables).toEqual([])
  })
})

async function getDatabaseVersion(client: Client, migrationTable = 'migrations'): Promise<number> {
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

async function getTableSchema(client: Client, tableName: string): Promise<Array<{ name: string, type: string }>> {
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

async function getDatabaseTables(client: Client, excludes: string[] = ['migrations']): Promise<string[]> {
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
