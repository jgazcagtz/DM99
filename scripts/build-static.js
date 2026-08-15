import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const outputDirectory = join(projectRoot, 'public');
const staticFiles = ['index.html', 'script.js', 'styles.css', 'manifest.webmanifest', 'service-worker.js'];
const staticDirectories = ['src', 'icons'];

const sourceModules = (await readdir(join(projectRoot, 'src')))
  .filter(fileName => fileName.endsWith('.js'))
  .map(fileName => join('src', fileName));
const syntaxFiles = [
  'script.js',
  'service-worker.js',
  'api/generate-pattern.js',
  'scripts/dev-server.js',
  ...sourceModules,
];
for (const fileName of syntaxFiles) {
  execFileSync(process.execPath, ['--check', join(projectRoot, fileName)], { stdio: 'pipe' });
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await Promise.all(staticFiles.map(fileName => (
  copyFile(join(projectRoot, fileName), join(outputDirectory, fileName))
)));
await Promise.all(staticDirectories.map(directoryName => (
  cp(join(projectRoot, directoryName), join(outputDirectory, directoryName), { recursive: true })
)));

console.log(`Checked ${syntaxFiles.length} scripts and prepared ${staticFiles.length} files plus ${staticDirectories.length} directories in ${outputDirectory}`);
