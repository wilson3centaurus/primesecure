#!/usr/bin/env python3
"""Validate and optionally import the reviewed learning-resource bundle.
Default mode only validates files. --apply runs as root on the self-hosted server,
checks bucket/global limits, uploads immutable objects, verifies downloads, then
publishes the complete catalog batch atomically. Credentials stay in memory.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
SCHOOL='14eea188-73b1-40bc-8f8d-15afbea27ffa'
BUCKET='primesecure-hub'
HEX=re.compile(r'^[a-f0-9]{64}$')
SAFE_NAME=re.compile(r'^[A-Za-z0-9_.-]+$')


def emit(data: dict) -> None:
    print(json.dumps(data, ensure_ascii=True), flush=True)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def digest_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def checked_file(directory: Path, filename: str, extension: str) -> Path:
    require(isinstance(filename, str) and SAFE_NAME.fullmatch(filename) is not None,
            'Unsafe bundle filename')
    require(filename.endswith(extension), 'Unexpected bundle file extension')
    path = (directory / filename).resolve()
    require(path.parent == directory.resolve() and path.is_file(),
            'Bundle file is missing or resolves outside its expected directory')
    return path


def psql(query: str) -> str:
    result = subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-q', '-A', '-t',
                             '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                            input=query, capture_output=True, text=True)
    # Never print a full query, its icons, or any Docker environment.
    if result.returncode:
        last = next((line.strip() for line in result.stderr.splitlines() if 'ERROR:' in line),
                    'database command failed')
        raise RuntimeError('Database import failed: ' + last[:300])
    return result.stdout.strip()


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def gateway() -> tuple[str, str]:
    result = subprocess.run(['docker', 'inspect', 'supabase-kong'], capture_output=True, text=True)
    require(result.returncode == 0, 'Unable to inspect Supabase API gateway')
    container = json.loads(result.stdout)[0]
    environment = dict(entry.split('=', 1) for entry in container['Config']['Env'] if '=' in entry)
    key = environment.get('SUPABASE_SERVICE_KEY') or environment.get('SUPABASE_SERVICE_ROLE_KEY')
    require(isinstance(key, str) and len(key) > 50, 'Service credential not configured on API gateway')
    addresses = [network.get('IPAddress', '') for network in container['NetworkSettings']['Networks'].values()]
    ip = next((address for address in addresses if address and ipaddress.ip_address(address).is_private), None)
    require(ip is not None, 'No private Docker gateway address found')
    return 'http://' + ip + ':8000', key


class Storage:
    def __init__(self, base: str, key: str):
        self.base = base
        self.key = key

    def url(self, bucket: str, path: str, public: bool = False) -> str:
        scope = 'public' if public else 'authenticated'
        return self.base + '/storage/v1/object/' + scope + '/' + bucket + '/' + urllib.parse.quote(path, safe='/')

    def read_hash(self, bucket: str, path: str, public: bool = False) -> tuple[int, str] | None:
        headers = {} if public else {'apikey': self.key, 'Authorization': 'Bearer ' + self.key}
        request = urllib.request.Request(self.url(bucket, path, public), headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                digest = hashlib.sha256()
                size = 0
                for chunk in iter(lambda: response.read(1024 * 1024), b''):
                    size += len(chunk)
                    require(size <= 250000000, 'Unexpected oversized stored object')
                    digest.update(chunk)
                return size, digest.hexdigest()
        except urllib.error.HTTPError as error:
            # Storage versions return either 404 or 400 for a nonexistent object.
            # For 400, only an explicit missing-object code permits an upload.
            if error.code == 404:
                return None
            if error.code == 400:
                try:
                    detail = json.loads(error.read(8192))
                    if str(detail.get('statusCode')) == '404' or detail.get('error') in ('not_found', 'Not Found'):
                        return None
                except (ValueError, TypeError):
                    pass
            raise RuntimeError('Storage read failed HTTP ' + str(error.code) + ' for ' + bucket + '/' + path) from None

    def ensure(self, bucket: str, path: str, source: Path, expected_size: int,
               expected_hash: str, mime: str, public: bool = False) -> str:
        existing = self.read_hash(bucket, path, public)
        if existing is not None:
            require(existing == (expected_size, expected_hash), 'Existing storage object differs; refusing overwrite: ' + bucket + '/' + path)
            return 'existing-verified'
        request = urllib.request.Request(
            self.base + '/storage/v1/object/' + bucket + '/' + urllib.parse.quote(path, safe='/'),
            data=source.read_bytes(), method='POST',
            headers={'apikey': self.key, 'Authorization': 'Bearer ' + self.key,
                     'Content-Type': mime, 'x-upsert': 'false', 'Cache-Control': 'max-age=31536000'})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                require(response.status in (200, 201), 'Unexpected storage upload status')
        except urllib.error.HTTPError as error:
            if error.code not in (400, 409):
                raise RuntimeError('Storage upload failed HTTP ' + str(error.code) + ' for ' + bucket + '/' + path) from None
            # A concurrent import may have won. No upsert or overwrite is used.
        downloaded = self.read_hash(bucket, path, public)
        require(downloaded == (expected_size, expected_hash), 'Uploaded object verification failed: ' + bucket + '/' + path)
        return 'uploaded-verified'
