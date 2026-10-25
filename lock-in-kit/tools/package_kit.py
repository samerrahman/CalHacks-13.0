#!/usr/bin/env python3
"""Package the validated portable kit. Run after all source/evidence edits."""
import argparse
import hashlib
import subprocess
import sys
import zipfile
from pathlib import Path
from build_manifest import ROOT, build, eligible_files

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=ROOT.parent / 'LOCK_IN_Codex_Build_Kit.zip')
parser.add_argument('--replace', action='store_true', help='Explicitly replace an existing output archive')
args = parser.parse_args()
if args.output.exists() and not args.replace:
    parser.exit(1, 'Output already exists; choose another path or explicitly use --replace.\n')
build()
subprocess.run([sys.executable, str(ROOT/'tools/validate_assets.py'), '--manifest'], check=True)
files = list(eligible_files(ROOT)) + [('MANIFEST.json', ROOT/'MANIFEST.json')]
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for relative, path in sorted(files):
        info = zipfile.ZipInfo('lock-in-kit/'+relative, date_time=(2026,10,23,0,0,0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
with zipfile.ZipFile(args.output) as archive:
    if archive.testzip() is not None:
        raise ValueError('Archive integrity check failed')
checksum = hashlib.sha256(args.output.read_bytes()).hexdigest()
args.output.with_suffix(args.output.suffix+'.sha256').write_text(checksum+'  '+args.output.name+'\n')
print(f'Packaged {len(files)} files into {args.output.name} ({args.output.stat().st_size} bytes). SHA-256: {checksum}')
