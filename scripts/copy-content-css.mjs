import { cpSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const src = 'src/entrypoints/content/style.css';
const dest = '.output/chrome-mv3/content-scripts/content.css';

const destDir = dirname(dest);
if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}

cpSync(src, dest);
console.log('Copied content.css to output');
