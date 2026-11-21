import pg from 'pg';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await db.connect();
  const { rows } = await db.query(`SELECT current_database() AS database, current_user AS username,
    has_table_privilege(current_user, 'organizations', 'SELECT') AS can_read,
    has_table_privilege(current_user, 'quantity_ledger', 'TRUNCATE') AS can_truncate_ledger,
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create`);
  const info = rows[0];
  if (info.database !== 'agrimatch' || info.username !== 'agrimatch_app' || !info.can_read || info.can_truncate_ledger || info.can_create) {
    throw new Error('Runtime database permissions do not match the deployment contract.');
  }
  console.log(JSON.stringify({ check: 'database', ...info, passed: true }));
  const bedrock = new BedrockRuntimeClient({ region: 'ap-southeast-1', maxAttempts: 2 });
  try {
    const reply = await bedrock.send(new ConverseCommand({
      modelId: 'anthropic.claude-sonnet-5',
      messages: [{ role: 'user', content: [{ text: 'Reply READY only.' }] }],
      inferenceConfig: { maxTokens: 64 }, additionalModelRequestFields: { thinking: { type: 'disabled' } },
    }), { abortSignal: AbortSignal.timeout(30_000) });
    const text = reply.output?.message?.content?.map(block => block.text ?? '').join('').trim();
    if (text !== 'READY') throw new Error('Unexpected model verification reply.');
    console.log(JSON.stringify({ check: 'bedrock-task-role', passed: true }));
  } finally { bedrock.destroy(); }
  for (const [role, basicId] of [['FARMER', '@642ctpqm'], ['BALER', '@237ozbsh'], ['FACTORY', '@241sxehz']]) {
    const response = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${process.env[`LINE_${role}_ACCESS_TOKEN`]}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || (await response.json()).basicId !== basicId) throw new Error(`LINE ${role} verification failed.`);
    console.log(JSON.stringify({ check: 'line-token', role, passed: true }));
  }
} catch (error) {
  console.error(JSON.stringify({ check: 'hosted-runtime', passed: false, error: error.name, code: error.code ?? null }));
  process.exitCode = 1;
} finally { await db.end(); }
