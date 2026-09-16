import type {ProjectReference, ProjectSummary} from '@agenvyl/contracts';

export const isProjectFileLink = (url: string) => /^(?:project:|workspace:|file:|[a-z]:[\\/]|\/(?!\/)|\\\\)/i.test(url);

/** Convert display paths only. The file API separately enforces filesystem containment. */
export const resolveProjectFileLink = (url: string, project?: ProjectSummary): ProjectReference | undefined => {
  if (!project) return;
  const target = resolveFileLinkPath(url, project.path, 'project');
  if (!target) return;
  return {projectId: project.id, projectName: project.name, root: project.path, kind: 'file', ...target};
};

export const resolveFileLinkPath = (url: string, rootPath: string, scheme: 'project' | 'workspace') => {
  if (!rootPath || !isProjectFileLink(url)) return;
  if (/^(?:project|workspace):/i.test(url) && !url.startsWith(`${scheme}:`)) return;
  const suffix = url.match(/(?:#L(\d+)(?:C\d+)?|:(\d+)(?::\d+)?)$/);
  const line = suffix ? Number(suffix[1] ?? suffix[2]) : undefined;
  let value: string;
  try { value = decodeURIComponent(suffix ? url.slice(0, -suffix[0].length) : url); } catch { return; }
  if (line !== undefined && (!Number.isSafeInteger(line) || line < 1)) return;
  const relative = value.startsWith(`${scheme}:`);
  if (relative) value = value.slice(scheme.length + 1);
  else if (/^file:/i.test(value)) {
    value = value.replace(/^file:\/\//i, '');
    if (/^\/[a-z]:\//i.test(value)) value = value.slice(1);
    else if (!value.startsWith('/')) return;
  }
  value = value.replaceAll('\\', '/');
  const root = rootPath.replaceAll('\\', '/').replace(/\/+$/, '');
  if (!relative) {
    const windows = /^[a-z]:\//i.test(root) || root.startsWith('//');
    const candidate = windows ? value.toLowerCase() : value;
    const prefix = (windows ? root.toLowerCase() : root) + '/';
    if (!candidate.startsWith(prefix)) return;
    value = value.slice(root.length + 1);
  }
  if (!value || /[\x00-\x1f:]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) return;
  return {path: value, ...(line ? {line} : {})};
};
