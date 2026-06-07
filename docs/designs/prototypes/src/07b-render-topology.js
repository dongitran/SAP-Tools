
function applyCfTopologySnapshot(rawTopology) {
  const wasReady = cfTopology.ready === true;
  const previousSelectionMode = activeSelectionMode;

  if (!isRecord(rawTopology)) {
    cfTopology = { ready: false, accounts: [] };
  } else {
    const ready = rawTopology.ready === true;
    const rawAccounts = Array.isArray(rawTopology.accounts)
      ? rawTopology.accounts
      : [];
    const accounts = rawAccounts
      .filter(
        (account) =>
          isRecord(account) &&
          typeof account.regionKey === 'string' &&
          account.regionKey.length > 0 &&
          typeof account.orgName === 'string' &&
          account.orgName.length > 0
      )
      .map((account) => ({
        regionKey: account.regionKey,
        regionLabel:
          typeof account.regionLabel === 'string' && account.regionLabel.length > 0
            ? account.regionLabel
            : account.regionKey,
        apiEndpoint:
          typeof account.apiEndpoint === 'string' ? account.apiEndpoint : '',
        orgName: account.orgName,
        spaces: Array.isArray(account.spaces)
          ? account.spaces.filter(
              (space) => typeof space === 'string' && space.length > 0
            )
          : [],
      }));
    cfTopology = { ready, accounts };
  }

  if (!wasReady && cfTopology.ready && cfTopology.accounts.length > 0) {
    activeSelectionMode = 'quick';
  }

  if (!wasReady && cfTopology.ready && cfTopology.accounts.length === 0) {
    activeSelectionMode = 'custom';
  }

  reconcileQuickSelectionWithTopology();

  if (mode !== 'selection') {
    return;
  }

  if (wasReady !== cfTopology.ready || previousSelectionMode !== activeSelectionMode) {
    renderPrototype();
    return;
  }

  if (activeSelectionMode === 'quick' && isQuickSelectionPanelMounted()) {
    updateQuickPanelInPlace();
    return;
  }

  if (!isSelectionShellMounted()) {
    renderPrototype();
  }
}

function updateTopologySearchInPlace() {
  const slot = appElement.querySelector('[data-stage-slot="area"]');
  if (!(slot instanceof HTMLElement)) {
    return;
  }

  const existingPanel = slot.querySelector('[data-role="topology-search-panel"]');
  const newMarkup = renderTopologyOrgSearchPanel();

  if (newMarkup.length === 0) {
    if (existingPanel instanceof HTMLElement) {
      existingPanel.remove();
    }
    return;
  }

  if (existingPanel instanceof HTMLElement) {
    const focusedRole =
      document.activeElement instanceof HTMLInputElement
        ? document.activeElement.dataset.role ?? ''
        : '';
    const focusedSelectionStart =
      document.activeElement instanceof HTMLInputElement
        ? document.activeElement.selectionStart
        : null;
    existingPanel.outerHTML = newMarkup;
    if (focusedRole === 'topology-org-search') {
      const refocused = appElement.querySelector(
        '[data-role="topology-org-search"]'
      );
      if (refocused instanceof HTMLInputElement) {
        refocused.focus();
        if (focusedSelectionStart !== null) {
          refocused.setSelectionRange(focusedSelectionStart, focusedSelectionStart);
        }
      }
    }
    return;
  }

  slot.insertAdjacentHTML('afterbegin', newMarkup);
}

function applyTopologyScopeResolved(scope) {
  if (!isRecord(scope)) {
    return;
  }

  const regionId = typeof scope.regionId === 'string' ? scope.regionId.trim() : '';
  const orgGuid = typeof scope.orgGuid === 'string' ? scope.orgGuid.trim() : '';
  const orgName = typeof scope.orgName === 'string' ? scope.orgName.trim() : '';
  if (regionId.length === 0 || orgGuid.length === 0) {
    topologyPickInProgress = false;
    return;
  }

  const region = regionLookup.get(regionId);
  const groupId = regionGroupLookup.get(regionId);
  if (region === undefined || groupId === undefined) {
    topologyPickInProgress = false;
    return;
  }

  selectedGroupId = groupId;
  selectedRegionId = region.id;
  selectedOrgId = orgGuid;
  selectedOrgName = orgName;
  selectedSpaceId = '';
  orgSearchQuery = '';
  regionSearchQuery = '';
  topologyPickInProgress = false;

  if (mode !== 'selection') {
    mode = 'selection';
    renderPrototype();
    return;
  }

  rerenderSelectionStageSlotsWithMotion(SELECTION_STAGE_SLOT_IDS);
}

function postTopologyOrgSelection(regionKey, orgName) {
  if (vscodeApi === null) {
    const org = resolvePrototypeTopologyOrg(regionKey, orgName);
    if (org === undefined) {
      topologyPickInProgress = false;
      return;
    }
    applyTopologyScopeResolved({
      regionId: regionKey,
      orgGuid: org.id,
    });
    return;
  }

  vscodeApi.postMessage({
    type: TOPOLOGY_ORG_SELECTED_MESSAGE_TYPE,
    payload: { regionKey, orgName },
  });
}

function filterTopologyOrgEntries() {
  const accounts = Array.isArray(cfTopology.accounts) ? cfTopology.accounts : [];
  const query = topologyOrgSearchQuery.trim().toLowerCase();
  if (query.length === 0) {
    return accounts.slice(0, TOPOLOGY_ORG_SEARCH_LIMIT);
  }
  const matches = [];
  for (const account of accounts) {
    const haystack = [
      account.orgName,
      account.regionKey,
      account.regionLabel,
    ]
      .join(' ')
      .toLowerCase();
    if (haystack.indexOf(query) !== -1) {
      matches.push(account);
    }
    if (matches.length >= TOPOLOGY_ORG_SEARCH_LIMIT) {
      break;
    }
  }
  return matches;
}

function isKnownTopologyRegion(regionKey) {
  return regionLookup.has(regionKey);
}

function resolveInitialCfTopology() {
  if (vscodeApi !== null) {
    return { ready: false, accounts: [] };
  }

  const accounts = [
    ...buildPrototypeTopologyAccounts('us10', 'US East (VA) - AWS (us10)', DEFAULT_ORG_OPTIONS),
    ...buildPrototypeTopologyAccounts('br10', 'Brazil (Sao Paulo) - AWS (br10)', BR10_ORG_OPTIONS),
  ];
  accounts.sort((left, right) => {
    const orgCompare = left.orgName.localeCompare(right.orgName);
    if (orgCompare !== 0) return orgCompare;
    return left.regionKey.localeCompare(right.regionKey);
  });
  return { ready: accounts.length > 0, accounts };
}

function resolveInitialSelectionMode() {
  return cfTopology.ready === true && cfTopology.accounts.length > 0
    ? 'quick'
    : 'custom';
}

function buildPrototypeTopologyAccounts(regionKey, regionLabel, orgOptions) {
  return orgOptions.map((org) => ({
    regionKey,
    regionLabel,
    apiEndpoint: `https://api.cf.${regionKey}.hana.ondemand.com`,
    orgName: org.name,
    spaces: org.spaces,
  }));
}

function resolvePrototypeTopologyOrg(regionKey, orgName) {
  const orgOptions = regionKey === 'br10' ? BR10_ORG_OPTIONS : DEFAULT_ORG_OPTIONS;
  return orgOptions.find((org) => org.name === orgName);
}

function findTopologyAccount(regionKey, orgName) {
  const accounts = Array.isArray(cfTopology.accounts) ? cfTopology.accounts : [];
  return accounts.find(
    (account) => account.regionKey === regionKey && account.orgName === orgName
  );
}

function resetQuickSelectionState() {
  quickPickRegionKey = '';
  quickPickOrgName = '';
  quickPickOrgSpaces = [];
  quickPickSpaceName = '';
  quickConfirmInProgress = false;
  quickConfirmError = '';
}

function reconcileQuickSelectionWithTopology() {
  if (quickPickRegionKey.length === 0 || quickPickOrgName.length === 0) {
    return;
  }

  const account = findTopologyAccount(quickPickRegionKey, quickPickOrgName);
  if (account === undefined) {
    resetQuickSelectionState();
    return;
  }

  quickPickOrgSpaces = Array.isArray(account.spaces) ? [...account.spaces] : [];
  if (
    quickPickSpaceName.length > 0 &&
    !quickPickOrgSpaces.includes(quickPickSpaceName)
  ) {
    quickPickSpaceName = '';
  }
  if (quickPickSpaceName.length === 0 && quickPickOrgSpaces.length === 1) {
    quickPickSpaceName = quickPickOrgSpaces[0];
  }
}

function isQuickSelectionPanelMounted() {
  return appElement.querySelector('.selection-quick-panel') instanceof HTMLElement;
}

function updateQuickPanelInPlace() {
  const panel = appElement.querySelector('.selection-quick-panel');
  if (!(panel instanceof HTMLElement)) {
    renderPrototype();
    return;
  }

  const focusedSearch =
    document.activeElement instanceof HTMLInputElement &&
    document.activeElement.dataset.role === 'topology-org-search';
  const selectionStart = focusedSearch ? document.activeElement.selectionStart : null;
  const selectionEnd = focusedSearch ? document.activeElement.selectionEnd : null;
  panel.innerHTML = renderQuickOrgPanel();

  if (!focusedSearch) {
    return;
  }

  const refocused = panel.querySelector('[data-role="topology-org-search"]');
  if (refocused instanceof HTMLInputElement) {
    refocused.focus();
    if (selectionStart !== null && selectionEnd !== null) {
      refocused.setSelectionRange(selectionStart, selectionEnd);
    }
  }
}

function updateQuickOrgSearchResultsInPlace() {
  const panel = appElement.querySelector('.selection-quick-panel');
  if (!(panel instanceof HTMLElement) || quickPickOrgName.length > 0) {
    updateQuickPanelInPlace();
    return;
  }

  const nextMarkup = renderQuickOrgResultsMarkup(filterTopologyOrgEntries());
  const currentResults = panel.querySelector('[data-role="topology-org-results"]');
  const currentEmpty = panel.querySelector('[data-role="topology-org-empty"]');
  const currentNode = currentResults ?? currentEmpty;
  if (currentNode instanceof HTMLElement) {
    currentNode.outerHTML = nextMarkup;
    return;
  }

  panel.insertAdjacentHTML('beforeend', nextMarkup);
}

function postQuickScopeConfirm(regionKey, orgName, spaceName) {
  if (vscodeApi === null) {
    const org = resolvePrototypeTopologyOrg(regionKey, orgName);
    if (org === undefined) {
      quickConfirmInProgress = false;
      quickConfirmError = 'Could not confirm scope. Try Custom tab.';
      updateQuickPanelInPlace();
      return;
    }

    quickConfirmInProgress = false;
    applyRestoredConfirmedScope({
      regionId: regionKey,
      orgGuid: org.id,
      spaceName,
    });
    return;
  }

  vscodeApi.postMessage({
    type: QUICK_SCOPE_CONFIRM_MESSAGE_TYPE,
    payload: { regionKey, orgName, spaceName },
  });
}

function renderTopologyOrgRow(account, isSelected) {
  const knownRegion = isKnownTopologyRegion(account.regionKey);
  const spaceCount = Array.isArray(account.spaces) ? account.spaces.length : 0;
  const meta =
    spaceCount === 1
      ? `${escapeHtml(account.regionKey)} - 1 space`
      : `${escapeHtml(account.regionKey)} - ${String(spaceCount)} spaces`;
  const disabledAttr = knownRegion ? '' : ' disabled aria-disabled="true" data-disabled="true"';
  const disabledClass = knownRegion ? '' : ' is-disabled';

  return `
    <button
      type="button"
      class="topology-org-row${disabledClass}${isSelected ? ' is-selected' : ''}"
      data-topology-region-key="${escapeHtml(account.regionKey)}"
      data-topology-org="${escapeHtml(account.orgName)}"
      aria-label="Quick org search pick ${escapeHtml(account.orgName)} in ${escapeHtml(account.regionKey)}"
      aria-pressed="${isSelected}"
      ${disabledAttr}
      title="${escapeHtml(account.orgName)} - ${escapeHtml(account.regionLabel)}"
    >
      <span class="topology-org-name">${escapeHtml(account.orgName)}</span>
      <span class="topology-org-meta">${meta}</span>
    </button>
  `;
}

function renderTopologyOrgSearchPanel() {
  if (!cfTopology.ready) {
    return '';
  }
  if (!Array.isArray(cfTopology.accounts) || cfTopology.accounts.length === 0) {
    return '';
  }

  const filtered = filterTopologyOrgEntries();
  let resultsMarkup = '';
  if (filtered.length === 0) {
    const queryLabel = escapeHtml(topologyOrgSearchQuery.trim());
    resultsMarkup = `
      <div class="topology-org-empty" data-role="topology-org-empty">
        No org matches "${queryLabel}"
      </div>
    `;
  } else {
    resultsMarkup = filtered
      .map((account) => {
        const selectedOrg = resolveSelectedOrg();
        const isSelected =
          selectedRegionId === account.regionKey && selectedOrg?.name === account.orgName;
        return renderTopologyOrgRow(account, isSelected);
      })
      .join('');
    resultsMarkup = `<div class="topology-org-results" data-role="topology-org-results">${resultsMarkup}</div>`;
  }

  return `
    <section class="group-card topology-org-panel" data-role="topology-search-panel" aria-label="Quick org search">
      <div class="group-head">
        <h2>Quick Org Search</h2>
      </div>
      <p class="topology-org-hint">Search across all synced regions and jump straight to space selection.</p>
      <div class="topology-org-search-row">
        <input
          type="search"
          class="topology-org-search-input"
          data-role="topology-org-search"
          placeholder="Type org name, region key, or label..."
          autocomplete="off"
          spellcheck="false"
          value="${escapeHtml(topologyOrgSearchQuery)}"
        />
      </div>
      ${resultsMarkup}
    </section>
  `;
}

function applyRestoredConfirmedScope(scope) {
  const regionId =
    typeof scope.regionId === 'string' ? scope.regionId.trim() : '';
  const orgGuid = typeof scope.orgGuid === 'string' ? scope.orgGuid.trim() : '';
  const orgName = typeof scope.orgName === 'string' ? scope.orgName.trim() : '';
  const spaceName =
    typeof scope.spaceName === 'string' ? scope.spaceName.trim() : '';

  if (regionId.length === 0 || orgGuid.length === 0 || spaceName.length === 0) {
    return;
  }

  const selectedRegion = regionLookup.get(regionId);
  const selectedGroupIdFromRegion = regionGroupLookup.get(regionId);
  if (selectedRegion === undefined || selectedGroupIdFromRegion === undefined) {
    return;
  }

  selectedGroupId = selectedGroupIdFromRegion;
  selectedRegionId = selectedRegion.id;
  selectedOrgId = orgGuid;
  selectedOrgName = orgName;
  selectedSpaceId = spaceName;
  mode = 'workspace';
  activeTabId = 'logs';
  statusMessage = '';
  resetQuickSelectionState();

  if (isWorkspaceLogsMounted()) {
    refreshWorkspaceLogsView();
    return;
  }

  if (isWorkspaceAppsMounted()) {
    refreshWorkspaceAppsView();
    return;
  }

  renderPrototype();
}
