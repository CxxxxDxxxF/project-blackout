export type CapabilityPackStatus = 'installed' | 'error';

export type CapabilityPackAssetType = 'skill' | 'connector';

export interface CapabilityPack {
  id: string;
  owner: string;
  repo: string;
  ref: string;
  pinnedSha: string;
  manifestVersion: number;
  packVersion: string;
  name: string;
  description: string;
  sourceUrl: string;
  status: CapabilityPackStatus;
  installedAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface CapabilityPackAsset {
  id: string;
  packId: string;
  assetType: CapabilityPackAssetType;
  assetKey: string;
  sourcePathOrUrl: string;
  localRef: string;
  checksum?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityPackSkillManifestEntry {
  id: string;
  path: string;
}

export interface CapabilityPackConnectorManifestEntry {
  id: string;
  name: string;
  url: string;
}

export interface CapabilityPackManifest {
  schemaVersion: number;
  pack: {
    id: string;
    name: string;
    version: string;
    description: string;
  };
  assets: {
    skills: CapabilityPackSkillManifestEntry[];
    connectors: CapabilityPackConnectorManifestEntry[];
  };
}

export interface CapabilityPackInstallPreview {
  owner: string;
  repo: string;
  ref: string;
  resolvedSha: string;
  sourceUrl: string;
  manifest: CapabilityPackManifest;
  summary: {
    skillCount: number;
    connectorCount: number;
  };
}

export type CapabilityPackErrorCode =
  | 'PACK_OWNER_NOT_ALLOWED'
  | 'PACK_MANIFEST_MISSING'
  | 'PACK_MANIFEST_INVALID'
  | 'PACK_FETCH_FAILED'
  | 'PACK_ASSET_INVALID'
  | 'PACK_SKILL_CONFLICT'
  | 'PACK_CONNECTOR_CONFLICT'
  | 'PACK_CONNECTOR_CONNECTED_BLOCKS_UNINSTALL'
  | 'PACK_NOT_FOUND'
  | 'PACK_UPDATE_NOT_AVAILABLE';

export interface CapabilityPackActionResult<T = undefined> {
  success: boolean;
  code?: CapabilityPackErrorCode;
  error?: string;
  data?: T;
}

export interface CapabilityPackUpdateCheck {
  packId: string;
  currentSha: string;
  latestSha: string;
  updateAvailable: boolean;
  latestPackVersion?: string;
  changes?: {
    nameChanged: boolean;
    descriptionChanged: boolean;
    packVersionChanged: boolean;
    skillCountChanged: boolean;
    connectorCountChanged: boolean;
  };
}
