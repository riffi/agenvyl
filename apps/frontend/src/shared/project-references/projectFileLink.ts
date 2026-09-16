import type {ProjectReference, ProjectSummary} from '@agenvyl/contracts';

export const isProjectFileLink = (url: string) => /^(?:project:|file:|[a-z]:[\\/]|\/(?!\/)|\\\\)/i.test(url);

/** Convert display paths only. The file API separately enforces filesystem containment. */
export const resolveProjectFileLink = (url: string, project?: ProjectSummary): ProjectReference | undefined => {
  if (!project || !isProjectFileLink(url)) return;
  const suffix = url.match(/(?:#L(\d+)(?:C\d+)?|:(\d+)(?::\d+)?)$/);
  const line = suffix ? Number(suffix[1] ?? suffix[2]) : undefined;
  let value: string;
  try { value = decodeURIComponent(suffix ? url.slice(0, -suffix[0].length) : url); } catch { return; }
  if (line !== undefined && (!Number.isSafeInteger(line) || line < 1)) return;
  const relative = value.startsWith('project:');
  if (relative) value = value.slice(8);
  else if (/^file:/i.test(value)) {
    value = value.replace(/^file:\/\//i, '');
    if (/^\/[a-z]:\//i.test(value)) value = value.slice(1);
    else if (!value.startsWith('/')) return;
  }
  value = value.replaceAll('\\', '/');
  const root = project.path.replaceAll('\\', '/').replace(/\/+$/, '');
  if (!relative) {
    const windows = /^[a-z]:\//i.test(root) || root.startsWith('//');
    const candidate = windows ? value.toLowerCase() : value;
    const prefix = (windows ? root.toLowerCase() : root) + '/';
    if (!candidate.startsWith(prefix)) return;
    value = value.slice(root.length + 1);
  }
  if (!value || /[\x00-\x1f:]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) return;
  return {projectId: project.id, projectName: project.name, root: project.path, path: value, kind: 'file', ...(line ? {line} : {})};
};
