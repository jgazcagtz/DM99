import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const outputDirectory = join(projectRoot, 'public');
const staticFiles = ['index.html', 'script.js', 'styles.css'];

await mkdir(outputDirectory, { recursive: true });
await Promise.all(staticFiles.map(fileName => (
  copyFile(join(projectRoot, fileName), join(outputDirectory, fileName))
)));

console.log(`Prepared ${staticFiles.length} static files in ${outputDirectory}`);
