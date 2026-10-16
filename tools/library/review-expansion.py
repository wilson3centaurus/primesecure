"""Final metadata review, independent content checks and portable indexes."""
from pathlib import Path
import json,re,hashlib,collections,csv,zipfile,shutil
import fitz
root=Path(__file__).resolve().parents[2];stage=root/'artifacts/school-library-expansion';bundle=stage/'bundle'
manifest=json.loads((bundle/'manifest.json').read_text(encoding='utf-8'));accepted=[]
known={r['title'] for r in manifest['resources']}
for item in json.loads((stage/'shona-downloads.json').read_text(encoding='utf-8')):
    if not item.get('success') or item['title'] in known:continue
    source=stage/'shona'/item['filename'];dest=stage/('shona-normalized-'+item['id']+'.pdf')
    # Publisher generator prepends a debug URL before %PDF. Re-save the parsed
    # document with a standard header; preserve every page, text and licence.
    with fitz.open(source) as doc:
        assert not doc.is_repaired and not doc.needs_pass
        before=[p.get_text() for p in doc]
        assert re.search(r'chishona|shona',' '.join(before),re.I)
        doc.save(dest,garbage=0)
    with fitz.open(dest) as doc:assert before==[p.get_text() for p in doc]
    data=dest.read_bytes();sha=hashlib.sha256(data).hexdigest();name=sha[:24]+'.pdf';shutil.copyfile(dest,bundle/'files'/name)
    credit=item['author']+' and the credited illustrator/translator; African Storybook. CC BY 4.0. Full publisher credits retained.'
    manifest['resources'].append(dict(filename=name,title=item['title'],form_level='Reading library',subject='Shona',category='Readers & stories',source_url=item['source_url'],license='CC-BY-4.0',attribution=credit,description='Illustrated Shona reading practice; a short reader, not a prescribed secondary novel. PDF header normalised; every page and all extracted text preserved. Attribution: '+credit+' Source: '+item['source_url'],sha256=sha,size=len(data),pages=len(before),mime_type='application/pdf',source_sha256=hashlib.sha256(source.read_bytes()).hexdigest()))
for row in manifest['resources']:
    # Unlicensed third-party answer packs are not exam-board publications.
    if re.search(r'trockers|chaks|the trotter|by share|revision test',row['title'],re.I):
        manifest['rejected'].append({'title':row['title'],'reason':'Third-party revision/answer compilation; no redistribution licence verified'});continue
    if 'passage insert' in row['title'].lower() or 'periodic table insert' in row['title'].lower():row['category']='Practical inserts & instructions'
    if row['category']=='Past exam papers' and ' MS.' in row['title']:row['category']='Marking guides'
    if row['category']=='Examiner reports':
        row['form_level']='Form 6' if re.search(r'advanced[ -]+level|\ba[ -]+level',row['title'],re.I) else 'Form 4'
    if row['subject']=='Other subjects':
        normal=row['title'].lower().replace('-',' ')
        for term,name in [('computer science','Computer Science'),('communication skills','Communication Skills'),('bussiness','Business Studies'),('home management','Home Management and Design'),('sport','Physical Education'),('tonga','Tonga'),('tjikalanga','TjiKalanga'),('nambya','Nambya'),('tshivenda','Tshivenda'),('xichangana','Xichangana'),('fashion','Fashion and Textiles'),('wood','Wood Technology'),('metal','Metal Technology'),('technical','Technical Graphics'),('business','Business Studies'),('food','Food Technology'),('literature','Literature'),('statistics','Statistics'),('sociology','Sociology'),('psychology','Psychology'),('commerce','Commerce'),('accounts','Accounting'),('math','Mathematics'),('physical education','Physical Education'),('religious','Family and Religious Studies'),('agric','Agriculture')]:
            if term in normal:row['subject']=name;break
    path=bundle/'files'/row['filename'];data=path.read_bytes()
    assert hashlib.sha256(data).hexdigest()==row['sha256'] and len(data)==row['size']
    if row['mime_type']=='application/pdf':
        with fitz.open(path) as doc:
            assert not doc.is_repaired and not doc.needs_pass and len(doc)==row['pages']
            # Render representative pages to catch corrupt rendering streams.
            for n in {0,len(doc)//2,len(doc)-1}: assert doc[n].get_pixmap(matrix=fitz.Matrix(.15,.15)).width>0
    accepted.append(row)
manifest['resources']=accepted
restored={r['title'] for r in accepted if r['category']=='Readers & stories'}
manifest['rejected']=[r for r in manifest['rejected'] if r.get('title') not in restored]
(bundle/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
with (bundle/'catalog.csv').open('w',encoding='utf-8-sig',newline='') as output:
    columns=['title','form_level','subject','category','pages','size','license','source_url','sha256'];writer=csv.DictWriter(output,fieldnames=columns,extrasaction='ignore');writer.writeheader();writer.writerows(accepted)
summary={'resources':len(accepted),'bytes':sum(r['size'] for r in accepted),'categories':dict(collections.Counter(r['category'] for r in accepted)),'subjects':dict(collections.Counter(r['subject'] for r in accepted)),'rejected':len(manifest['rejected'])}
(bundle/'review-report.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
for name in ['import-expansion.py','storage_helpers.py','prepare-openstax-server.py']:shutil.copyfile(root/'tools/library'/name,bundle/name)
with zipfile.ZipFile(stage/'library-expansion.zip','w',compression=zipfile.ZIP_DEFLATED,compresslevel=1) as archive:
    used={r['filename'] for r in accepted}
    for path in bundle.rglob('*'):
        if path.is_file() and (path.parent!=bundle/'files' or path.name in used): archive.write(path,path.relative_to(bundle))
print(json.dumps(summary))
