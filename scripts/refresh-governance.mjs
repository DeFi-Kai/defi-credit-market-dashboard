import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function run(command, args, allowedCodes = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (allowedCodes.includes(code)) {
        resolve(code);
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}.`));
      }
    });
  });
}

await run(process.execPath, ['scripts/fetch-governance.mjs']);
await run(process.execPath, ['scripts/summarize-governance.mjs']);
await run('git', ['add', '--', 'data/governance.json']);

const hasChanges = await run('git', ['diff', '--cached', '--quiet', '--', 'data/governance.json'], [0, 1]);
if (hasChanges === 0) {
  console.log('Governance data is unchanged; nothing to push.');
  process.exit(0);
}

await run('git', ['commit', '--only', 'data/governance.json', '-m', 'chore: refresh governance data']);
await run('git', ['push']);
