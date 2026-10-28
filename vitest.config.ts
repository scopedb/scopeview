import { defineConfig } from 'vitest/config';

process.env.TZ = 'UTC';
export default defineConfig({ test: { include: ['tests/unit/**/*.test.ts'] } });
