export const NODE_VERSION = '22.23.1';

export const RUNTIME_BUNDLE_TARGETS = [
  {
    platform: 'linux', architecture: 'x64', archiveFormat: 'tar.xz',
    nodeArchive: `node-v${NODE_VERSION}-linux-x64.tar.xz`,
    nodeSha256: '9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578',
  },
  {
    platform: 'linux', architecture: 'arm64', archiveFormat: 'tar.xz',
    nodeArchive: `node-v${NODE_VERSION}-linux-arm64.tar.xz`,
    nodeSha256: '0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1',
  },
  {
    platform: 'darwin', architecture: 'x64', archiveFormat: 'zip',
    nodeArchive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    nodeSha256: 'b8da981b8a0b1241b70249204916da76c63573ddf5814dbd2d1e41069105cb81',
  },
  {
    platform: 'darwin', architecture: 'arm64', archiveFormat: 'zip',
    nodeArchive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    nodeSha256: 'ef28d8fab2c0e4314522d4bb1b7173270aa3937e93b92cb7de79c112ac1fa953',
  },
  {
    platform: 'win32', architecture: 'x64', archiveFormat: 'zip',
    nodeArchive: `node-v${NODE_VERSION}-win-x64.zip`,
    nodeSha256: '7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29',
  },
];

export function runtimeBundleTarget(platform, architecture) {
  const target = RUNTIME_BUNDLE_TARGETS.find(candidate => candidate.platform === platform && candidate.architecture === architecture);
  if (!target) throw new Error(`Unsupported runtime bundle target: ${platform}-${architecture}`);
  return target;
}

export function runtimeBundleTargetName(target) {
  return `${target.platform === 'win32' ? 'windows' : target.platform}-${target.architecture}`;
}

export function runtimeBundleArchiveName(version, target) {
  return `agenvyl-${version}-${runtimeBundleTargetName(target)}.${target.archiveFormat}`;
}
