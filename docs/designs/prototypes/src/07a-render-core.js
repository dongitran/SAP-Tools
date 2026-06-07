function renderPrototype() {
  const groupsContainer = appElement.querySelector('.groups');
  const groupsScrollTop = groupsContainer ? groupsContainer.scrollTop : 0;
  const pkgList = appElement.querySelector('.detected-pkg-list');
  const pkgListScrollTop = pkgList ? pkgList.scrollTop : 0;

  const shellMarkup = resolveShellMarkupByMode();

  appElement.innerHTML = `
    <section class="prototype-shell select-style-${activeDesign.selectStyle} mode-${mode}">
      ${shellMarkup}
    </section>
  `;

  if (groupsScrollTop > 0) {
    const newGroups = appElement.querySelector('.groups');
    if (newGroups) newGroups.scrollTop = groupsScrollTop;
  }
  if (pkgListScrollTop > 0) {
    const newPkgList = appElement.querySelector('.detected-pkg-list');
    if (newPkgList) newPkgList.scrollTop = pkgListScrollTop;
  }
  queueSqlTableNameTruncation();

  if (mode === 'selection') {
    updateSelectionStageSlots(SELECTION_STAGE_SLOT_IDS);
    return;
  }
}

function resolveShellMarkupByMode() {
  if (mode === 'selection') {
    return renderSelectionScreen();
  }

  if (mode === 'settings') {
    return renderSettingsScreen();
  }

  return renderWorkspaceScreen();
}

function rerenderSelectionStageSlotsWithMotion(stageSlotIds) {
  if (mode !== 'selection') {
    renderPrototype();
    return;
  }

  if (!isSelectionShellMounted()) {
    renderPrototype();
    playSelectionMotion();
    return;
  }

  updateSelectionStageSlots(stageSlotIds);
  playSelectionMotion();
}

function queueSelectionMotion(optionElement, selector) {
  const sourceRect = optionElement.getBoundingClientRect();
  pendingSelectionMotion = {
    selector,
    left: sourceRect.left,
    top: sourceRect.top,
  };
}

function playSelectionMotion() {
  if (pendingSelectionMotion === null) {
    return;
  }

  if (prefersReducedMotion()) {
    pendingSelectionMotion = null;
    return;
  }

  const target = appElement.querySelector(pendingSelectionMotion.selector);
  if (!(target instanceof HTMLElement)) {
    pendingSelectionMotion = null;
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const dx = pendingSelectionMotion.left - targetRect.left;
  const dy = pendingSelectionMotion.top - targetRect.top;

  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
    pendingSelectionMotion = null;
    return;
  }

  target.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: 'translate(0, 0)' },
    ],
    {
      duration: 280,
      easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)',
      fill: 'both',
    }
  );

  pendingSelectionMotion = null;
}

function prefersReducedMotion() {
  if (typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function buildDataSelector(attribute, value) {
  const escapedValue =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : value.replaceAll('"', '\\"');

  return `[${attribute}="${escapedValue}"]`;
}

function resolveVscodeApi() {
  if (typeof acquireVsCodeApi !== 'function') {
    return null;
  }

  return acquireVsCodeApi();
}

function requestInitialState() {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: REQUEST_INITIAL_STATE_MESSAGE_TYPE,
  });
  vscodeApi.postMessage({
    type: LOCAL_REGISTRY_STATUS_MESSAGE_TYPE,
  });
}

function postConfirmScope() {
  if (vscodeApi === null) {
    return;
  }

  const selectedRegion = resolveSelectedRegion();
  const selectedOrg = resolveSelectedOrg();
  const selectedGroup = groupLookup.get(selectedGroupId);
  const normalizedSpaceName = selectedSpaceId.trim();

  if (
    selectedRegion === undefined ||
    selectedOrg === undefined ||
    selectedGroup === undefined ||
    normalizedSpaceName.length === 0
  ) {
    return;
  }

  vscodeApi.postMessage({
    type: CONFIRM_SCOPE_MESSAGE_TYPE,
    scope: {
      regionId: selectedRegion.id,
      regionCode: selectedRegion.code,
      regionName: selectedRegion.name,
      regionArea: selectedGroup.label,
      orgGuid: selectedOrgId,
      orgName: selectedOrg.name,
      spaceName: normalizedSpaceName,
    },
  });
}

function postRegionSelection(region, areaLabel) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: REGION_SELECTED_MESSAGE_TYPE,
    region: {
      id: region.id,
      name: region.name,
      code: region.code,
      area: areaLabel,
    },
  });
}

function postOrgSelection(orgGuid, orgName) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: ORG_SELECTED_MESSAGE_TYPE,
    org: { guid: orgGuid, name: orgName },
  });
}

function postSpaceSelection(spaceName, orgGuid, orgName) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: SPACE_SELECTED_MESSAGE_TYPE,
    scope: {
      spaceName,
      orgGuid,
      orgName,
    },
  });
}

function requestAppsForSelectedScope(spaceName) {
  if (vscodeApi === null) {
    return;
  }

  const normalizedSpaceName = spaceName.trim();
  if (normalizedSpaceName.length === 0 || selectedOrgId.length === 0) {
    return;
  }

  liveAppOptions = null;
  appsErrorMessage = '';
  appsLoadingState = 'loading';

  const orgName = resolveSelectedOrgName() || selectedOrgId;
  postSpaceSelection(normalizedSpaceName, selectedOrgId, orgName);
}

function postOpenCfLogsPanel() {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: OPEN_CF_LOGS_PANEL_MESSAGE_TYPE,
  });
}

function postActiveAppsChanged(appNames) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: ACTIVE_APPS_CHANGED_MESSAGE_TYPE,
    appNames,
  });
}

function postSelectServiceFolderMapping(appId, folderPath) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: SELECT_SERVICE_FOLDER_MAPPING_MESSAGE_TYPE,
    appId,
    folderPath,
  });
}

function postSyncIntervalUpdate(syncHours) {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: UPDATE_SYNC_INTERVAL_MESSAGE_TYPE,
    syncIntervalHours: syncHours,
  });
}

function postSyncNow() {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: SYNC_NOW_MESSAGE_TYPE,
  });
}

function postLogout() {
  if (vscodeApi === null) {
    return;
  }

  vscodeApi.postMessage({
    type: LOGOUT_MESSAGE_TYPE,
  });
}
