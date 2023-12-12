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
, targetVersion = getMaximumVersion(migrations)
, migrationsTable: string = 'migrations'
, advisoryLockKey: bigint = BigInt('-9223372036854775808') // The smallest bigint for postgres
): Promise<void>
```

## FAQ
### Can multiple instances migrate in parallel?
Yes, it uses advisory lock to ensure that only one instance is migrating at a time.
When the maximum migration version is less than the database schema version (which means it is an obsolete instance), it will skip the migration.

### What if my migration requires more than one connection?
You can get all connection configurations through properties to create a new `pg.Client`.
It is important to note that the custom client you create is not part of the migration transaction.
