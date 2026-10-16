// Load .env* files with the same precedence as `next dev`.
// Imported first by scripts so env vars are set before lib/config is evaluated.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
