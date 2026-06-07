import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.join(__dirname, '../docs/designs/prototypes/src');
const destFile = path.join(__dirname, '../docs/designs/prototypes/assets/prototype.js');

const files = [
  '00-state.js',
  '01-events.js',
  '02-topology.js',
  '03-handlers.js',
  '04-hana-sql.js',
  '05-quick-selection.js',
  '06-utils.js',
  '07a-render-core.js',
  '07b-render-topology.js',
  '07c-render-selection.js',
  '07d-render-workspace.js',
  '07e-render-sql.js',
  '07f-render-utils.js',
  '08-cf-logs.js'
];

const cssFiles = [
  '00-base.css',
  '01-layout-cards.css',
  '02-components.css',
  '03-logs-panel.css',
  '04-service-export.css',
  '05-packages.css',
  '06-hana-sql.css'
];

function buildFile(files, srcSubdir, destFileName) {
  const destFile = path.join(__dirname, '../docs/designs/prototypes/assets', destFileName);
  let concatenatedCode = '';
  
  const isCss = destFileName.endsWith('.css');
  
  for (const file of files) {
    const filePath = path.join(__dirname, '../docs/designs/prototypes/src', srcSubdir, file);
    if (!fs.existsSync(filePath)) {
      console.error(`Missing source file: ${file} at ${filePath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    
    if (isCss) {
      concatenatedCode += `/* --- BEGIN ${file} --- */\n`;
    } else {
      concatenatedCode += `// --- BEGIN ${file} ---\n`;
    }
    
    concatenatedCode += content;
    if (!content.endsWith('\n')) {
      concatenatedCode += '\n';
    }
    
    if (isCss) {
      concatenatedCode += `/* --- END ${file} --- */\n\n`;
    } else {
      concatenatedCode += `// --- END ${file} ---\n\n`;
    }
  }
  
  fs.writeFileSync(destFile, concatenatedCode);
  console.log(`Successfully built ${destFileName} from ${files.length} source files.`);
}

buildFile(files, '', 'prototype.js');
buildFile(cssFiles, 'styles', 'prototype.css');
