#!/usr/bin/env bash
# Static validation for developers without Docker; DOES NOT replace real
# `docker compose config` or a booted staging container on the VPS.
set -Eeuo pipefail
python3 - <<'PY'
import json
import yaml
from pathlib import Path

root = Path('deploy/import')
d = yaml.safe_load((root / 'compose.yml').read_text(encoding='utf-8'))
services = d['services']
required = {'postgres','api','web','clamav-signatures','backup'}
assert set(services) == required, 'Unexpected or missing services; NEVER deploy legacy editor'
assert all('ports' not in service for service in services.values()), 'Public host port exposure found'
assert set(services['web']['networks']) == {'import_private', 'dokploy-network'}
assert services['web']['networks']['import_private']['ipv4_address'].startswith('${WATHIQA_WEB_IP')
assert set(services['api']['networks']) == {'import_private'}
assert set(services['postgres']['networks']) == {'import_private'}
assert services['backup']['profiles'] == ['ops'], 'Backup job must be explicit opt-in'
assert d['networks']['import_private']['internal'] is True, 'DB/API private network needs isolation'
assert d['networks']['dokploy-network']['external'] is True
assert any('/var/lib/postgresql' in str(v) for v in services['postgres']['volumes']), \
    'PostgreSQL 18 must use /var/lib/postgresql (not the old /data volume)'
assert 'Dockerfile.api' in services['api']['build']['dockerfile']
assert 'Dockerfile.web' in services['web']['build']['dockerfile']
assert 'Dockerfile.backup' in services['backup']['build']['dockerfile']
assert (root / 'Dockerfile.backup').is_file(), 'Backup image Dockerfile must be included in Git release'
assert all(str(v).startswith('${WATHIQA_SECRETS_ROOT') for v in
           (s['file'] for s in d['secrets'].values())), 'Secret files must be external'
assert services['api']['environment']['ReverseProxy__KnownProxies'].startswith('${WATHIQA_WEB_IP')
assert services['api']['environment']['Documents__ClamScanExecutable'] == '/usr/bin/clamscan'
assert services['backup']['environment']['RESTIC_REPOSITORY'].startswith('${RESTIC_REPOSITORY')
assert json.loads(Path('frontend/package.json').read_text(encoding='utf-8'))['dependencies']['next'] == '16.4.5', \
    'Next.js must be pinned to the reviewed stable security release'
lock = json.loads(Path('frontend/package-lock.json').read_text(encoding='utf-8'))
assert lock['packages']['']['dependencies']['next'] == '16.4.5', 'Lockfile differs from package.json'
print('WATHIQA_COMPOSE_STATIC_STRUCTURE=PASS')
print('NOTE: Docker image build, real HTTPS, ClamAV signatures and off-host restore NOT verified here')
PY
