"""Refresh scoped upload URLs through the existing private status channel.

Run only on the server. No credentials or signed URLs are printed to the terminal.
The temporary report objects remain covered by the mirror's cleanup plan.
"""
import importlib.util,json,subprocess,sys
from pathlib import Path
root=Path('/root/primesecure-library-stage')
script=root/'workspace/tools/library/cache-reviewed-reports.py'
assert script.is_file() and (root/'https-transfer-plan.json').is_file()
result=subprocess.run(['python3',str(script)],check=True,capture_output=True,text=True)
parts=json.loads(result.stdout)['parts']
spec=importlib.util.spec_from_file_location('transfer',root/'https-transfer-server.py')
transfer=importlib.util.module_from_spec(spec);spec.loader.exec_module(transfer)
plan=json.loads(transfer.PLAN.read_text())
transfer.status(plan,'report_transfer_ready',parts=parts)
print('Private transfer access refreshed for '+str(len(parts))+' remaining reports. No credentials need to be pasted.')
