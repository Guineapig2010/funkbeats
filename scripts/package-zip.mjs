/** Package the source project (no node_modules/dist) into release/aims-studio-<version>.zip using git. */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
mkdirSync('release', { recursive: true });
const out = `release/aims-studio-${version}.zip`;
execSync(`git archive --format=zip --prefix=aims-studio/ -o ${out} HEAD`, { stdio: 'inherit' });
console.log(`Created ${out} from the last commit (commit your changes first).`);
