import * as dotenv from 'dotenv';

dotenv.config();

export const env = {
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || 'Wedding',
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
};
