import type { Client } from 'pg'
import { isFunction } from '@blackglory/types'
import { assert } from '@blackglory/errors'

export interface IMigration {
  version: number
  up: string | ((client: Client) => PromiseLike<void>)
  down: string | ((client: Client) => PromiseLike<void>)
}

export async function migrate(
  client: Client
, migrations: IMigration[]
, targetVersion = getMaximumVersion(migrations)
, migrationsTable: string = 'migrations'
, advisoryLockKey: bigint = BigInt('-9223372036854775808') // The smallest bigint for postgres
): Promise<void> {
  const maxVersion = getMaximumVersion(migrations)
  await lock(client, advisoryLockKey)
  try {
    while (true) {
      const currentVersion = await getDatabaseVersion(client, migrationsTable)
      if (maxVersion < currentVersion) {
        break
      } else {
        if (currentVersion === targetVersion) {
          break
        } else if (currentVersion < targetVersion) {
          await upgrade()
        } else {
          await downgrade()
        }
      }
    }
  } finally {
    await unlock(client, advisoryLockKey)
  }

  async function upgrade(): Promise<void> {
    await client.query('BEGIN')
    const currentVersion: number = await getDatabaseVersion(client, migrationsTable)
    const targetVersion = currentVersion + 1
    try {
      const migration = migrations.find(x => x.version === targetVersion)
      assert(migration, `Cannot find migration for version ${targetVersion}`)

      if (isFunction(migration.up)) {
        await migration.up(client)
      } else {
        await client.query(migration.up)
      }
      await setDatabaseVersion(client, migrationsTable, targetVersion)
      await client.query('COMMIT')
    } catch (e) {
      console.error(`Upgrade from version ${currentVersion} to version ${targetVersion} failed.`)
      await client.query('ROLLBACK')
      throw e
    }
  }

  async function downgrade(): Promise<void> {
    await client.query('BEGIN')
    const currentVersion = await getDatabaseVersion(client, migrationsTable)
    const targetVersion = currentVersion - 1
    try {
      const migration = migrations.find(x => x.version === currentVersion)
      assert(migration, `Cannot find migration for version ${targetVersion}`)

      if (isFunction(migration.down)) {
        await migration.down(client)
      } else {
        await client.query(migration.down)
      }
      await setDatabaseVersion(client, migrationsTable, targetVersion)
      await client.query('COMMIT')
    } catch (e) {
      console.error(`Downgrade from version ${currentVersion} to version ${targetVersion} failed.`)
      await client.query('ROLLBACK')
      throw e
    }
  }
}

function getMaximumVersion(migrations: IMigration[]): number {
  return migrations.reduce((max, cur) => Math.max(cur.version, max), 0)
}

async function getDatabaseVersion(client: Client, migrationTable: string): Promise<number> {
  await ensureMigrationsTable(client, migrationTable)

  const result = await client.query<{ schema_version: number }>(`
    SELECT schema_version
      FROM "${migrationTable}";
  `)
  if (result.rows.length) {
    return result.rows[0].schema_version
  } else {
    await client.query(`
      INSERT INTO "${migrationTable}" (schema_version)
      VALUES (0);
    `)
    return 0
  }
}

async function ensureMigrationsTable(client: Client, migrationTable: string): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${migrationTable}" (
      schema_version INTEGER NOT NULL
    );
  `)
}

async function setDatabaseVersion(
  client: Client
, migrationTable: string
, version: number
): Promise<void> {
  await client.query(`
    UPDATE ${migrationTable}
       SET schema_version = ${version};
  `)
}

async function lock(client: Client, key: bigint): Promise<void> {
  await client.query(`
    SELECT pg_advisory_lock(${key});
  `)
}

async function unlock(client: Client, key: bigint): Promise<void> {
  await client.query(`
    SELECT pg_advisory_unlock(${key});
  `)
}
