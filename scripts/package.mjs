import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

const outputDir = join(process.cwd(), '.output');
const zipName = 'carrybee-v2.zip';
const zipPath = join(process.cwd(), zipName);

// Clean old zip
if (existsSync(zipPath)) {
  rmSync(zipPath);
}

// Create zip
try {
  execSync(
    `powershell -Command "Compress-Archive -Path '${join(outputDir, 'chrome-mv3')}' -DestinationPath '${zipPath}'"`,
    { stdio: 'inherit' }
  );
  console.log(`✅ Created ${zipName}`);
} catch {
  // Fallback: try tar
  try {
    execSync(
      `tar -a -cf "${zipPath}" -C "${outputDir}" chrome-mv3`,
      { stdio: 'inherit' }
    );
    console.log(`✅ Created ${zipName}`);
  } catch {
    console.error('❌ Failed to create zip. Create it manually from .output/chrome-mv3/');
    process.exit(1);
  }
}
