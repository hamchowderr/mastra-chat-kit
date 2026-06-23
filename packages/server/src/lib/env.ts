import { z } from 'zod';

const boolish = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 chars'),

    // Supabase client vars are optional — only needed if you wire up the
    // Supabase auth/RLS client. Plain Postgres (the compose `postgres` service)
    // only needs SUPABASE_DB_URL below.
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SUPABASE_DB_URL: z
      .string()
      .url()
      .refine((v) => v.startsWith('postgres'), 'Must be a postgres:// connection string'),

    // Dolt (versioned business data) — the compose `dolt` service. Optional so
    // the app boots without Dolt; the Dolt tools error clearly if it's missing.
    DOLT_HOST: z.string().optional(),
    DOLT_PORT: z.coerce.number().int().optional(),
    DOLT_USER: z.string().optional(),
    DOLT_PASSWORD: z.string().optional(),
    DOLT_DATABASE: z.string().optional(),

    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

    // The model the chat agent uses (Single Agent + Agent Harness both wrap it).
    // `provider/model` form, resolved by Mastra's model router. Override to run a
    // real cheap model, e.g. CHAT_MODEL=openai/gpt-4.1-nano.
    CHAT_MODEL: z.string().default('anthropic/claude-sonnet-4-6'),

    USE_AIMOCK: boolish.default(false),
    AIMOCK_URL: z.string().url().default('http://localhost:4010'),

    E2E_BASE_URL: z.string().url().optional(),

    MASTRA_TELEMETRY_DISABLED: z.string().optional(),
    MASTRA_CLOUD_ACCESS_TOKEN: z.string().optional(),

    // Shared HMAC secret for JWT auth (@mastra/auth). When set, the server
    // gates all /api/* routes AND Studio behind a Bearer JWT signed with this
    // secret. Leave unset for open local dev. Must be HS256-safe (>=32 chars).
    MASTRA_JWT_SECRET: z.string().min(32, 'MASTRA_JWT_SECRET must be at least 32 chars').optional(),
  })
  .refine(
    (e) => Boolean(e.ANTHROPIC_API_KEY || e.OPENAI_API_KEY || e.GOOGLE_GENERATIVE_AI_API_KEY),
    {
      message:
        'At least one LLM provider key required (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY)',
    },
  );

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n');
  for (const [key, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${(errors as string[]).join(', ')}`);
  }
  for (const err of parsed.error.flatten().formErrors) {
    console.error(`  ${err}`);
  }
  console.error('\nSee .env.example for the full list of required variables.');
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;
