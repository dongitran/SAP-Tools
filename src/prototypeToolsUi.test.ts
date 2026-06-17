import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readToolsSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/07g-render-tools.js', import.meta.url),
    'utf8'
  );
}

async function readEventsSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/01-events.js', import.meta.url),
    'utf8'
  );
}

async function readSqlRenderSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/07e-render-sql.js', import.meta.url),
    'utf8'
  );
}

async function readStateSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/00-state.js', import.meta.url),
    'utf8'
  );
}

async function readQuickSelectionSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/05-quick-selection.js', import.meta.url),
    'utf8'
  );
}

async function readWorkspaceRenderSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/07d-render-workspace.js', import.meta.url),
    'utf8'
  );
}

async function readEventStylesSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/styles/09-events.css', import.meta.url),
    'utf8'
  );
}

async function readLogsStylesSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/src/styles/03-logs-panel.css', import.meta.url),
    'utf8'
  );
}

async function readEventWebviewSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/assets/events-webview.js', import.meta.url),
    'utf8'
  );
}

async function readEventVariantSource(): Promise<string> {
  return readFile(
    new URL('../docs/designs/prototypes/variants/events-webview.html', import.meta.url),
    'utf8'
  );
}

describe('prototype Microsoft Graph tools UI', () => {
  it('renders an explicit show/hide toggle for client secret fields', async () => {
    const source = await readToolsSource();

    expect(source).toContain('toggle-client-secret-visibility');
    expect(source).toContain('Show Client Secret');
    expect(source).toContain('Hide Client Secret');
    expect(source).toContain('microsoftGraphClientSecretVisibleByTool');
  });

  it('uses the active tool name as the screen heading without a duplicate inner header', async () => {
    const source = await readToolsSource();

    expect(source).toContain('resolveToolsHeaderTitle');
    expect(source).not.toContain('tool-workbench-head');
  });

  it('routes SVG icon clicks through the nearest action button', async () => {
    const source = await readEventsSource();

    expect(source).toContain("eventTarget.closest('[data-action]')");
  });
});

describe('prototype Log-API-Event workspace', () => {
  it('renames the first workspace tab without keeping the old label', async () => {
    const source = await readStateSource();

    expect(source).toContain("label: 'Log-API-Event'");
    expect(source).not.toContain("label: 'Logs/APIs'");
  });

  it('shows APIs and Event actions without the idle Ready badge', async () => {
    const source = await readWorkspaceRenderSource();

    expect(source).toContain('data-action="open-app-apis"');
    expect(source).toContain('data-action="open-app-events"');
    expect(source).not.toContain('app-log-state is-idle');
    expect(source).not.toContain('>Ready<');
  });

  it('routes the Event action to the Event viewer prototype', async () => {
    const source = await readQuickSelectionSource();

    expect(source).toContain('saptools.openEventMesh');
    expect(source).toContain('./variants/events-webview.html');
  });

  it('keeps app rows fixed while making APIs and Event hover targets taller', async () => {
    const source = await readLogsStylesSource();

    expect(source).toMatch(/\.app-log-item\s*\{[\s\S]*?padding:\s*8px 10px;/);
    expect(source).toMatch(/\.app-log-apis-btn\s*\{[\s\S]*?min-height:\s*20px;/);
    expect(source).toMatch(/\.app-log-apis-btn\s*\{[\s\S]*?line-height:\s*1\.2;/);
    expect(source).toMatch(/\.app-log-apis-btn\s*\{[\s\S]*?box-sizing:\s*border-box;/);
  });

  it('explains that Event debugging selects one messaging binding per session', async () => {
    const source = await readEventWebviewSource();

    expect(source).toContain('One messaging binding is used per debug session');
    expect(source).toContain('bindingIndex: selectedBindingIndex');
  });

  it('has a standalone Event viewer variant for Playwright prototype checks', async () => {
    const source = await readEventVariantSource();

    expect(source).toContain('id="event-mesh-app"');
    expect(source).toContain('../assets/prototype.css');
    expect(source).toContain('../assets/events-webview.js');
  });

  it('does not add non-zero letter spacing to the Event viewer styles', async () => {
    const source = await readEventStylesSource();
    const values = Array.from(source.matchAll(/letter-spacing:\s*([^;]+);/g)).map((match) =>
      match[1]?.trim()
    );

    expect(values).toEqual(values.map(() => '0'));
  });
});

describe('prototype S/4HANA SQL Workbench table refresh', () => {
  it('treats refresh-hana-tables as an in-place SQL-only action so the service list is not re-rendered', async () => {
    const topology = await readFile(
      new URL('../docs/designs/prototypes/src/02-topology.js', import.meta.url),
      'utf8'
    );
    // Must be in the SQL-only set, otherwise the click falls through to a full
    // renderPrototype() that rebuilds the service list and resets its scroll.
    expect(topology).toMatch(/isSqlOnlyAction[\s\S]*?'refresh-hana-tables'/);

    const events = await readEventsSource();
    // Pin refresh-hana-tables INTO the in-place branch (alongside
    // select-hana-service → refreshMountedSqlWorkbench), not merely present
    // somewhere — otherwise routing it to the else branch would still pass.
    expect(events).toMatch(
      /action === 'select-hana-service' \|\| action === 'refresh-hana-tables'\)[\s\S]*?refreshMountedSqlWorkbench\(\)/
    );
  });
});

describe('prototype S/4HANA SQL Workbench tunnel indicator', () => {
  it('shows a single tunnel badge beside the workbench title, not a per-row badge or count', async () => {
    const source = await readSqlRenderSource();

    // One presence badge in the header.
    expect(source).toContain('data-role="hana-tunnel-indicator"');
    expect(source).toContain('anyHanaTunnelActive');
    // No per-row badge, no count label.
    expect(source).not.toContain('hana-service-tunnel-badge');
    expect(source).not.toContain('hana-tunnel-count');
    expect(source).not.toContain('countActiveHanaTunnels');
    expect(source).not.toContain('formatHanaTunnelCountLabel');
  });
});
