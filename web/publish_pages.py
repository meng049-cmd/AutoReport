"""Publish the tested dist directory to gh-pages with a normal, fast-forward push."""
import os
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]

def git(*args, env=None):
    return subprocess.check_output(['git', *args], cwd=root, env=env, text=True).strip()

if not (root / 'dist/index.html').is_file():
    raise SystemExit('Run npm run build and npm test first.')
remote = git('ls-remote', '--heads', 'origin', 'refs/heads/gh-pages')
parent = remote.split()[0] if remote else None
if parent:
    git('fetch', 'origin', 'refs/heads/gh-pages')
with tempfile.TemporaryDirectory(prefix='autoreport-pages-') as temp:
    env = dict(os.environ, GIT_INDEX_FILE=str(Path(temp) / 'index'))
    git('read-tree', '--empty', env=env)
    git('--work-tree=' + str(root / 'dist'), 'add', '--all', env=env)
    tree = git('write-tree', env=env)
    args = ['commit-tree', tree, '-m', 'Deploy browser work-order matching website']
    if parent:
        args.extend(['-p', parent])
    commit = git(*args, env=env)
    # No force: a concurrent deployment is rejected rather than overwritten.
    git('push', 'origin', commit + ':refs/heads/gh-pages')
print('Published static website commit:', commit)
print('Pages source: gh-pages / (root)')
