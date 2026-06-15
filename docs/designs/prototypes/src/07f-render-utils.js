function getFilteredLogs() {
  const keyword = searchKeyword.trim().toLowerCase();

  return logsData.filter((entry) => {
    if (selectedLevel !== 'all' && entry.level !== selectedLevel) {
      return false;
    }

    if (keyword.length === 0) {
      return true;
    }

    const haystack = `${entry.app} ${entry.instance} ${entry.message}`.toLowerCase();
    return haystack.includes(keyword);
  });
}

function resolveSelectedRegion() {
  return regionLookup.get(selectedRegionId);
}

function resolveSelectedOrg() {
  if (vscodeApi !== null && liveOrgOptions !== null) {
    return liveOrgLookup.get(selectedOrgId);
  }

  return resolveCurrentMockOrgOptions().find((org) => org.id === selectedOrgId);
}

function resolveSelectedOrgName() {
  if (selectedOrgName.length > 0) {
    return selectedOrgName;
  }

  return resolveSelectedOrg()?.name ?? '';
}

function resolveCurrentMockOrgOptions() {
  const selectedRegion = resolveSelectedRegion();
  if (selectedRegion?.code === 'br-10') {
    return BR10_ORG_OPTIONS;
  }

  return DEFAULT_ORG_OPTIONS;
}

function resolveSelectableSpaces() {
  if (vscodeApi !== null && liveSpaceNames !== null) {
    return liveSpaceNames;
  }

  return resolveSelectedOrg()?.spaces ?? [];
}

function resolveSelectedLog(logs) {
  if (logs.length === 0) {
    return undefined;
  }

  const selectedLog = logs.find((entry) => entry.id === selectedLogId);
  return selectedLog ?? logs[0];
}

function cloneSeedLogs() {
  return LOG_SEED.map((entry) => ({ ...entry }));
}

function resolveCurrentSpaceApps() {
  if (vscodeApi !== null) {
    if (liveAppOptions === null) {
      return [];
    }
    return liveAppOptions.map((app) => ({
      id: app.id,
      name: app.name,
      runningInstances:
        typeof app.runningInstances === 'number' ? app.runningInstances : 0,
    }));
  }

  const spaceKey = selectedSpaceId.trim().toLowerCase();
  const curatedAppNames = SPACE_APP_OPTIONS[spaceKey];
  const appNames = Array.isArray(curatedAppNames) ? curatedAppNames : buildFallbackAppNames(spaceKey);
  return appNames.map((appName) => ({ id: appName, name: appName, runningInstances: 1 }));
}

function resolveHanaServices() {
  if (hanaServiceOptions !== null) {
    return hanaServiceOptions;
  }

  syncSqlAppTargetsFromCurrentApps();
  return hanaServiceOptions ?? [];
}

function filterHanaServiceRows(services) {
  const keyword = sqlAppSearchKeyword.trim().toLowerCase();
  if (keyword.length === 0) {
    return services;
  }

  return services.filter((service) => {
    const serviceName = typeof service.name === 'string' ? service.name.toLowerCase() : '';
    return serviceName.includes(keyword);
  });
}

function resolveSelectedHanaService() {
  const services = resolveHanaServices();
  return services.find((service) => service.id === selectedHanaServiceId);
}

function pruneSelectedHanaServiceId() {
  if (selectedHanaServiceId.length === 0) {
    return;
  }
  const serviceIds = new Set(resolveHanaServices().map((service) => service.id));
  if (!serviceIds.has(selectedHanaServiceId)) {
    selectedHanaServiceId = '';
  }
}

function syncSqlAppTargetsFromCurrentApps() {
  // Mirror the Logs / APIs catalogs (filterLoggableCatalogApps): only show apps
  // that are started with at least one running instance. Stopped / scaled-to-zero
  // apps cannot serve a HANA SQL session, so they are hidden from the workbench
  // list just like they are from Logs and APIs.
  const apps = filterLoggableCatalogApps(resolveCurrentSpaceApps());
  hanaServiceOptions = apps.map((app) => ({
    id: app.id,
    name: app.name,
    runningInstances:
      typeof app.runningInstances === 'number' && Number.isFinite(app.runningInstances)
        ? app.runningInstances
        : 0,
  }));
  pruneSelectedHanaServiceId();
}

// Only apps with at least one running instance can stream logs. Mirrors the CF Logs
// panel filter (filterLoggableApps / isLoggableApp) so the sidebar App Logging catalog
// no longer lists stopped or scaled-to-zero apps where logs cannot be viewed. Stopped
// apps remain available in the Apps workspace (service export) which uses the full list.
function filterLoggableCatalogApps(apps) {
  return apps.filter(
    (app) => Number.isFinite(app.runningInstances) && app.runningInstances > 0
  );
}

function filterAppCatalogRows(apps) {
  const keyword = appCatalogSearchKeyword.trim().toLowerCase();
  if (keyword.length === 0) {
    return apps;
  }

  return apps.filter((app) => {
    const appName = typeof app.name === 'string' ? app.name.toLowerCase() : '';
    return appName.includes(keyword);
  });
}

function resolveServiceExportRows(availableApps) {
  // Only apps actually running on CF (started, instances > 0) are services you can map
  // and export — mirror the Logs tab so stopped / scaled-to-zero apps are hidden here too.
  const runningApps = filterLoggableCatalogApps(availableApps);
  const mappingByAppId = new Map(serviceFolderMappings.map((mapping) => [mapping.appId, mapping]));
  return runningApps.map((app) => {
    const existingMapping = mappingByAppId.get(app.id);
    if (existingMapping !== undefined) {
      return existingMapping;
    }

    return {
      appId: app.id,
      appName: app.name,
      folderPath: '',
      isMapped: false,
      matchType: 'none',
    };
  });
}
