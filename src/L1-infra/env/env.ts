import dotenv from 'dotenv'

/** Load environment variables from a .env file. */
export function loadEnvFile(envPath?: string): void {
  dotenv.config(envPath ? { path: envPath } : undefined)
}
