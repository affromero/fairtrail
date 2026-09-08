import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const toolchain = JSON.parse(await readFile(new URL('./prisma-cli/package.json', import.meta.url), 'utf8'));
for (const name of ['prisma', '@prisma/client']) {
  assert.equal(require(`${name}/package.json`).version, toolchain.dependencies.prisma,
    `Keep the Docker Prisma toolchain aligned with ${name}`);
}
console.log('Prisma CLI, client and Docker toolchain versions match');
