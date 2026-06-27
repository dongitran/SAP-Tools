import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readSidebarProviderSource(): Promise<string> {
  const providerSource = await readFile(new URL('./sidebarProvider.ts', import.meta.url), 'utf8');
  const handlersSource = await readFile(new URL('./sidebar/handlers/miscHandlers.ts', import.meta.url), 'utf8');
  return providerSource + '\n' + handlersSource;
}

describe('RegionSidebarProvider Microsoft Graph logging', () => {
  it('writes Microsoft Graph tool progress to a dedicated output channel', async () => {
    const source = await readSidebarProviderSource();

    expect(source).toContain("createOutputChannel('SAP Tools: Microsoft Graph')");
    expect(source).toContain('appendMicrosoftGraphToolLog');
    expect(source).toContain('MSG_MICROSOFT_GRAPH_TOOL_PROGRESS');
    expect(source).toContain('MSG_MICROSOFT_GRAPH_TOOL_RESULT');
  });
});
