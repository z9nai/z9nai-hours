// Commits data files to a GitHub repository via the REST API. A browser
// cannot run git or use SSH, so commits are created with the Git Data API
// using a fine-grained personal access token (Contents: read & write).

export interface GitConfig {
  enabled: boolean;
  repo: string;   // "owner/repo", "git@github.com:owner/repo.git" or an https URL
  branch: string;
  token: string;
}

const LS_KEY = 'z9nai-hours-git';

export const DEFAULT_GIT_CONFIG: GitConfig = {
  enabled: false,
  repo: 'git@github.com:z9nai/z9nai-hours-data.git',
  branch: 'main',
  token: '',
};

// The token lives only in this browser's storage, never in the data folder
// (which is itself committed).
export function loadGitConfig(): GitConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? { ...DEFAULT_GIT_CONFIG, ...JSON.parse(raw) } : DEFAULT_GIT_CONFIG;
  } catch {
    return DEFAULT_GIT_CONFIG;
  }
}

export function saveGitConfig(cfg: GitConfig) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* storage unavailable */ }
}

export function parseRepo(input: string): { owner: string; repo: string } | null {
  const m = input.trim().match(/(?:github\.com[:/])?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export class GitError extends Error {}

async function gh(cfg: GitConfig, path: string, init?: RequestInit): Promise<Response> {
  const r = parseRepo(cfg.repo);
  if (!r) throw new GitError('Ungültige Repository-Angabe');
  if (!cfg.token) throw new GitError('Kein Token hinterlegt');
  return fetch(`https://api.github.com/repos/${r.owner}/${r.repo}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message ?? ''; } catch { /* no body */ }
    throw new GitError(`${what}: HTTP ${res.status}${detail ? ` – ${detail}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export async function testConnection(cfg: GitConfig): Promise<string> {
  const repo = await json<{ full_name: string; private: boolean; permissions?: { push?: boolean } }>(
    await gh(cfg, ''), 'Repository nicht erreichbar');
  if (repo.permissions && !repo.permissions.push) throw new GitError('Token hat keine Schreibrechte');
  const ref = await gh(cfg, `/git/ref/heads/${cfg.branch || 'main'}`);
  if (ref.status === 404 || ref.status === 409) {
    throw new GitError(`Branch "${cfg.branch || 'main'}" existiert nicht (Repository leer?)`);
  }
  await json(ref, 'Branch nicht lesbar');
  // permissions.push reflects the user, not a fine-grained token's scope, so
  // probe write access for real: an unreferenced blob is harmless and GC'd.
  const blob = await gh(cfg, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: '', encoding: 'utf-8' }) });
  if (blob.status === 403) throw new GitError('Token hat keine Schreibrechte (Contents: Read and write nötig)');
  await json(blob, 'Schreibtest fehlgeschlagen');
  return `Verbunden mit ${repo.full_name} (${repo.private ? 'privat' : 'öffentlich'}), Branch ${cfg.branch || 'main'}`;
}

// Text content, or binary content (receipts) as base64
export type GitFile = string | { base64: string };

// Commit several files in ONE commit. Returns null when nothing changed.
export async function commitFiles(cfg: GitConfig, files: Record<string, GitFile>, message: string): Promise<string | null> {
  const branch = cfg.branch || 'main';
  // Binary files are uploaded as blobs first; the tree then references their sha
  const entries = await Promise.all(Object.entries(files).map(async ([path, f]) => {
    if (typeof f === 'string') return { path, mode: '100644', type: 'blob', content: f };
    const blob = await json<{ sha: string }>(await gh(cfg, '/git/blobs', {
      method: 'POST', body: JSON.stringify({ content: f.base64, encoding: 'base64' }),
    }), `Upload von ${path} fehlgeschlagen`);
    return { path, mode: '100644', type: 'blob', sha: blob.sha };
  }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const ref = await json<{ object: { sha: string } }>(
      await gh(cfg, `/git/ref/heads/${branch}`), `Branch "${branch}" nicht gefunden`);
    const parentSha = ref.object.sha;
    const parent = await json<{ tree: { sha: string } }>(
      await gh(cfg, `/git/commits/${parentSha}`), 'Letzter Commit nicht lesbar');
    const tree = await json<{ sha: string }>(await gh(cfg, '/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: entries,
      }),
    }), 'Tree erstellen fehlgeschlagen');
    if (tree.sha === parent.tree.sha) return null; // identical to what's committed
    const commit = await json<{ sha: string }>(await gh(cfg, '/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
    }), 'Commit erstellen fehlgeschlagen');
    const upd = await gh(cfg, `/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    if (upd.ok) return commit.sha;
    if (upd.status !== 422 || attempt === 1) await json(upd, 'Branch aktualisieren fehlgeschlagen');
    // 422 = branch moved meanwhile (not a fast-forward) → rebuild on the new head
  }
  return null;
}
