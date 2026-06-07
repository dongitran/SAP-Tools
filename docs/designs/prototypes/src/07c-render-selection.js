function renderSelectionScreen() {
  const showTabs = cfTopology.ready === true;
  const isQuick = showTabs && activeSelectionMode === 'quick';

  if (!showTabs) {
    return `
      <header class="shell-header">
        <div class="shell-header-row">
          <h1>Select SAP BTP Region</h1>
          <button
            type="button"
            class="header-icon-button"
            data-action="open-settings"
            aria-label="Open Settings"
            title="Settings"
          >
            &#9881;
          </button>
        </div>
      </header>

      <div class="groups" role="list">
        ${renderSelectionStageSlots()}
      </div>
    `;
  }

  return `
    <header class="shell-header">
      <div class="shell-header-row">
        <h1>Select SAP BTP Region</h1>
        <button
          type="button"
          class="header-icon-button"
          data-action="open-settings"
          aria-label="Open Settings"
          title="Settings"
        >
          &#9881;
        </button>
      </div>
    </header>

    <nav class="selection-tabs" role="tablist" aria-label="Selection mode">
      <button
        id="selection-tab-quick"
        type="button"
        class="tab-button${isQuick ? ' is-active' : ''}"
        data-action="switch-selection-mode"
        data-selection-mode="quick"
        role="tab"
        aria-selected="${isQuick}"
      >
        Quick Org Search
      </button>
      <button
        id="selection-tab-custom"
        type="button"
        class="tab-button${isQuick ? '' : ' is-active'}"
        data-action="switch-selection-mode"
        data-selection-mode="custom"
        role="tab"
        aria-selected="${!isQuick}"
      >
        Custom
      </button>
    </nav>

    ${
      isQuick
        ? `<div class="selection-quick-panel" role="tabpanel" aria-label="Quick Org Search">${renderQuickOrgPanel()}</div>`
        : `<div class="groups selection-custom-panel" role="list" aria-label="Custom">${renderSelectionStageSlots()}</div>`
    }
  `;
}

function renderQuickOrgPanel() {
  const accounts = Array.isArray(cfTopology.accounts) ? cfTopology.accounts : [];
  const orgCount = accounts.length;

  if (orgCount === 0) {
    return `
      <div class="quick-empty-state">
        <p>No synced orgs found.</p>
        <p>Switch to <strong>Custom</strong> tab to select manually, or run CF sync to populate this list.</p>
      </div>
    `;
  }

  if (quickPickOrgName.length > 0) {
    return renderQuickSpaceView();
  }

  const filtered = filterTopologyOrgEntries();
  const resultsMarkup = renderQuickOrgResultsMarkup(filtered);

  return `
    <input
      type="search"
      class="topology-org-search-input"
      data-role="topology-org-search"
      aria-label="Search synced organizations"
      placeholder="Type org name, region key, or label..."
      autocomplete="off"
      spellcheck="false"
      value="${escapeHtml(topologyOrgSearchQuery)}"
    />
    ${resultsMarkup}
  `;
}

function renderQuickOrgResultsMarkup(filtered) {
  if (filtered.length === 0) {
    return `
      <div class="topology-org-empty" data-role="topology-org-empty">
        No org matches "${escapeHtml(topologyOrgSearchQuery.trim())}"
      </div>
    `;
  }

  const rowsMarkup = filtered
    .map((account) => {
      const isSelected =
        quickPickRegionKey === account.regionKey && quickPickOrgName === account.orgName;
      return renderTopologyOrgRow(account, isSelected);
    })
    .join('');
  return `<div class="topology-org-results" data-role="topology-org-results">${rowsMarkup}</div>`;
}

function renderQuickSpaceView() {
  const region = regionLookup.get(quickPickRegionKey);
  const regionLabel = region ? `${region.code} ${region.name}` : quickPickRegionKey;
  const canConfirm = quickPickSpaceName.length > 0 && !quickConfirmInProgress;
  const errorMarkup =
    quickConfirmError.length > 0
      ? `<p class="stage-error" role="alert">${escapeHtml(quickConfirmError)}</p>`
      : '';

  return `
    <div class="quick-space-view">
      ${renderQuickOrganizationCard(regionLabel)}
      ${renderQuickSpaceCard()}
      <button type="button" class="stage-reset quick-back-button" data-action="quick-back-to-orgs">
        ← Back
      </button>
      ${errorMarkup}
      ${renderQuickConfirmPanel(canConfirm)}
    </div>
  `;
}

function renderQuickOrganizationCard(regionLabel) {
  return `
    <section class="group-card org-stage quick-org-stage" aria-label="Quick organization" data-stage-id="quick-org">
      <div class="group-head"><h2>Organization</h2></div>
      <div class="org-picker quick-org-picker">
        <button
          type="button"
          class="org-option is-selected quick-org-option"
          aria-pressed="true"
          aria-label="${escapeHtml(quickPickOrgName)} in ${escapeHtml(regionLabel)}"
        >
          <span class="topology-org-name">${escapeHtml(quickPickOrgName)}</span>
          <span class="topology-org-meta">${escapeHtml(regionLabel)}</span>
        </button>
      </div>
    </section>
  `;
}

function renderQuickSpaceCard() {
  const spacesMarkup = renderQuickSpaceButtons();
  return `
    <section class="group-card space-stage quick-space-stage" aria-label="Quick space list" data-stage-id="quick-space">
      <div class="group-head"><h2>Choose Space</h2></div>
      <div class="space-picker quick-space-picker">
        ${spacesMarkup}
      </div>
    </section>
  `;
}

function renderQuickSpaceButtons() {
  const spaceButtons = quickPickOrgSpaces
    .map((space) => {
      const isSelected = space === quickPickSpaceName;
      return `
        <button
          type="button"
          class="space-option${isSelected ? ' is-selected' : ''}"
          data-quick-space="${escapeHtml(space)}"
          aria-pressed="${isSelected}"
        >
          ${escapeHtml(space)}
        </button>
      `;
    })
    .join('');

  return spaceButtons.length > 0
    ? spaceButtons
    : '<div class="topology-org-empty" data-role="quick-space-empty">No spaces found for this org.</div>';
}

function renderQuickConfirmPanel(canConfirm) {
  return `
    <div class="confirm-stage" aria-label="Region confirmation">
      <button
        type="button"
        class="confirm-button"
        data-action="quick-confirm-scope"
        ${canConfirm ? '' : 'disabled'}
      >
        ${quickConfirmInProgress ? 'Confirming…' : 'Confirm Scope'}
      </button>
    </div>
  `;
}

function renderSettingsScreen() {
  const syncIntervalOptions = SYNC_INTERVAL_OPTIONS.map((hours) => {
    const isSelected = syncIntervalHours === hours;
    return `
      <option value="${String(hours)}" ${isSelected ? 'selected' : ''}>
        ${formatSyncIntervalLabel(hours)}
      </option>
    `;
  }).join('');

  const userLabel = activeUserEmail.length > 0 ? activeUserEmail : 'Not signed in';
  const syncStatusMessage = resolveSettingsStatusMessage();

  return `
    <header class="shell-header settings-header">
      <div class="shell-header-row">
        <h1>Settings</h1>
        <button
          type="button"
          class="stage-reset"
          data-action="close-settings"
          aria-label="Close Settings"
        >
          Back
        </button>
      </div>
    </header>

    <section class="settings-body">
      <section class="group-card settings-section">
        <h2>Cache Sync Interval</h2>
        <div class="sync-interval-picker">
          <label class="sync-interval-label" for="sync-interval-select">Sync interval</label>
          <select
            id="sync-interval-select"
            class="sync-interval-select"
            data-role="sync-interval-select"
            aria-label="Cache sync interval"
          >
            ${syncIntervalOptions}
          </select>
        </div>
        <p class="settings-meta">Current account: ${escapeHtml(userLabel)}</p>
      </section>

      <section class="group-card settings-section">
        <h2>Sync Status</h2>
        <ul class="settings-status-list">
          <li><span>Last completion</span><strong>${escapeHtml(formatTimestampLabel(lastSyncCompletedAt))}</strong></li>
          <li><span>Next sync</span><strong>${escapeHtml(formatTimestampLabel(nextSyncAt))}</strong></li>
        </ul>
        <p class="settings-status-message" role="status" aria-live="polite">${escapeHtml(syncStatusMessage)}</p>
        <div class="toolbar-row settings-actions" role="group" aria-label="Settings actions">
          <button type="button" class="primary-action" data-action="sync-now">Sync now</button>
          <button type="button" class="secondary-action" data-action="logout">Logout</button>
        </div>
      </section>
    </section>
  `;
}

function renderSelectionStageSlots() {
  return SELECTION_STAGE_SLOT_IDS.map((stageSlotId) => {
    return `<div class="stage-slot" data-stage-slot="${stageSlotId}"></div>`;
  }).join('');
}

function resolveSelectionStageSlotsForAction(action) {
  if (action === 'reset-area-selection') {
    return ['area', 'region', 'org', 'space', 'confirm'];
  }

  if (action === 'reset-region-selection') {
    return ['area', 'region', 'org', 'space', 'confirm'];
  }

  if (action === 'reset-org-selection') {
    return ['org', 'space', 'confirm'];
  }

  if (action === 'reset-space-selection') {
    return ['space', 'confirm'];
  }

  return [];
}

function updateSelectionStageSlots(stageSlotIds) {
  const selectedGroup = groupLookup.get(selectedGroupId);
  const selectedRegion = resolveSelectedRegion();
  const normalizedSlotIds = normalizeSelectionStageSlots(stageSlotIds);

  for (const stageSlotId of normalizedSlotIds) {
    const markup = renderSelectionStageMarkup(stageSlotId, selectedGroup, selectedRegion);
    setSelectionStageSlotMarkup(stageSlotId, markup);
  }
}

function normalizeSelectionStageSlots(stageSlotIds) {
  const seenStageSlots = new Set();
  const normalizedStageSlots = [];

  for (const stageSlotId of stageSlotIds) {
    if (
      !SELECTION_STAGE_SLOT_IDS.includes(stageSlotId) ||
      seenStageSlots.has(stageSlotId)
    ) {
      continue;
    }

    normalizedStageSlots.push(stageSlotId);
    seenStageSlots.add(stageSlotId);
  }

  return normalizedStageSlots;
}

function renderSelectionStageMarkup(stageSlotId, selectedGroup, selectedRegion) {
  if (stageSlotId === 'area') {
    return renderAreaStage(selectedGroup);
  }

  if (stageSlotId === 'region') {
    return selectedGroup === undefined
      ? renderEmptyRegionPanel()
      : renderSelectedGroupPanel(selectedGroup);
  }

  if (stageSlotId === 'org') {
    return selectedRegion === undefined ? '' : renderOrgStage();
  }

  if (stageSlotId === 'space') {
    return selectedOrgId.length === 0 ? '' : renderSpaceStage();
  }

  if (stageSlotId === 'confirm') {
    return renderConfirmPanel();
  }

  return '';
}

function setSelectionStageSlotMarkup(stageSlotId, markup) {
  const slotElement = appElement.querySelector(
    `[data-stage-slot="${stageSlotId}"]`
  );
  if (!(slotElement instanceof HTMLElement)) {
    return;
  }

  slotElement.innerHTML = markup;
}

function isSelectionShellMounted() {
  const groupsElement = appElement.querySelector('.groups');
  if (!(groupsElement instanceof HTMLElement)) {
    return false;
  }

  return SELECTION_STAGE_SLOT_IDS.every((stageSlotId) => {
    return (
      appElement.querySelector(`[data-stage-slot="${stageSlotId}"]`) !== null
    );
  });
}

function renderAreaStage(selectedGroup) {
  const isCollapsed = selectedGroup !== undefined;
  const orderedGroups = resolveOrderedGroups();

  return `
    <section class="group-card area-stage" aria-label="Area selector" data-stage-id="area">
      <div class="group-head">
        <h2>Choose Area</h2>
        ${
          isCollapsed
            ? '<button type="button" class="stage-reset" data-action="reset-area-selection">Change</button>'
            : `<span class="group-count">${orderedGroups.length}</span>`
        }
      </div>
      <div class="area-picker${isCollapsed ? ' is-collapsed' : ''}" role="listbox" aria-label="SAP area groups">
        ${renderAreaPicker(selectedGroup, orderedGroups)}
      </div>
    </section>
  `;
}

function renderAreaPicker(selectedGroup, orderedGroups) {
  const isCollapsed = selectedGroup !== undefined;

  return orderedGroups
    .map((group) => {
      const isActive = group.id === selectedGroupId;
      const isHidden = isCollapsed && !isActive;
      const isDisabled = isAreaDisabled(group.id) && !isActive;
      const areaLabelParts = splitAreaLabel(group.label);
      return `
        <button
          type="button"
          class="area-option${isActive ? ' is-active' : ''}${isHidden ? ' is-hidden' : ''}${isDisabled ? ' is-disabled' : ''}"
          data-group-id="${group.id}"
          aria-pressed="${isActive}"
          aria-hidden="${isHidden}"
          aria-disabled="${isDisabled}"
          ${isDisabled ? 'disabled' : ''}
        >
          <span class="area-label">${areaLabelParts.title}</span>
          ${
            areaLabelParts.meta.length > 0
              ? `<span class="area-meta">${areaLabelParts.meta}</span>`
              : ''
          }
        </button>
      `;
    })
    .join('');
}

function splitAreaLabel(label) {
  const normalizedLabel = label.trim();
  const match = /^(.+?)\s*\(([^)]+)\)$/.exec(normalizedLabel);
  if (match === null) {
    return {
      title: normalizedLabel,
      meta: '',
    };
  }

  return {
    title: match[1].trim(),
    meta: match[2].trim(),
  };
}

function renderSelectedGroupPanel(group) {
  const isCollapsed = selectedRegionId.length > 0;
  const orderedRegions = resolveOrderedRegions(group);
  const filteredRegions = isCollapsed ? orderedRegions : filterRegionOptions(orderedRegions);
  const regionOptionsMarkup = filteredRegions
    .map((region) => {
      const isSelected = region.id === selectedRegionId;
      const isHidden = isCollapsed && !isSelected;
      const isDisabled = isRegionDisabled(region.id) && !isSelected;
      return `
        <button
          type="button"
          class="region-option${isSelected ? ' is-selected' : ''}${isHidden ? ' is-hidden' : ''}${isDisabled ? ' is-disabled' : ''}"
          data-region-id="${region.id}"
          aria-pressed="${isSelected}"
          aria-hidden="${isHidden}"
          aria-disabled="${isDisabled}"
          ${isDisabled ? 'disabled' : ''}
        >
          <span class="region-code">${region.code}</span>
          <span class="region-name">${region.name}</span>
        </button>
      `;
    })
    .join('');

  return `
    <section class="group-card" aria-label="Region list" data-stage-id="region">
      <div class="group-head">
        <h2>Choose Region</h2>
        ${!isCollapsed ? renderRegionSearchInput() : ''}
        <button
          type="button"
          class="stage-reset"
          data-action="reset-region-selection"
          ${selectedRegionId.length === 0 ? 'disabled' : ''}
        >
          Change
        </button>
      </div>
      <div class="region-layout ${activeDesign.layout}">
        ${regionOptionsMarkup}
      </div>
    </section>
  `;
}

function renderRegionSearchInput() {
  return `
    <label class="group-head-search-wrapper search-input-with-icon">
      <span class="search-input-icon" aria-hidden="true">&#128269;</span>
      <input
        type="search"
        class="group-head-search-input"
        data-role="region-search"
        aria-label="Search regions"
        placeholder="Search..."
        autocomplete="off"
        value="${escapeHtml(regionSearchQuery)}"
      />
    </label>
  `;
}

function renderOrgStage() {
  if (vscodeApi !== null && orgsLoadingState === 'loading') {
    return `
      <section class="group-card org-stage" aria-label="Organization list" data-stage-id="org">
        <div class="group-head"><h2>Organization</h2></div>
        <p class="stage-loading" aria-live="polite">Loading organizations&#8230;</p>
      </section>
    `;
  }

  if (vscodeApi !== null && orgsLoadingState === 'error') {
    return `
      <section class="group-card org-stage" aria-label="Organization list" data-stage-id="org">
        <div class="group-head"><h2>Organization</h2></div>
        <p class="stage-error" role="alert">${escapeHtml(orgsErrorMessage)}</p>
      </section>
    `;
  }

  const activeOrgs = resolveActiveOrgOptions();
  const isCollapsed = selectedOrgId.length > 0;
  const visibleOrgs = isCollapsed ? activeOrgs : filterOrgOptions(activeOrgs);
  const searchInputMarkup = isCollapsed ? '' : renderOrgSearchInput();
  const orgButtons = renderOrgButtons(visibleOrgs, isCollapsed);

  return `
    <section class="group-card org-stage" aria-label="Organization list" data-stage-id="org">
      <div class="group-head">
        <h2>Organization</h2>
        ${searchInputMarkup}
        <button
          type="button"
          class="stage-reset"
          data-action="reset-org-selection"
          ${selectedOrgId.length === 0 ? 'disabled' : ''}
        >
          Change
        </button>
      </div>
      <div class="org-picker">
        ${orgButtons}
      </div>
    </section>
  `;
}

function resolveActiveOrgOptions() {
  if (vscodeApi !== null && liveOrgOptions !== null) {
    return liveOrgOptions.map((org) => ({ id: org.guid, name: org.name }));
  }

  return resolveCurrentMockOrgOptions().map((org) => ({ id: org.id, name: org.name }));
}

function filterOrgOptions(orgOptions) {
  const normalizedQuery = orgSearchQuery.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return orgOptions;
  }

  return orgOptions.filter((org) => {
    return org.name.toLowerCase().includes(normalizedQuery);
  });
}

function filterRegionOptions(regions) {
  const normalizedQuery = regionSearchQuery.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return regions;
  }

  return regions.filter((region) => {
    return (
      region.name.toLowerCase().includes(normalizedQuery) ||
      region.code.toLowerCase().includes(normalizedQuery)
    );
  });
}

function renderOrgSearchInput() {
  return `
    <label class="group-head-search-wrapper search-input-with-icon">
      <span class="search-input-icon" aria-hidden="true">&#128269;</span>
      <input
        type="search"
        class="group-head-search-input"
        data-role="org-search"
        aria-label="Search organizations"
        placeholder="Search..."
        autocomplete="off"
        value="${escapeHtml(orgSearchQuery)}"
      />
    </label>
  `;
}

function renderOrgButtons(orgOptions, isCollapsed) {
  return orgOptions
    .map((org) => {
      const isSelected = org.id === selectedOrgId;
      const isHidden = isCollapsed && !isSelected;
      return `
        <button
          type="button"
          class="org-option${isSelected ? ' is-selected' : ''}${isHidden ? ' is-hidden' : ''}"
          data-org-id="${escapeHtml(org.id)}"
          data-testid="org-option"
          aria-pressed="${isSelected}"
          aria-hidden="${isHidden}"
        >
          ${escapeHtml(org.name)}
        </button>
      `;
    })
    .join('');
}

function updateOrgSearchResults() {
  const picker = appElement.querySelector('[data-stage-id="org"] .org-picker');
  if (!(picker instanceof HTMLElement)) {
    return;
  }

  picker.innerHTML = renderOrgButtons(filterOrgOptions(resolveActiveOrgOptions()), false);
}

function updateRegionSearchResults() {
  const layout = appElement.querySelector('[data-stage-id="region"] .region-layout');
  if (!(layout instanceof HTMLElement)) {
    return;
  }

  const group = groupLookup.get(selectedGroupId);
  if (group === undefined) {
    return;
  }

  const isCollapsed = selectedRegionId.length > 0;
  const orderedRegions = resolveOrderedRegions(group);
  const filteredRegions = isCollapsed ? orderedRegions : filterRegionOptions(orderedRegions);
  layout.innerHTML = filteredRegions
    .map((region) => {
      const isSelected = region.id === selectedRegionId;
      const isHidden = isCollapsed && !isSelected;
      const isDisabled = isRegionDisabled(region.id) && !isSelected;
      return `
        <button
          type="button"
          class="region-option${isSelected ? ' is-selected' : ''}${isHidden ? ' is-hidden' : ''}${isDisabled ? ' is-disabled' : ''}"
          data-region-id="${region.id}"
          aria-pressed="${isSelected}"
          aria-hidden="${isHidden}"
          aria-disabled="${isDisabled}"
          ${isDisabled ? 'disabled' : ''}
        >
          <span class="region-code">${region.code}</span>
          <span class="region-name">${region.name}</span>
        </button>
      `;
    })
    .join('');
}

function renderSpaceStage() {
  if (vscodeApi !== null && spacesLoadingState === 'loading') {
    return `
      <section class="group-card space-stage" aria-label="Space list" data-stage-id="space">
        <div class="group-head"><h2>Choose Space</h2></div>
        <p class="stage-loading" aria-live="polite">Loading spaces&#8230;</p>
      </section>
    `;
  }

  if (vscodeApi !== null && spacesLoadingState === 'error') {
    return `
      <section class="group-card space-stage" aria-label="Space list" data-stage-id="space">
        <div class="group-head"><h2>Choose Space</h2></div>
        <p class="stage-error" role="alert">${escapeHtml(spacesErrorMessage)}</p>
      </section>
    `;
  }

  const spaces = resolveSelectableSpaces();
  const isCollapsed = selectedSpaceId.length > 0;
  const spaceButtons = spaces
    .map((space) => {
      const isSelected = space === selectedSpaceId;
      const isHidden = isCollapsed && !isSelected;
      return `
        <button
          type="button"
          class="space-option${isSelected ? ' is-selected' : ''}${isHidden ? ' is-hidden' : ''}"
          data-space-id="${escapeHtml(space)}"
          aria-pressed="${isSelected}"
          aria-hidden="${isHidden}"
        >
          ${escapeHtml(space)}
        </button>
      `;
    })
    .join('');

  return `
    <section class="group-card space-stage" aria-label="Space list" data-stage-id="space">
      <div class="group-head">
        <h2>Choose Space</h2>
        <button
          type="button"
          class="stage-reset"
          data-action="reset-space-selection"
          ${selectedSpaceId.length === 0 ? 'disabled' : ''}
        >
          Change
        </button>
      </div>
      <div class="space-picker">
        ${spaceButtons}
      </div>
    </section>
  `;
}

function renderConfirmPanel() {
  const selectedRegion = resolveSelectedRegion();
  const selectedOrg = resolveSelectedOrg();
  const isReady = selectedRegion !== undefined && selectedOrg !== undefined && selectedSpaceId.length > 0;

  return `
    <div class="confirm-stage" aria-label="Region confirmation">
      <button
        type="button"
        class="confirm-button"
        data-action="confirm-region"
        ${isReady ? '' : 'disabled'}
      >
        Confirm Scope
      </button>
    </div>
  `;
}

function renderEmptyRegionPanel() {
  return `
    <section class="group-card empty-panel" aria-live="polite">
      <p class="empty-title">No area selected yet</p>
      <p class="empty-description">Pick an area above to reveal region options.</p>
    </section>
  `;
}
