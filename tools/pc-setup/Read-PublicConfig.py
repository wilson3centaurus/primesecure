import base64,json,re,sys,zipfile
keys=set()
with zipfile.ZipFile(sys.argv[1]) as z:
 for name in z.namelist():
  if not re.fullmatch(r'classes\d*\.dex',name):continue
  for token in re.findall(rb'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}',z.read(name)):
   try:
    part=token.split(b'.')[1];claims=json.loads(base64.urlsafe_b64decode(part+b'='*((-len(part))%4)))
    if claims.get('role')=='anon' and claims.get('iss')=='supabase':keys.add(token.decode())
   except (ValueError,UnicodeError):pass
assert len(keys)==1,'Expected exactly one public anonymous key in verified APK'
print(json.dumps(dict(url='https://api.robokorda.duckdns.org',anon=next(iter(keys)))))
