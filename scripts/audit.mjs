// Dependency audit gate (SPEC 12): fails on any high or critical advisory in production
// dependencies, except the reviewed exceptions below. Every exception needs a reason and an
// expiry date; an expired exception fails the build so it gets reviewed again.
import { execFileSync } from 'node:child_process';

const EXCEPTIONS = {
  'GHSA-vfj7-8cjw-p6xm': {
    package: 'braces',
    reason:
      'Reached only via awilix -> fast-glob, used by awilix.loadModules(). This codebase never ' +
      'calls loadModules (all registrations are explicit in server/src/container.ts), so no ' +
      'attacker-controlled glob reaches braces. No patched braces release exists yet.',
    expires: '2027-01-31',
  },
};

let raw;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });
} catch (err) {
  raw = err.stdout; // npm audit exits non-zero when it finds anything
}
const report = JSON.parse(raw);
const today = new Date().toISOString().slice(0, 10);
const failures = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via === 'string' || !['high', 'critical'].includes(via.severity)) continue;
    const id = via.url?.split('/').pop();
    const exception = EXCEPTIONS[id];
    if (exception && exception.expires >= today) {
      console.log(`allowed until ${exception.expires}: ${id} in ${name} (${exception.reason})`);
      continue;
    }
    failures.push(
      `${via.severity}: ${id} in ${name} ${exception ? '(exception expired)' : ''} ${via.url}`,
    );
  }
}
if (failures.length) {
  console.error(`Dependency audit failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('Dependency audit passed.');
