#!/usr/bin/env python3
"""Durable, single-process catalog importer. Only root-managed verified catalog URLs are used."""
import base64
import hashlib
import json
import logging
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
import uuid
import zipfile

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
CATALOG = Path(os.environ.get("PRIMESECURE_CATALOG", "/opt/primesecure/app-catalog.json"))

def sql(statement, payload=None):
    command = ["docker", "exec", "-i", "supabase-db", "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"]
    if payload is not None:
        command += ["-v", "payload=" + json.dumps(payload)]
    result = subprocess.run(command, input=statement, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError("Import database operation failed")
    text = result.stdout.strip()
    return json.loads(text) if text else None

def gateway():
    container = json.loads(subprocess.check_output(["docker", "inspect", "supabase-kong"]))[0]
    env = dict(value.split("=", 1) for value in container["Config"]["Env"] if "=" in value)
    address = next(iter(container["NetworkSettings"]["Networks"].values()))["IPAddress"]
    return "http://" + address + ":8000", env["SUPABASE_SERVICE_KEY"]

def status(job, value, detail):
    sql("update public.app_imports set status=(:'payload'::jsonb->>'status'), detail=(:'payload'::jsonb->>'detail'),updated_at=now() where id=(:'payload'::jsonb->>'id')::uuid;", {"id": job["id"], "status": value, "detail": detail[:400]})

def import_job(job):
    catalog = json.loads(CATALOG.read_text())
    if time.time() * 1000 - catalog["timestamp"] > 14 * 86400000:
        raise ValueError("Catalog needs refreshing; upload an authorized APK or contact RoboKorda")
    item = next((app for app in catalog["apps"] if app["id"] == job["package_id"]), None)
    if not item or not item["apk"].startswith("https://f-droid.org/repo/") or item["size"] > 150000000:
        raise ValueError("App is not in the current verified catalog")
    base, key = gateway()
    object_path = str(uuid.UUID(job["school_id"])) + "/" + str(uuid.uuid4()) + "/" + item["id"] + ".apk"
    uploaded = False
    try:
        with tempfile.NamedTemporaryFile(suffix=".apk") as target:
            digest = hashlib.sha256()
            count = 0
            request = urllib.request.Request(item["apk"], headers={"User-Agent": "PrimeSecure school catalog importer"})
            with urllib.request.urlopen(request, timeout=45) as source:
                while True:
                    block = source.read(1024 * 1024)
                    if not block:
                        break
                    count += len(block)
                    if count > item["size"] or count > 150000000:
                        raise ValueError("Download exceeded verified size")
                    target.write(block)
                    digest.update(block)
            target.flush()
            if count != item["size"] or digest.hexdigest() != item["sha256"]:
                raise ValueError("Downloaded APK did not match the signed repository checksum")
            with zipfile.ZipFile(target.name) as archive:
                if "AndroidManifest.xml" not in archive.namelist():
                    raise ValueError("Downloaded file was not an Android APK")
            status(job, "downloading", "Download verified. Publishing to school library")
            icon = None
            if item.get("icon") and item.get("iconHash"):
                try:
                    with urllib.request.urlopen(item["icon"], timeout=15) as response:
                        image = response.read(100001)
                    if len(image) <= 100000 and hashlib.sha256(image).hexdigest() == item["iconHash"]:
                        icon = "data:image/png;base64," + base64.b64encode(image).decode()
                except (OSError, urllib.error.URLError):
                    pass
            target.seek(0)
            headers = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/vnd.android.package-archive", "Content-Length": str(count)}
            request = urllib.request.Request(base + "/storage/v1/object/primesecure-hub/" + object_path, data=target, headers=headers, method="POST")
            with urllib.request.urlopen(request, timeout=120) as response:
                response.read()
            uploaded = True
            # Completion and catalog publication are atomic. Device installer additionally checks package identity.
            data = {"job": job["id"], "school": job["school_id"], "title": item["title"], "description": item["description"], "path": object_path, "size": count, "package": item["id"], "version": str(item["version"]), "icon": icon, "hash": item["sha256"], "preinstall": job["preinstall"]}
            sql("""with inserted as (
              insert into public.hub_items(school_id,kind,title,description,storage_path,mime_type,size,package_name,version_name,icon_data,sha256,preinstall)
              select (p->>'school')::uuid,'app',left(p->>'title',160),p->>'description',p->>'path','application/vnd.android.package-archive',(p->>'size')::bigint,p->>'package',p->>'version',p->>'icon',p->>'hash',(p->>'preinstall')::boolean from (select :'payload'::jsonb p) input
              returning id
            ) update public.app_imports set status='succeeded',detail='Added to your school library',item_id=(select id from inserted),updated_at=now() where id=(:'payload'::jsonb->>'job')::uuid;""", data)
    except Exception:
        if uploaded:
            request = urllib.request.Request(base + "/storage/v1/object/primesecure-hub", data=json.dumps({"prefixes": [object_path]}).encode(), headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}, method="DELETE")
            try:
                urllib.request.urlopen(request, timeout=20).close()
            except Exception:
                logging.error("Could not remove failed import object for job %s", job["id"])
        raise

def loop():
    # Recover leases left by a reboot. Completed records are never reimported.
    sql("update public.app_imports set status='queued',detail='Resuming after interruption',updated_at=now() where status='downloading' and updated_at<now()-interval '15 minutes';")
    while True:
        try:
            job = sql("""with picked as (
               select j.id from public.app_imports j where j.status='queued' and exists(select 1 from public.profiles p where p.id=j.created_by and (p.role='super_admin' or (p.role='school_admin' and p.school_id=j.school_id)))
               order by j.created_at for update skip locked limit 1
            ), changed as (
               update public.app_imports set status='downloading',detail='Downloading verified APK',updated_at=now() where id=(select id from picked) returning *
            ) select row_to_json(changed) from changed;""")
            if not job:
                time.sleep(3)
                continue
            try:
                import_job(job)
                logging.info("Import completed: %s", job["id"])
            except Exception as error:
                detail = str(error) if isinstance(error, ValueError) else "Download or upload failed. Retry later or upload the official APK."
                status(job, "failed", detail)
                logging.error("Import failed for job %s (%s)", job["id"], type(error).__name__)
        except Exception as error:
            logging.error("Import worker waiting (%s)", type(error).__name__)
            time.sleep(15)

if __name__ == "__main__":
    loop()
