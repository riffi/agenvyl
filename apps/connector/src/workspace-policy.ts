import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export class WorkspacePolicyError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
  }
}

export class WorkspacePolicy {
  private readonly roots: string[];

  constructor(configuredRoots: readonly string[]) {
    const roots = configuredRoots.map((root, index) => canonicalDirectory(root, `workspaces.roots[${index}]`));
    if (new Set(roots).size !== roots.length) throw new Error('workspaces.roots contains duplicate canonical paths');
    this.roots = roots;
  }

  get configured() { return this.roots.length > 0; }

  resolve(roomId: string, relativePath: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(roomId)) {
      throw new WorkspacePolicyError('workspace_invalid', 'Workspace room ID is invalid', 400);
    }
    if (!relativePath || relativePath.includes('\0') || isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
      throw new WorkspacePolicyError('workspace_invalid', 'Workspace path must be relative and cannot traverse parent directories', 400);
    }
    if (!this.roots.length) throw new WorkspacePolicyError('workspace_unavailable', 'Connector has no configured workspace roots', 503);

    const roomCandidates: string[] = [];
    for (const root of this.roots) {
      const candidate = resolve(root, roomId);
      let canonical: string;
      try {
        canonical = realpathSync(candidate);
      } catch (error) {
        if (isMissing(error)) continue;
        throw new WorkspacePolicyError('workspace_unavailable', 'Workspace directory cannot be inspected', 503);
      }
      if (!isWithin(root, canonical)) throw new WorkspacePolicyError('workspace_forbidden', 'Workspace directory escapes its configured root', 403);
      if (!statSync(canonical).isDirectory()) throw new WorkspacePolicyError('workspace_invalid', 'Workspace target is not a directory', 400);
      roomCandidates.push(canonical);
    }

    if (!roomCandidates.length) throw new WorkspacePolicyError('workspace_not_found', 'Room workspace was not found under configured roots', 404);
    if (roomCandidates.length > 1) throw new WorkspacePolicyError('workspace_ambiguous', 'Room workspace exists under multiple configured roots', 409);

    const roomRoot = roomCandidates[0];
    const target = resolve(roomRoot, relativePath);
    if (!isWithin(roomRoot, target)) throw new WorkspacePolicyError('workspace_forbidden', 'Workspace path escapes the room directory', 403);
    let canonicalTarget: string;
    try {
      canonicalTarget = realpathSync(target);
    } catch (error) {
      if (isMissing(error)) throw new WorkspacePolicyError('workspace_not_found', 'Requested workspace path was not found', 404);
      throw new WorkspacePolicyError('workspace_unavailable', 'Workspace path cannot be inspected', 503);
    }
    if (!isWithin(roomRoot, canonicalTarget)) throw new WorkspacePolicyError('workspace_forbidden', 'Workspace path escapes the room directory', 403);
    if (!statSync(canonicalTarget).isDirectory()) throw new WorkspacePolicyError('workspace_invalid', 'Workspace target is not a directory', 400);
    return canonicalTarget;
  }
}

function canonicalDirectory(path: string, label: string) {
  let canonical: string;
  try {
    canonical = realpathSync(path);
  } catch {
    throw new Error(`${label} must reference an existing directory`);
  }
  if (!statSync(canonical).isDirectory()) throw new Error(`${label} must reference an existing directory`);
  return canonical;
}

function isWithin(parent: string, child: string) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
}
