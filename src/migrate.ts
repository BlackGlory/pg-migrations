import type { Client } from 'pg'
import { assert, isFunction } from '@blackglory/prelude'
import { first, isntUndefined, isUndefined, max } from 'extra-utils'

export interface IMigration {
  version: number
  up: string | ((client: Client) => PromiseLike<void>)
  down: string | ((client: Client) => PromiseLike<void>)
}

interface IMigrateOptions {
  targetVersion?: number
  throwOnNewerVersion?: boolean

  migrationsTable?: string
  advisoryLockKey?: bigint
}

export async function migrate(
  client: Client
, migrations: IMigration[]
, {
    targetVersion = getMaximumVersion(migrations)
  , throwOnNewerVersion = false
  , migrationsTable = 'migrations'
  , advisoryLockKey = BigInt('-9223372036854775808') // The smallest bigint for postgres
  }: IMigrateOptions = {}
): Promise<void> {
  const maxVersion = getMaximumVersion(migrations)

  await lock(client, advisoryLockKey)
  try {
    await ensureMigrationsTable(client, migrationsTable)

    while (true) {
      const done = await transaction(client, async () => {
        const currentVersion = await getDatabaseVersion(client, migrationsTable)

        if (maxVersion < currentVersion) {
          if (throwOnNewerVersion) {
            throw new Error(`Database version ${currentVersion} is higher than the maximum known migration version.`)
          } else {
            return true
          }
        } else {
          if (currentVersion === targetVersion) {
            return true
          } else if (currentVersion < targetVersion) {
            await upgrade()
            return false
          } else {
            await downgrade()
            return false
          }
        }
      })

      if (done) break
    }
  } finally {
    await unlock(client, advisoryLockKey)
  }

  async function upgrade(): Promise<void> {
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
    } catch (e) {
      throw new Error(
        `Upgrade from version ${currentVersion} to version ${targetVersion} failed.`
      , { cause: e }
      )
    }
  }

  async function downgrade(): Promise<void> {
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
    } catch (e) {
      throw new Error(
        `Downgrade from version ${currentVersion} to version ${targetVersion} failed.`
      , { cause: e }
      )
    }
  }
}

function getMaximumVersion(migrations: IMigration[]): number {
  return migrations
    .map(x => x.version)
    .reduce(max, 0)
}

async function getDatabaseVersion(
  client: Client
, migrationTable: string
): Promise<number> {
  const version = await tryGetDatabaseVersion(client, migrationTable)
  assert(isntUndefined(version))

  return version
}

async function tryGetDatabaseVersion(
  client: Client
, migrationTable: string
): Promise<number | undefined> {
  const result = await client.query<{ schema_version: number }>(`
    SELECT schema_version
      FROM "${migrationTable}"
     LIMIT 1;
  `)

  return first(result.rows)?.schema_version
}

async function ensureMigrationsTable(
  client: Client
, migrationTable: string
): Promise<void> {
  await transaction(client, async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${migrationTable}" (
        schema_version INTEGER NOT NULL
      );
    `)

    if (isUndefined(await tryGetDatabaseVersion(client, migrationTable))) {
      await client.query(`
        INSERT INTO "${migrationTable}" (schema_version)
        VALUES (0);
      `)
    }
  })
}

async function setDatabaseVersion(
  client: Client
, migrationTable: string
, version: number
): Promise<void> {
  await client.query(`
    UPDATE "${migrationTable}"
       SET schema_version = $1;
  `, [version])
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

const inTransactionClients = new WeakSet<Client>()
async function transaction<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  if (inTransactionClients.has(client)) {
    throw new Error('PostgreSQL does not support nested transactions.')
  } else {
    inTransactionClients.add(client)
  }

  try {
    await client.query('BEGIN')

    try {
      const result = await fn()

      await client.query('COMMIT')

      return result
    } catch (e) {
      await client.query('ROLLBACK')

      throw e
    }
  } finally {
    inTransactionClients.delete(client)
  }
}
