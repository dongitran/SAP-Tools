/* eslint-disable */
// @ts-nocheck

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from 'vscode';
import { runBuildPublishAll } from "../../localPackages/buildPublishOrchestrator";
import { buildDependencyOrder } from '../../localPackages/dependencyGraph';
import { scanLocalPackages } from '../../localPackages/localPackageScanner';
import {
    readLocalPackagesConfig,
    type LocalPackagesConfig,
} from '../../localPackages/localPackagesConfig';
import { replaceServicePackageDependencyTags } from "../../localPackages/serviceDependencyTags";
import { RegionSidebarProvider } from "../../sidebarProvider";
import {
    areLocalPackageListsEqual,
    buildLocalPackagesCacheKey,
    formatServicePackageReplaceMessage
} from '../../sidebarProvider.helpers';
import {
    MSG_BUILD_PUBLISH_PREVIEW, MSG_BUILD_PUBLISH_PROGRESS,
    MSG_LOCAL_PACKAGES_LOADED, MSG_LOCAL_PACKAGES_LOADING,
    MSG_LOCAL_REGISTRY_STATE
} from '../../sidebarProvider.types';

const CONFIRMED_SCOPE_BY_EMAIL_GLOBAL_STATE_KEY = 'sapTools.confirmedScopeByEmail.v1';
const SERVICE_MAPPINGS_BY_SCOPE_GLOBAL_STATE_KEY = 'sapTools.serviceMappingsByScope.v1';


export async function resolveLocalPackageNamesForReplacement(this: any, config: LocalPackagesConfig): Promise<string[]> {
const rootFolderPath = this.selectedLocalRootFolderPath.trim();
const patterns = config.namePatterns.trim();
if (rootFolderPath.length === 0 || patterns.length === 0) {
  return [];
}

const packages = await scanLocalPackages(rootFolderPath, patterns);
return packages.map((pkg) => pkg.name);
}

export async function startLocalRegistry(this: any): Promise<void> {
const config = readLocalPackagesConfig(this.currentConfirmedScope);
this.npmBuildChannel.show(true);
try {
  await this.verdaccioManager.start({
    port: config.registry.port,
    scopes: config.registry.scopes,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to start local registry.';
  this.npmBuildChannel.appendLine(`ERROR: ${message}`);
  void vscode.window.showErrorMessage(`SAP Tools: ${message}`);
} finally {
  await this.postRegistryState();
}
}

export function stopLocalRegistry(this: any): void {
this.verdaccioManager.stop();
void this.postRegistryState();
}

export async function postRegistryState(this: any): Promise<void> {
const status = await this.verdaccioManager.status();
this.postMessage({ type: MSG_LOCAL_REGISTRY_STATE, ...status });
}

export async function postDetectedLocalPackages(this: any): Promise<void> {
const rootFolderPath = this.selectedLocalRootFolderPath.trim();
const patterns = readLocalPackagesConfig(this.currentConfirmedScope).namePatterns.trim();

if (rootFolderPath.length === 0 || patterns.length === 0) {
  this.postMessage({ type: MSG_LOCAL_PACKAGES_LOADING, loading: false });
  this.postMessage({
    type: MSG_LOCAL_PACKAGES_LOADED,
    configured: patterns.length > 0,
    patterns,
    packages: [],
  });
  return;
}

this.postMessage({ type: MSG_LOCAL_PACKAGES_LOADING, loading: true });

const cacheKey = buildLocalPackagesCacheKey(rootFolderPath, patterns);
const cached = await this.cacheStore.getLocalPackages(cacheKey);
if (cached !== null) {
  // Serve stale-while-revalidate: show cached data instantly, then rescan.
  this.postMessage({ type: MSG_LOCAL_PACKAGES_LOADING, loading: false });
  this.postMessage({
    type: MSG_LOCAL_PACKAGES_LOADED,
    configured: true,
    patterns,
    packages: cached.packages,
  });
}

try {
  const scanned = await this.scanAndOrderLocalPackages(rootFolderPath, patterns);
  const isSameAsCached = cached !== null && areLocalPackageListsEqual(scanned, cached.packages);
  if (!isSameAsCached) {
    this.postMessage({ type: MSG_LOCAL_PACKAGES_LOADING, loading: false });
    this.postMessage({
      type: MSG_LOCAL_PACKAGES_LOADED,
      configured: true,
      patterns,
      packages: scanned,
    });
  }
  await this.cacheStore.setLocalPackages(cacheKey, scanned);
} catch (error) {
  this.postMessage({ type: MSG_LOCAL_PACKAGES_LOADING, loading: false });
  this.postMessage({
    type: MSG_LOCAL_PACKAGES_LOADED,
    configured: true,
    patterns,
    packages: [],
    error: error instanceof Error ? error.message : 'Failed to scan local packages.',
  });
}
}

export async function scanAndOrderLocalPackages(this: any, rootFolderPath: string, patterns: string): Promise<{ name: string; version: string; hasBuildScript: boolean; round: number | null }[]> {
const packages = await scanLocalPackages(rootFolderPath, patterns);
const roundByName = new Map<string, number>();
try {
  const order = buildDependencyOrder(
    packages.map((pkg) => ({ name: pkg.name, deps: pkg.dependencyNames }))
  );
  order.rounds.forEach((round, index) => {
    for (const name of round) {
      roundByName.set(name, index);
    }
  });
} catch {
  // Dependency cycle — leave rounds unset; the list still shows the packages.
}
return packages.map((pkg) => ({
  name: pkg.name,
  version: pkg.version,
  hasBuildScript: pkg.buildScript !== undefined,
  round: roundByName.get(pkg.name) ?? null,
}));
}

export async function handleBuildPublishAll(this: RegionSidebarProvider, targetPackageName?: string): Promise<void> {
    if (this.buildPublishInProgress) {
      this.postBuildResult(false, 'A build & publish run is already in progress.');
      return;
    }

    const rootFolderPath = this.selectedLocalRootFolderPath.trim();
    if (rootFolderPath.length === 0) {
      this.postBuildResult(false, 'Select a local root folder before building packages.');
      return;
    }

    const config = readLocalPackagesConfig(this.currentConfirmedScope);
    if (config.namePatterns.trim().length === 0) {
      this.postBuildResult(
        false,
        'Configure "sapTools.localPackages.namePatterns" (e.g. "@example/") to detect your packages.'
      );
      return;
    }

    this.buildPublishInProgress = true;
    this.npmBuildChannel.appendLine(
      `\n=== Build & publish all local packages (${new Date().toISOString()}) ===`
    );
    try {
      await this.verdaccioManager.start({
        port: config.registry.port,
        scopes: config.registry.scopes,
      });
      await this.postRegistryState();

      const requestOpts: import('../../localPackages/buildPublishOrchestrator').BuildPublishRequest = {
        rootFolderPath,
        config,
        registryUrl: this.verdaccioManager.getRegistryUrl(config.registry.port),
        authToken: this.verdaccioManager.getAuthToken(),
        onOrder: (order) => {
          this.postMessage({ type: MSG_BUILD_PUBLISH_PREVIEW, order: [...order] });
        },
        onProgress: (progress) => {
          this.postMessage({ type: MSG_BUILD_PUBLISH_PROGRESS, ...progress });
        },
        onOutput: (chunk) => {
          this.npmBuildChannel.append(chunk);
        },
      };

      if (targetPackageName !== undefined) {
        Object.assign(requestOpts, { targetPackageName });
      }

      const outcome = await runBuildPublishAll(requestOpts);

      const summary =
        `Published ${String(outcome.order.length)} package(s) ` +
        `(${String(outcome.builtCount)} built, ${String(outcome.skippedCount)} skipped) ` +
        'to the local registry.';
      this.npmBuildChannel.appendLine(summary);
      this.postBuildResult(true, targetPackageName === undefined ? '' : summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Build & publish failed.';
      this.npmBuildChannel.appendLine(`ERROR: ${message}`);
      this.postBuildResult(false, message);
    } finally {
      this.buildPublishInProgress = false;
      await this.postRegistryState();
    }
}

export async function handleReplaceServicePackagePlaceholder(this: RegionSidebarProvider, appId: string): Promise<void> {
    const mapping = this.serviceFolderMappings.find(
          (m) => m.appId === appId && m.folderPath.length > 0
        );
    if (mapping === undefined) {
      void vscode.window.showErrorMessage(
        `SAP Tools: No mapped folder found for service "${appId}".`
      );
      return;
    }

    const config = readLocalPackagesConfig(this.currentConfirmedScope);
    const placeholders = config.packageJsonTagPlaceholder
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
    const tag = config.registry.defaultTag;
    const packageJsonPath = join(mapping.folderPath, 'package.json');
    try {
      const localPackageNames = await this.resolveLocalPackageNamesForReplacement(config);
      if (placeholders.length === 0 && localPackageNames.length === 0) {
        void vscode.window.showWarningMessage(
          'SAP Tools: No placeholder configured. Set "sapTools.localPackages.packageJsonTagPlaceholder" first.'
        );
        return;
      }

      const content = await readFile(packageJsonPath, 'utf8');
      const result = replaceServicePackageDependencyTags(content, {
        placeholders,
        localPackageNames,
        tag,
      });
      if (!result.changed) {
        void vscode.window.showInformationMessage(
          `SAP Tools: No package.json update needed for "${mapping.appName}".`
        );
        return;
      }
      await writeFile(packageJsonPath, result.content, 'utf8');
      void vscode.window.showInformationMessage(
        formatServicePackageReplaceMessage(mapping.appName, tag, result)
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`SAP Tools: Failed to update package.json: ${msg}`);
    }
}
