import { Client } from 'pg'

let client: Client

export function getClient(): Client {
  return client
}

export function createNewClient(): Client {
  return new Client({
    host: 'postgres'
  , database: 'test'
  , user: 'postgres'
  , password: 'password'
  })
}

export async function connect(): Promise<void> {
  client = createNewClient()

  await client.connect()
}

export async function disconnect(): Promise<void> {
  await client.end()
}

export async function resetDatabase(): Promise<void> {
  const client = new Client({
    host: 'postgres'
  , database: 'postgres'
  , user: 'postgres'
  , password: 'password'
  })

  await client.connect()
  await client.query('DROP DATABASE IF EXISTS test;')
  await client.query('CREATE DATABASE test;')
  await client.end()
}
