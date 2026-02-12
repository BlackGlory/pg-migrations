# pg-migrations
A utility for database migrations with [pg].

The module create a simple migrations table to record the schema version.

[pg]: https://www.npmjs.com/package/pg

## Install
```sh
npm install --save @blackglory/pg-migrations
# or
yarn add @blackglory/pg-migrations
```

## API
```ts
interface IMigration {
  // An integer starting from 1
  version: number

  up: string | ((client: Client) => PromiseLike<void>)
  down: string | ((client: Client) => PromiseLike<void>)
}
```

You may need [migration-files].

[migration-files]: https://github.com/BlackGlory/migration-files

### migrate
```ts
function migrate(
  client: Client
, migrations: IMigration[]
, options?: {
    targetVersion?: number
    throwOnNewerVersion?: boolean = false

    migrationsTable?: string = 'migrations'
    advisoryLockKey?: bigint = BigInt('-9223372036854775808') // The smallest bigint for postgres
  }
): Promise<void>
```

If `options.targetVersion` is `undefined`,
the maximum version of the `migrations` is used.

When the maximum known migration version is less than the database schema version,
it means the current instance is outdated.
- When `options.throwOnNewerVersion` is `false` (default),
  it will skip the migration,
  so your outdated instance continues to run.
- When `options.throwOnNewerVersion` is `true`,
  it will throw an error,
  so your outdated instance fails immediately.

#### Can multiple instances migrate in parallel?
Yes, it uses advisory lock to ensure that only one instance is migrating at a time.

#### What if my migration requires more than one connection?
You can get all connection configurations through properties to create a new `pg.Client`.
It is important to note that the custom client you create is not part of the migration transaction.
