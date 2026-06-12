const SUPPORT_TOOL_DEFINITIONS = [
  {
    id: 'outlook',
    title: 'Outlook OAuth2',
    eyebrow: 'Microsoft Graph',
    description: 'Validate app credentials, verify sender mailbox, then send a real test email.',
  },
  {
    id: 'sharepoint',
    title: 'SharePoint',
    eyebrow: 'Microsoft Graph',
    description: 'Validate app credentials, resolve the site and drive, then create and remove test content.',
  },
];

const MICROSOFT_GRAPH_TOOL_STEPS = {
  outlook: [
    { id: 'token', label: 'Validate OAuth2 app key' },
    { id: 'send-mail', label: 'Send test email' },
  ],
  sharepoint: [
    { id: 'token', label: 'Validate OAuth2 app key' },
    { id: 'site', label: 'Resolve SharePoint site' },
    { id: 'drive', label: 'Resolve document drive' },
    { id: 'root', label: 'Verify root directory' },
    { id: 'create-folder', label: 'Create test folder' },
    { id: 'create-file', label: 'Create test file' },
    { id: 'delete-file', label: 'Delete test file' },
    { id: 'delete-folder', label: 'Delete test folder' },
  ],
};

function renderToolsIcon() {
  return `
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M14.7 6.3a4 4 0 0 0-5 5L4.6 16.4a1.6 1.6 0 0 0 2.3 2.3l5.1-5.1a4 4 0 0 0 5-5l-2.6 2.6-2.9-2.9 2.6-2.6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function renderToolsScreen() {
  const heading = resolveToolsHeaderTitle();
  const action = activeSupportToolId.length === 0 ? 'close-tools' : 'back-to-tools-list';
  const label = activeSupportToolId.length === 0 ? 'Back' : 'All Tools';
  const ariaLabel = activeSupportToolId.length === 0 ? 'Close Tools' : 'Back to tool list';
  return `
    <header class="shell-header tools-header">
      <div class="shell-header-row">
        <h1>${escapeHtml(heading)}</h1>
        <button type="button" class="stage-reset" data-action="${action}" aria-label="${ariaLabel}">${label}</button>
      </div>
    </header>
    <section class="tools-body">
      ${activeSupportToolId.length === 0 ? renderToolChooser() : renderActiveTool()}
    </section>
  `;
}

function resolveToolsHeaderTitle() {
  const tool = resolveSupportTool(activeSupportToolId);
  return tool?.title ?? 'Tools';
}

function renderToolChooser() {
  return `
    <section class="tools-chooser" aria-label="Tool selector">
      ${SUPPORT_TOOL_DEFINITIONS.map((tool) => renderToolChoice(tool)).join('')}
    </section>
  `;
}

function renderToolChoice(tool) {
  return `
    <button type="button" class="tool-choice" data-action="select-support-tool" data-tool-id="${tool.id}">
      <span class="tool-choice-icon" aria-hidden="true">${tool.id === 'outlook' ? '&#9993;' : '&#128193;'}</span>
      <span class="tool-choice-copy">
        <span class="tool-choice-eyebrow">${escapeHtml(tool.eyebrow)}</span>
        <strong>${escapeHtml(tool.title)}</strong>
        <span>${escapeHtml(tool.description)}</span>
      </span>
    </button>
  `;
}

function renderActiveTool() {
  const tool = resolveSupportTool(activeSupportToolId);
  if (tool === undefined) {
    return renderToolChooser();
  }

  return `
    <section class="tool-workbench" aria-label="${escapeHtml(tool.title)} tool">
      ${tool.id === 'outlook' ? renderOutlookToolForm() : renderSharePointToolForm()}
      ${renderMicrosoftGraphToolSteps(tool.id)}
    </section>
  `;
}

function renderOutlookToolForm() {
  return `
    <section class="tool-panel tool-input-panel" aria-label="Outlook OAuth2 inputs">
      <div class="tool-form-grid">
        ${renderToolInput('outlook', 'clientId', 'Client ID')}
        ${renderToolInput('outlook', 'tenantId', 'Tenant ID')}
        ${renderToolInput('outlook', 'clientSecret', 'Client Secret', 'password')}
        ${renderToolInput('outlook', 'senderEmail', 'Sender Email', 'email')}
        ${renderToolInput('outlook', 'recipientEmail', 'Recipient Email', 'email')}
      </div>
      ${renderToolRunActions('Run Outlook Test')}
    </section>
  `;
}

function renderSharePointToolForm() {
  return `
    <section class="tool-panel tool-input-panel" aria-label="SharePoint inputs">
      <div class="tool-form-grid">
        ${renderToolInput('sharepoint', 'clientId', 'Client ID')}
        ${renderToolInput('sharepoint', 'tenantId', 'Tenant ID')}
        ${renderToolInput('sharepoint', 'clientSecret', 'Client Secret', 'password')}
        ${renderToolInput('sharepoint', 'url', 'SharePoint URL', 'url', 'https://contoso.sharepoint.com')}
        ${renderToolInput('sharepoint', 'site', 'Site', 'text', '/sites/team')}
        ${renderToolInput('sharepoint', 'rootDir', 'Root Dir', 'text', '/')}
      </div>
      ${renderToolRunActions('Run SharePoint Test')}
    </section>
  `;
}

function renderToolInput(toolId, field, label, type = 'text', placeholder = '') {
  if (field === 'clientSecret') {
    return renderClientSecretInput(toolId, label, placeholder);
  }
  const value = microsoftGraphToolFormValues[toolId]?.[field] ?? '';
  const inputId = `tool-${toolId}-${field}`;
  return `
    <label class="tool-field" for="${inputId}">
      <span>${escapeHtml(label)}</span>
      <input
        id="${inputId}"
        type="${type}"
        data-role="microsoft-graph-tool-field"
        data-tool-id="${toolId}"
        data-field="${field}"
        value="${escapeHtml(value)}"
        placeholder="${escapeHtml(placeholder)}"
        autocomplete="off"
      />
    </label>
  `;
}

function renderClientSecretInput(toolId, label, placeholder = '') {
  const value = microsoftGraphToolFormValues[toolId]?.clientSecret ?? '';
  const inputId = `tool-${toolId}-clientSecret`;
  const isVisible = microsoftGraphClientSecretVisibleByTool[toolId] === true;
  const toggleLabel = isVisible ? 'Hide Client Secret' : 'Show Client Secret';
  return `
    <div class="tool-field tool-field-secret">
      <label for="${inputId}">${escapeHtml(label)}</label>
      <span class="tool-secret-input-shell">
        <input
          id="${inputId}"
          type="${isVisible ? 'text' : 'password'}"
          data-role="microsoft-graph-tool-field"
          data-tool-id="${toolId}"
          data-field="clientSecret"
          value="${escapeHtml(value)}"
          placeholder="${escapeHtml(placeholder)}"
          autocomplete="off"
        />
        <button
          type="button"
          class="tool-secret-toggle"
          data-action="toggle-client-secret-visibility"
          data-tool-id="${toolId}"
          aria-label="${toggleLabel}"
          aria-pressed="${isVisible}"
          title="${toggleLabel}"
        >
          ${renderClientSecretVisibilityIcon(isVisible)}
        </button>
      </span>
    </div>
  `;
}

function renderClientSecretVisibilityIcon(isVisible) {
  const slash = isVisible
    ? '<path d="M5 5l14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    : '';
  return `
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>
      ${slash}
    </svg>
  `;
}

function renderToolRunActions(label) {
  const statusClass = `tool-status is-${microsoftGraphToolStatusTone}`;
  return `
    <div class="tool-run-row">
      <p class="${statusClass}" role="status" aria-live="polite">${escapeHtml(microsoftGraphToolStatusMessage)}</p>
      <button type="button" class="primary-action" data-action="run-support-tool" ${microsoftGraphToolRunInProgress ? 'disabled' : ''}>
        ${microsoftGraphToolRunInProgress ? 'Running...' : escapeHtml(label)}
      </button>
    </div>
  `;
}

function renderMicrosoftGraphToolSteps(toolId) {
  const steps = ensureMicrosoftGraphToolSteps(toolId);
  return `
    <section class="tool-panel tool-step-panel" aria-label="Test steps">
      <h3>Verification Steps</h3>
      <ol class="tool-step-graph">
        ${steps.map((step, index) => renderToolStep(step, index, steps.length)).join('')}
      </ol>
    </section>
  `;
}

function renderToolStep(step, index, total) {
  const isLast = index === total - 1;
  return `
    <li class="tool-step is-${step.status}">
      <span class="tool-step-node" aria-hidden="true">${renderStepGlyph(step.status)}</span>
      ${isLast ? '' : '<span class="tool-step-line" aria-hidden="true"></span>'}
      <span class="tool-step-copy">
        <strong>${escapeHtml(step.label)}</strong>
        <span>${escapeHtml(step.message || resolveStepStatusLabel(step.status))}</span>
      </span>
    </li>
  `;
}

function renderStepGlyph(status) {
  if (status === 'done') return '&#10003;';
  if (status === 'failed') return '!';
  if (status === 'running') return '<span class="tool-step-spinner"></span>';
  return '';
}

function resolveStepStatusLabel(status) {
  if (status === 'running') return 'Running';
  if (status === 'done') return 'Passed';
  if (status === 'failed') return 'Failed';
  return 'Waiting';
}

function isSupportedToolId(toolId) {
  return SUPPORT_TOOL_DEFINITIONS.some((tool) => tool.id === toolId);
}

function resolveSupportTool(toolId) {
  return SUPPORT_TOOL_DEFINITIONS.find((tool) => tool.id === toolId);
}

function createInitialMicrosoftGraphToolSteps(toolId) {
  return (MICROSOFT_GRAPH_TOOL_STEPS[toolId] ?? []).map((step) => ({
    ...step,
    status: 'pending',
    message: '',
  }));
}

function ensureMicrosoftGraphToolSteps(toolId) {
  if (microsoftGraphToolSteps.length === 0) {
    microsoftGraphToolSteps = createInitialMicrosoftGraphToolSteps(toolId);
  }
  return microsoftGraphToolSteps;
}

function updateMicrosoftGraphToolFormValue(toolId, field, value) {
  if (!isSupportedToolId(toolId) || !(field in microsoftGraphToolFormValues[toolId])) {
    return;
  }
  microsoftGraphToolFormValues = {
    ...microsoftGraphToolFormValues,
    [toolId]: {
      ...microsoftGraphToolFormValues[toolId],
      [field]: value,
    },
  };
}

function triggerMicrosoftGraphToolRun() {
  if (!isSupportedToolId(activeSupportToolId) || microsoftGraphToolRunInProgress) {
    return false;
  }
  const missingFields = resolveMissingToolFields(activeSupportToolId);
  if (missingFields.length > 0) {
    microsoftGraphToolStatusTone = 'error';
    microsoftGraphToolStatusMessage = `Missing: ${missingFields.join(', ')}.`;
    return true;
  }
  microsoftGraphToolRunInProgress = true;
  microsoftGraphToolStatusTone = 'info';
  microsoftGraphToolStatusMessage = 'Running checks...';
  microsoftGraphToolSteps = createInitialMicrosoftGraphToolSteps(activeSupportToolId);
  if (vscodeApi === null) {
    runPrototypeMicrosoftGraphTool(activeSupportToolId);
    return true;
  }
  vscodeApi.postMessage({
    type: RUN_MICROSOFT_GRAPH_TOOL_MESSAGE_TYPE,
    toolId: activeSupportToolId,
    input: microsoftGraphToolFormValues[activeSupportToolId],
  });
  return true;
}

function resolveMissingToolFields(toolId) {
  const requiredFields = toolId === 'outlook'
    ? ['clientId', 'clientSecret', 'tenantId', 'senderEmail', 'recipientEmail']
    : ['clientId', 'clientSecret', 'tenantId', 'url', 'site', 'rootDir'];
  return requiredFields
    .filter((field) => (microsoftGraphToolFormValues[toolId]?.[field] ?? '').trim().length === 0)
    .map((field) => field.replace(/([A-Z])/g, ' $1').toLowerCase());
}

function applyMicrosoftGraphToolProgress(msg) {
  const toolId = typeof msg.toolId === 'string' ? msg.toolId : activeSupportToolId;
  const stepId = typeof msg.stepId === 'string' ? msg.stepId : '';
  const status = normalizeToolStepStatus(msg.status);
  const message = typeof msg.message === 'string' ? msg.message : '';
  if (!isSupportedToolId(toolId) || stepId.length === 0) return;
  activeSupportToolId = toolId;
  microsoftGraphToolSteps = updateMicrosoftGraphStep(toolId, stepId, status, message);
  microsoftGraphToolRunInProgress = status !== 'failed';
}

function applyMicrosoftGraphToolResult(msg) {
  microsoftGraphToolRunInProgress = false;
  microsoftGraphToolStatusTone = msg.success === true ? 'success' : 'error';
  microsoftGraphToolStatusMessage = typeof msg.message === 'string'
    ? msg.message
    : msg.success === true ? 'All checks passed.' : 'Tool run failed.';
}

function updateMicrosoftGraphStep(toolId, stepId, status, message) {
  const steps = ensureMicrosoftGraphToolSteps(toolId);
  return steps.map((step) => step.id === stepId ? { ...step, status, message } : step);
}

function normalizeToolStepStatus(status) {
  return status === 'running' || status === 'done' || status === 'failed' ? status : 'pending';
}

function runPrototypeMicrosoftGraphTool(toolId) {
  const steps = createInitialMicrosoftGraphToolSteps(toolId);
  steps.forEach((step, index) => {
    setTimeout(() => {
      if (activeSupportToolId !== toolId) return;
      microsoftGraphToolSteps = updateMicrosoftGraphStep(toolId, step.id, 'running', 'Running');
      renderPrototype();
    }, 220 + index * 520);
    setTimeout(() => {
      if (activeSupportToolId !== toolId) return;
      microsoftGraphToolSteps = updateMicrosoftGraphStep(toolId, step.id, 'done', 'Passed in prototype mode');
      if (index === steps.length - 1) {
        microsoftGraphToolRunInProgress = false;
        microsoftGraphToolStatusTone = 'success';
        microsoftGraphToolStatusMessage = 'Prototype checks completed.';
      }
      renderPrototype();
    }, 520 + index * 520);
  });
}
