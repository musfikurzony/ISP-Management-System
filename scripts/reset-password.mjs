// Emergency password reset, for when you are locked out of the application
// (for example, the only administrator forgot the password).
//
// Run from the project folder in CMD:
//   npx wrangler login              (only once; opens the browser to sign in to Cloudflare)
//   npm run reset-password          (live database)
//   npm run reset-password -- --local   (practice database on this computer)
//
// It asks for the username and a new password, then updates the database directly.
// The account is also unlocked, re-activated and signed out everywhere.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
import { hashPassword } from '../server/auth.js';

const DB = 'isp_billing_db';
const where = process.argv.includes('--local') ? '--local' : '--remote';

function wrangler(args) {
  const res = spawnSync('npx', ['wrangler', 'd1', 'execute', DB, where, ...args], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { ok: res.status === 0, stdout: res.stdout || '', out: (res.stdout || '') + (res.stderr || '') };
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '*'.repeat(s.length ? 1 : 0));
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

console.log(`\nPassword reset for the ${where === '--local' ? 'PRACTICE (local)' : 'LIVE (online)'} database.\n`);

// Show the existing accounts so a forgotten username can be found too.
const list = wrangler(['--json', '--command', 'SELECT username, full_name, role, is_active FROM users ORDER BY id']);
if (!list.ok) {
  console.log(list.out);
  console.log('Could not read the database. If you have not signed in yet, run:  npx wrangler login');
  process.exit(1);
}
let users = [];
try {
  users = JSON.parse(list.stdout.slice(list.stdout.indexOf('[')))[0].results;
} catch {
  console.log(list.out);
  process.exit(1);
}
if (!users.length) {
  console.log('There are no users yet. Open the website: it will ask you to create the first administrator.');
  process.exit(0);
}
console.log('Accounts:');
for (const u of users) console.log(`  ${u.username.padEnd(20)} ${u.role.padEnd(9)} ${u.is_active ? 'active  ' : 'INACTIVE'}  ${u.full_name}`);
console.log('');

const username = (await ask('Username to reset: ')).toLowerCase();
const user = users.find((u) => u.username.toLowerCase() === username);
if (!user) {
  console.log('No account with that username.');
  process.exit(1);
}
const password = await ask('New password (at least 8 characters): ', true);
if (password.length < 8 || password.length > 128) {
  console.log('The password must be 8 to 128 characters.');
  process.exit(1);
}
if ((await ask('Type the new password again: ', true)) !== password) {
  console.log('The two passwords do not match. Nothing was changed.');
  process.exit(1);
}

const hash = await hashPassword(password);
// Username was matched against the database list and hash contains only base64 characters,
// so both are safe inside the SQL text.
const sql = `
UPDATE users SET password_hash = '${hash}', failed_attempts = 0, locked_until = NULL, is_active = 1, updated_at = datetime('now')
 WHERE username = '${user.username.replace(/'/g, "''")}';
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '${user.username.replace(/'/g, "''")}');
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
 SELECT NULL, 'user.password_reset_cli', 'user', id, '{"via":"reset-password script"}' FROM users WHERE username = '${user.username.replace(/'/g, "''")}';
`;
const dir = mkdtempSync(join(tmpdir(), 'isp-reset-'));
const file = join(dir, 'reset.sql');
writeFileSync(file, sql);
const res = wrangler([`--file=${file}`, '--yes']);
rmSync(dir, { recursive: true, force: true });
if (!res.ok) {
  console.log(res.out);
  console.log('The reset failed. Nothing was changed.');
  process.exit(1);
}
console.log(`\nDone. "${user.username}" can now log in with the new password.`);
if (user.role !== 'admin') console.log('Note: this account is a Billing Operator, not an Administrator.');
