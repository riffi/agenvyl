import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

async function readJson(path, label, errors) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    errors.push(`${label} cannot be read as JSON: ${error.message}`);
    return undefined;
  }
}

function verifyInternalPins(manifest, label, version, errors) {
  for (const section of dependencySections) {
    for (const [name, pin] of Object.entries(manifest?.[section] ?? {})) {
      if (name.startsWith('@agenvyl/') && pin !== version) {
        errors.push(`${label} pins ${name} to ${pin} in ${section}; expected ${version}`);
      }
    }
  }
}

export async function verifyReleaseReadiness(rootDirectory = process.cwd()) {
  const root = resolve(rootDirectory);
  const errors = [];
  const rootManifest = await readJson(resolve(root, 'package.json'), 'package.json', errors);

  if (!rootManifest) {
    throw new Error(`Release readiness verification failed:\n- ${errors.join('\n- ')}`);
  }

  const version = rootManifest.version;
  if (typeof version !== 'string' || version.length === 0) {
    errors.push('package.json must contain a non-empty version');
  }

  const workspacePaths = rootManifest.workspaces;
  if (!Array.isArray(workspacePaths) || workspacePaths.some(path => typeof path !== 'string')) {
    errors.push('package.json workspaces must be an array of paths');
  }

  const manifests = [{ path: '', label: 'package.json', manifest: rootManifest }];
  for (const workspacePath of Array.isArray(workspacePaths) ? workspacePaths : []) {
    if (/[*?[{]/u.test(workspacePath)) {
      errors.push(`workspace glob ${workspacePath} is not supported by release:verify; list the workspace explicitly`);
      continue;
    }
    const label = `${workspacePath}/package.json`;
    const manifest = await readJson(resolve(root, workspacePath, 'package.json'), label, errors);
    if (manifest) manifests.push({ path: workspacePath.replaceAll('\\', '/'), label, manifest });
  }

  for (const { label, manifest } of manifests) {
    if (manifest.version !== version) {
      errors.push(`${label} has version ${manifest.version ?? '<missing>'}; expected ${version}`);
    }
    verifyInternalPins(manifest, label, version, errors);
  }

  const lock = await readJson(resolve(root, 'package-lock.json'), 'package-lock.json', errors);
  if (lock) {
    if (lock.version !== version) {
      errors.push(`package-lock.json has top-level version ${lock.version ?? '<missing>'}; expected ${version}`);
    }

    for (const { path, label } of manifests) {
      const lockEntry = lock.packages?.[path];
      const lockLabel = path ? `package-lock.json packages["${path}"]` : 'package-lock.json packages[""]';
      if (!lockEntry) {
        errors.push(`${lockLabel} is missing for ${label}`);
        continue;
      }
      if (lockEntry.version !== version) {
        errors.push(`${lockLabel} has version ${lockEntry.version ?? '<missing>'}; expected ${version}`);
      }
      verifyInternalPins(lockEntry, lockLabel, version, errors);
    }
  }

  const releaseNotes = `docs/releases/v${version}.md`;
  try {
    await access(resolve(root, releaseNotes));
  } catch {
    errors.push(`${releaseNotes} is missing`);
  }

  if (errors.length > 0) {
    throw new Error(`Release readiness verification failed:\n- ${errors.join('\n- ')}`);
  }

  return { version, manifestCount: manifests.length, releaseNotes };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = await verifyReleaseReadiness();
    console.log(
      `Release ${result.version} is consistent across ${result.manifestCount} manifests, the lockfile, internal pins, and ${result.releaseNotes}.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
