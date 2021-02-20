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
): Promise<void> {
  let currentVersion: number
  while ((currentVersion = await getDatabaseVersion(client)) !== targetVersion) {
    if (currentVersion < targetVersion) {
      await upgrade()
    } else {
      await downgrade()
    }
  }

  async function upgrade() {
    const currentVersion = await getDatabaseVersion(client)
    const targetVersion = currentVersion + 1

    const migration = migrations.find(x => x.version === targetVersion)
    assert(migration, `Cannot find migration for version ${targetVersion}`)

    try {
      if (isFunction(migration.up)) {
        await migration.up(client)
      } else {
        await client.query(migration.up)
      }
    } catch (e) {
      console.error(`Upgrade from version ${currentVersion} to version ${targetVersion} failed.`)
      throw e
    }
    await setDatabaseVersion(client, targetVersion)
  }

  async function downgrade() {
    const currentVersion = await getDatabaseVersion(client)
    const targetVersion = currentVersion - 1

    const migration = migrations.find(x => x.version === currentVersion)
    assert(migration, `Cannot find migration for version ${targetVersion}`)

    try {
      if (isFunction(migration.down)) {
        await migration.down(client)
      } else {
        await client.query(migration.down)
      }
    } catch (e) {
      console.error(`Downgrade from version ${currentVersion} to version ${targetVersion} failed.`)
      throw e
    }
    await setDatabaseVersion(client, targetVersion)
  }
}

function getMaximumVersion(migrations: IMigration[]): number {
  return migrations.reduce((max, cur) => Math.max(cur.version, max), 0)
}

async function getDatabaseVersion(client: Client): Promise<number> {
  const result = await client.query<{ version: number }>(`
    SELECT COALESCE(current_setting('migrations.schema_version', true), '0')::integer AS version;
  `)
  return result.rows[0].version
}

async function setDatabaseVersion(client: Client, version: number): Promise<void> {
  const database = await getCurrentDatabase(client)

  await client.query(`
    SET migrations.schema_version to ${version};

    ALTER DATABASE "${database}"
      SET migrations.schema_version
     FROM current;
  `)
}

async function getCurrentDatabase(client: Client): Promise<string> {
  const result = await client.query<{ database: string }>(`
    SELECT current_database() AS database;
  `)
  return result.rows[0].database
}
