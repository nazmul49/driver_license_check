import { execFileSync } from 'node:child_process';
import { repoRoot, serverEnv } from './env';

/** Migrates and resets dlc_e2e, then creates the e2e integrators and their API keys. */
export default function globalSetup(): void {
  execFileSync('npx', ['tsx', 'server/scripts/e2e-setup.ts'], {
    cwd: repoRoot,
    env: { ...process.env, ...serverEnv },
    stdio: 'inherit',
  });
}
