#!/usr/bin/env python3
"""Create a reproducible SHA-256 inventory of this portable kit, never secrets."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIRECTORIES = {'node_modules', '.git', '__pycache__', '.pytest_cache', '.cache'}


def safe_path(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative:
        raise ValueError('Expected a nonempty relative POSIX path')
    parts = PurePosixPath(relative)
    if not parts.parts or parts.is_absolute() or '..' in parts.parts or ':' in parts.parts[0]:
        raise ValueError('Absolute paths and parent traversal are prohibited')
    candidate = root.joinpath(*parts.parts)
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError as error:
        raise ValueError('Path escapes the kit root') from error
    for parent in [candidate, *candidate.parents]:
        if parent == root:
            break
        if parent.is_symlink():
            # The distributed kit has no symlinks; do not follow external content.
            raise ValueError('Symlinks are not permitted in the kit inventory')
    return candidate


def excluded(relative, output='MANIFEST.json'):
    path = PurePosixPath(relative)
    return (relative == output or any(part in EXCLUDED_DIRECTORIES for part in path.parts)
            or path.name == '.DS_Store' or path.suffix.lower() in {'.zip', '.pyc', '.pyo'}
            or any(part.startswith('.env') and part != '.env.example' for part in path.parts))


def eligible_files(root, output='MANIFEST.json'):
    for candidate in sorted(root.rglob('*')):
        relative = candidate.relative_to(root).as_posix()
        if excluded(relative, output):
            continue
        if candidate.is_symlink():
            raise ValueError(f'Symlink is not a portable asset: {relative}')
        if candidate.is_file():
            yield relative, safe_path(root, relative)


def build(root=ROOT, output='MANIFEST.json'):
    destination = safe_path(root, output)
    if destination.suffix != '.json':
        raise ValueError('Manifest output must be a JSON file inside the kit')
    entries = []
    for relative, path in eligible_files(root, output):
        content = path.read_bytes()
        entries.append({'path': relative, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    manifest = {'format': 'lock-in-kit-manifest-v1', 'algorithm': 'sha256',
                'exclusions': ['manifest itself', 'node_modules/', '.git/', 'Python caches', '.DS_Store', '*.zip', '.env* except .env.example'],
                'files': entries}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='MANIFEST.json', help='Relative JSON path inside this kit (default: MANIFEST.json)')
    args = parser.parse_args()
    try:
        result = build(output=args.output)
        print(f"Wrote {args.output}: {len(result['files'])} files, SHA-256; no real .env files or archives included.")
    except (ValueError, OSError) as error:
        parser.exit(1, f'Manifest failed: {error}\n')
