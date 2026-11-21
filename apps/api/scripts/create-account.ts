// One-off: create a single Dashboard account (organization + OWNER user) chosen by the owner, for testing.
// Run as the restricted app role. The row is marked is_demo=true so it can be found and removed after testing.
//
// Inputs (environment):
//   OWNER_ACCOUNT_EMAIL     email to log in with
//   OWNER_ACCOUNT_PASSWORD  password (comes from Secrets Manager in the cloud; never printed)
//   OWNER_ACCOUNT_KIND      BUYER_FACTORY or BALER (default BUYER_FACTORY)
//   OWNER_ACCOUNT_ORG       organization name
//   OWNER_ACCOUNT_PROVINCE  province (Thai), optional
//   OWNER_ACCOUNT_LAT/LNG   province-level coordinates, optional
//   OWNER_ACCOUNT_ROLE      OWNER (default) or MEMBER (the limited judge account)
// Repeatable: if the email already exists nothing is changed (the existing password is kept).
import { pathToFileURL } from 'node:url';
import { createPool, users } from '../src/repos/index.js';
import { createDemoOrgUser } from '../src/services/auth/index.js';

const ROLES = ['OWNER', 'MEMBER'] as const;
const KINDS = ['BUYER_FACTORY', 'BALER'] as const;
type Kind = (typeof KINDS)[number];

export function readAccountInput(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV === 'production' && env.SEED_DEMO_CONFIRM !== 'yes') {
    throw new Error('Refusing with NODE_ENV=production. Set SEED_DEMO_CONFIRM=yes to confirm.');
  }
  const email = (env.OWNER_ACCOUNT_EMAIL ?? '').trim().toLowerCase();
  const password = env.OWNER_ACCOUNT_PASSWORD ?? '';
  const kind = (env.OWNER_ACCOUNT_KIND ?? 'BUYER_FACTORY') as Kind;
  const role = (env.OWNER_ACCOUNT_ROLE ?? 'OWNER') as (typeof ROLES)[number];
  const orgName = (env.OWNER_ACCOUNT_ORG ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('OWNER_ACCOUNT_EMAIL is missing or not an email.');
  if (password.length < 8) throw new Error('OWNER_ACCOUNT_PASSWORD is missing or shorter than 8 characters.');
  if (!KINDS.includes(kind)) throw new Error('OWNER_ACCOUNT_KIND must be BUYER_FACTORY or BALER.');
  if (!ROLES.includes(role)) throw new Error('OWNER_ACCOUNT_ROLE must be OWNER or MEMBER.');
  if (!orgName) throw new Error('OWNER_ACCOUNT_ORG is missing.');
  const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  return { email, password, kind, role, orgName, province: opt(env.OWNER_ACCOUNT_PROVINCE),
    lat: opt(env.OWNER_ACCOUNT_LAT), lng: opt(env.OWNER_ACCOUNT_LNG) };
}

async function main(): Promise<void> {
  const input = readAccountInput(process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const pool = createPool(url, { max: 2 });
  try {
    const existing = await users.getByEmail(pool, input.email);
    if (existing) {
      console.log(`account already exists: user=${existing.id} (nothing changed)`);
      return;
    }
    const { org, user } = await createDemoOrgUser(pool, {
      kind: input.kind, orgName: input.orgName, email: input.email, password: input.password,
      memberRole: input.role,
      ...(input.province ? { province: input.province } : {}),
      ...(input.lat && input.lng ? { lat: input.lat, lng: input.lng } : {}),
    });
    console.log(`account created: kind=${input.kind} role=${input.role} org=${org.id} user=${user.id}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : 'create account failed');
    process.exitCode = 1;
  });
}
