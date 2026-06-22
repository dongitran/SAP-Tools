
function filterServiceExportRows(mappingRows) {
  const keyword = serviceExportSearchKeyword.trim().toLowerCase();
  if (keyword.length === 0) {
    return mappingRows;
  }

  return mappingRows.filter((mapping) => {
    const appName = mapping.appName.toLowerCase();
    const folderPath = mapping.folderPath.toLowerCase();
    return appName.includes(keyword) || folderPath.includes(keyword);
  });
}

function normalizeServiceFolderMappings(rawMappings) {
  const normalizedMappings = [];
  for (const rawMapping of rawMappings) {
    if (!isRecord(rawMapping)) {
      continue;
    }
    const appIdRaw = typeof rawMapping.appId === 'string' ? rawMapping.appId.trim() : '';
    const appNameRaw = typeof rawMapping.appName === 'string' ? rawMapping.appName.trim() : '';
    const folderPathRaw =
      typeof rawMapping.folderPath === 'string' ? rawMapping.folderPath.trim() : '';
    const matchTypeRaw =
      typeof rawMapping.matchType === 'string' ? rawMapping.matchType.trim() : '';
    const rawCandidateFolderPaths = Array.isArray(rawMapping.candidateFolderPaths)
      ? rawMapping.candidateFolderPaths
      : [];
    const candidateFolderPaths = rawCandidateFolderPaths
      .filter((pathValue) => typeof pathValue === 'string')
      .map((pathValue) => pathValue.trim())
      .filter((pathValue) => pathValue.length > 0);
    const hasConflict =
      rawMapping.hasConflict === true ||
      matchTypeRaw === 'ambiguous' ||
      candidateFolderPaths.length > 1;
    const appId = appIdRaw.length > 0 ? appIdRaw : appNameRaw;
    if (appId.length === 0 || appNameRaw.length === 0) {
      continue;
    }
    const normalizedFolderPath = folderPathRaw.length > 0 ? folderPathRaw : '';
    const isMapped =
      normalizedFolderPath.length > 0 &&
      (!hasConflict || candidateFolderPaths.includes(normalizedFolderPath));
    normalizedMappings.push({
      appId,
      appName: appNameRaw,
      folderPath: isMapped ? normalizedFolderPath : '',
      isMapped,
      hasConflict,
      candidateFolderPaths,
      matchType: matchTypeRaw.length > 0 ? matchTypeRaw : 'none',
    });
  }
  return normalizedMappings;
}

function formatServiceMapPathLabel(pathValue) {
  const normalizedPath = typeof pathValue === 'string' ? pathValue.trim() : '';
  if (normalizedPath.length === 0) {
    return '';
  }

  if (normalizedPath.length <= SERVICE_MAP_PATH_LABEL_MAX_CHARS) {
    return normalizedPath;
  }

  const suffixLength = SERVICE_MAP_PATH_LABEL_MAX_CHARS - SERVICE_MAP_PATH_LABEL_ELLIPSIS.length;
  if (suffixLength <= 0) {
    return SERVICE_MAP_PATH_LABEL_ELLIPSIS;
  }

  return `${SERVICE_MAP_PATH_LABEL_ELLIPSIS}${normalizedPath.slice(-suffixLength)}`;
}

function buildMockServiceFolderMappings(rootFolderPath, availableApps) {
  return availableApps.map((app, index) => {
    const shouldMap = index % 3 !== 2;
    const normalizedFolderName = app.name.replaceAll('-', '_');
    return {
      appId: app.id,
      appName: app.name,
      folderPath: shouldMap ? `${rootFolderPath}/${normalizedFolderName}` : '',
      isMapped: shouldMap,
      hasConflict: false,
      candidateFolderPaths: shouldMap ? [`${rootFolderPath}/${normalizedFolderName}`] : [],
      matchType: normalizedFolderName === app.name ? 'exact' : 'underscore',
    };
  });
}

function clearServiceMappingsForScope() {
  serviceFolderMappings = [];
  selectedServiceExportAppId = '';
  serviceFolderScanInProgress = false;
  serviceExportInProgress = false;
  serviceExportStatusMessage = '';
  serviceExportStatusTone = 'info';
}

function pruneSelectedServiceExportAppId() {
  if (selectedServiceExportAppId.length === 0) {
    return;
  }
  const mappedIds = new Set(
    serviceFolderMappings
      .filter((mapping) => mapping.isMapped)
      .map((mapping) => mapping.appId)
  );
  if (!mappedIds.has(selectedServiceExportAppId)) {
    selectedServiceExportAppId = '';
  }
}

function refreshServiceMappingsAfterAppsLoaded() {
  const availableApps = resolveCurrentSpaceApps();

  if (localServiceRootFolderPath.length === 0) {
    clearServiceMappingsForScope();
    serviceExportStatusTone = 'error';
    serviceExportStatusMessage = 'Select a local root folder before scanning service mappings.';
    return;
  }

  if (availableApps.length === 0) {
    serviceFolderScanInProgress = false;
    serviceExportInProgress = false;
    serviceExportStatusTone = 'info';
    serviceExportStatusMessage = 'No running services available in this space.';
    return;
  }

  if (vscodeApi === null) {
    serviceFolderMappings = buildMockServiceFolderMappings(
      localServiceRootFolderPath,
      availableApps
    );
    pruneSelectedServiceExportAppId();
    return;
  }

  serviceFolderScanInProgress = true;
  serviceExportStatusTone = 'info';
  serviceExportStatusMessage = 'Scanning local folders for service mapping...';
  vscodeApi.postMessage({
    type: REFRESH_SERVICE_FOLDER_MAPPINGS_MESSAGE_TYPE,
    rootFolderPath: localServiceRootFolderPath,
    appNames: availableApps.map((app) => app.name),
  });
}

function triggerServiceExport() {
  const selectedMapping = serviceFolderMappings.find(
    (mapping) => mapping.appId === selectedServiceExportAppId && mapping.isMapped
  );
  if (selectedMapping === undefined) {
    serviceExportStatusTone = 'error';
    serviceExportStatusMessage = 'Choose one mapped service before exporting.';
    return true;
  }

  const basePayload = {
    appId: selectedMapping.appId,
    appName: selectedMapping.appName,
    rootFolderPath: localServiceRootFolderPath,
  };

  serviceExportInProgress = true;
  serviceExportStatusTone = 'info';
  serviceExportStatusMessage = 'Exporting artifacts from Cloud Foundry...';

  if (vscodeApi === null) {
    serviceExportInProgress = false;
    serviceExportStatusTone = 'success';
    serviceExportStatusMessage =
      `Export completed for "${selectedMapping.appName}". 6 files: default-env.json, pnpm-lock.yaml, package.json, .npmrc, .cdsrc.json, .csdrc.json.`;
    return true;
  }

  vscodeApi.postMessage({
    type: EXPORT_SERVICE_ARTIFACTS_MESSAGE_TYPE,
    ...basePayload,
  });
  return true;
}

function triggerSqlToolsConfigExport() {
  const selectedMapping = serviceFolderMappings.find(
    (mapping) => mapping.appId === selectedServiceExportAppId && mapping.isMapped
  );
  if (selectedMapping === undefined) {
    serviceExportStatusTone = 'error';
    serviceExportStatusMessage = 'Choose one mapped service before exporting SQLTools config.';
    refreshUiAfterServiceExportStateChange();
    return true;
  }

  const basePayload = {
    appId: selectedMapping.appId,
    appName: selectedMapping.appName,
    rootFolderPath: localServiceRootFolderPath,
  };

  serviceExportInProgress = true;
  serviceExportStatusTone = 'info';
  serviceExportStatusMessage = `Exporting SQLTools config for ${selectedMapping.appName}...`;

  if (vscodeApi === null) {
    serviceExportInProgress = false;
    serviceExportStatusTone = 'success';
    serviceExportStatusMessage =
      `SQLTools connection "${selectedMapping.appName} (prototype)" exported.`;
    refreshUiAfterServiceExportStateChange();
    return true;
  }

  refreshUiAfterServiceExportStateChange();
  vscodeApi.postMessage({
    type: EXPORT_SQLTOOLS_CONFIG_MESSAGE_TYPE,
    ...basePayload,
  });
  return true;
}

function resolveActiveAppNamesByIds(activeAppIds) {
  const appNameById = new Map(resolveCurrentSpaceApps().map((app) => [app.id, app.name]));
  const names = [];
  for (const appId of activeAppIds) {
    const appName = appNameById.get(appId);
    if (typeof appName === 'string' && appName.length > 0) {
      names.push(appName);
    }
  }
  return names;
}

function buildFallbackAppNames(spaceKey) {
  const orgName = resolveSelectedOrgName() || 'app-services';
  const orgSlug = orgName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  const suffix = spaceKey.length > 0 ? spaceKey : 'space';
  return [
    `${orgSlug}-${suffix}-api`,
    `${orgSlug}-${suffix}-worker`,
    `${orgSlug}-${suffix}-jobs`,
  ];
}

function resetWorkspaceLoggingState() {
  resetActiveAppLoggingState();
  clearServiceMappingsForScope();
  resetSqlWorkbenchState();
}

function resetSqlWorkbenchState() {
  hanaServiceOptions = null;
  selectedHanaServiceId = '';
  hanaQueryStatusMessage = '';
  hanaQueryStatusTone = 'info';
  sqlTableSearchKeyword = '';
  hanaTablesByServiceId = new Map();
  hanaTablesLoadingByServiceId = new Map();
  hanaTablesErrorByServiceId = new Map();
  hanaTunnelByServiceId = new Map();
  hanaSqlResultPreviewState = null;
  hanaSqlResultExportMenuOpen = false;
}

function resetActiveAppLoggingState() {
  const hadActiveApps = activeAppLogIds.length > 0;
  const hadPausedApps = pausedAppLogIds.length > 0;
  selectedAppLogIds = [];
  activeAppLogIds = [];
  pausedAppLogIds = [];
  eventOpeningAppId = '';
  statusMessage = '';
  if (hadActiveApps) {
    postActiveAppsChanged([]);
  }
  if (hadPausedApps) {
    postPausedAppsChanged([]);
  }
}

function pruneSelectedAppIds() {
  const allowedAppIds = new Set(resolveCurrentSpaceApps().map((app) => app.id));
  selectedAppLogIds = selectedAppLogIds.filter((appId) => allowedAppIds.has(appId));
  activeAppLogIds = activeAppLogIds.filter((appId) => allowedAppIds.has(appId));
  pausedAppLogIds = pausedAppLogIds.filter((appId) => activeAppLogIds.includes(appId));
  postActiveAppsChanged(resolveActiveAppNamesByIds(activeAppLogIds));
  postPausedAppsChanged(resolveActiveAppNamesByIds(pausedAppLogIds));
}

function formatNow() {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
