import {Db, MongoClient} from 'mongodb';
import {env} from '../config/env';

const uri = env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is not configured');
}

const client = new MongoClient(uri);

let db: Db | null = null;

export async function connectMongoDB(): Promise<Db> {
  if (db) {
    return db;
  }

  await client.connect();

  db = client.db();

  return db;
}
