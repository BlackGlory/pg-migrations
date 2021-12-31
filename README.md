# pg-migrations
A utility for database migrations with [pg].

The module using [customized options] `migrations.schema_version` to record the schema version.

[pg]: https://www.npmjs.com/package/pg
[customized options]: https://www.postgresql.org/docs/current/runtime-config-custom.html

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

### migrate
```ts
function migrate(
  client: Client
, migrations: IMigration[]
, targetVersion?: number
): Promise<void>
```

If targetVersion is `undefined`, then use the maximum version of migrations.

## FAQ
### What if my migration requires more than 1 connection?
Although only one `pg.Client` is provided,
you can get all connection configurations through properties to create a new `pg.Client`.
