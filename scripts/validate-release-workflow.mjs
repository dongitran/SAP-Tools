import fs from 'node:fs';

const workflowPath = '.github/workflows/release.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');

const requiredSnippets = [
  {
    label: 'branch release derives version from package.json',
    snippet: "node -p \"require('./package.json').version\"",
  },
  {
    label: 'branch release creates a v-version tag',
    snippet: 'Create release tag',
  },
  {
    label: 'branch release pushes the generated tag',
    snippet: 'git push origin "refs/tags/${TAG_NAME}"',
  },
  {
    label: 'GitHub Release action is present',
    snippet: 'softprops/action-gh-release@v2',
  },
  {
    label: 'GitHub Release uses the generated tag',
    snippet: 'tag_name: ${{ steps.release_info.outputs.tag_name }}',
  },
  {
    label: 'VSIX asset is attached to the release',
    snippet: 'files: sap-tools-${{ steps.release_info.outputs.version }}.vsix',
  },
];

const forbiddenSnippets = [
  'Publish to VS Marketplace',
  'VSCE_PAT',
  'npm run ${{ steps.flavor.outputs.script }}',
  'npx @vscode/vsce publish',
];

const failures = [];

for (const requirement of requiredSnippets) {
  if (!workflow.includes(requirement.snippet)) {
    failures.push(`Missing: ${requirement.label}`);
  }
}

for (const snippet of forbiddenSnippets) {
  if (workflow.includes(snippet)) {
    failures.push(`Forbidden marketplace publish path remains: ${snippet}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Release workflow validation failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Release workflow validation passed.\n');
