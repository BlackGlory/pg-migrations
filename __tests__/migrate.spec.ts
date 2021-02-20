import { Client } from 'pg'
import { migrate, IMigration } from '@src/migrate'
import { ensureTestDatabase, connect, disconnect, getClient } from '@test/utils'

beforeAll(ensureTestDatabase)
beforeEach(connect)
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

describe('migrate(db: Database, migrations: Migration[], targetVersion: number): void', () => {
  describe('upgrade', () => {
    it('upgrade', async () => {
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
  })

  describe('downgrade', () => {
    it('downgrade', async () => {
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
})

async function getDatabaseVersion(client: Client): Promise<number> {
  const result = await client.query<{ version: number }>(`
    SELECT COALESCE(current_setting('migrations.schema_version', true), '0')::integer AS version;
  `)
  return result.rows[0].version
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

async function getDatabaseTables(client: Client): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema='public'
       AND table_type='BASE TABLE';
  `)
  return result.rows.map(x => x.table_name)
}
