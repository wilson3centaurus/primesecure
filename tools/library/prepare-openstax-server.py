"""Server-only publisher downloads with a bounded additional textbook budget."""
import sys,json,hashlib,urllib.request,time,shutil
from pathlib import Path
sys.path.insert(0,'/root/primesecure-library-python')
import pymupdf as fitz
root=Path('/root/primesecure-library-stage');root.mkdir(exist_ok=True)
rows=[]
books=[(415,'Form 4','Physics'),(392,'Form 1','Mathematics'),(414,'Form 2','Mathematics'),(418,'Form 3','Mathematics'),(551,'Form 5','Mathematics'),(74,'Form 6','Mathematics'),(555,'Form 3','English'),(847,'Form 3','Computer Science')]
for identity,form,subject in books:
    try:
        with urllib.request.urlopen('https://openstax.org/apps/cms/api/v2/pages/'+str(identity)+'/',timeout=45) as response: meta=json.load(response)
        url=meta['pdf_url']; url=('https://openstax.org'+url if url.startswith('/') else url)
        original=root/('openstax-'+str(identity)+'-original.pdf')
        if identity==415 and (root/'openstax-physics.pdf').exists(): original=root/'openstax-physics.pdf'
        if not original.exists():
            temp=original.with_suffix('.part')
            with urllib.request.urlopen(url,timeout=90) as response,temp.open('wb') as output:
                length=int(response.headers.get('Content-Length',0))
                if length>90000000 or sum(r['size'] for r in rows)+length>300000000:
                    print(json.dumps({'book':identity,'skipped':'additional textbook budget'}),flush=True);continue
                size=0
                while chunk:=response.read(1024*1024):
                    size+=len(chunk);assert size<90000000;output.write(chunk)
            temp.rename(original)
        if sum(r['size'] for r in rows)+original.stat().st_size>300000000:continue
        dest=root/('openstax-'+str(identity)+'.pdf')
        with fitz.open(original) as doc:
            assert not doc.is_repaired and not doc.needs_pass and len(doc)>10
            before=[hashlib.sha256(p.get_text().encode()).hexdigest() for p in doc]
            copyright=' '.join(doc[i].get_text() for i in range(min(12,len(doc))))
            assert 'creative commons' in copyright.lower()
            shutil.copyfile(original,dest)
        with fitz.open(dest) as doc:
            assert before==[hashlib.sha256(p.get_text().encode()).hexdigest() for p in doc]
            assert not doc.is_repaired
            pages=len(doc)
        data=dest.read_bytes()
        assert len(data)<90000000
        row=dict(title=meta['title'],form_level=form,subject=subject,category='Textbooks',source_url=meta['meta']['html_url'],download_url=url,license=meta.get('license_url','See original copyright page'),filename=dest.name,size=len(data),sha256=hashlib.sha256(data).hexdigest(),pages=pages,mime_type='application/pdf',attribution='OpenStax / Rice University and credited contributors. Full publisher credits and licence retained.',description='Supplementary textbook; form grouping is for teacher review, not ZIMSEC approval. Original publisher PDF, unmodified. Free school access only. Source: '+meta['meta']['html_url'],copyright_excerpt=copyright[:12000])
        row['description']+=' Attribution: '+row['attribution']+' Licence: '+str(row['license'])
        rows.append(row); print(json.dumps({'book':identity,'bytes':len(data),'pages':pages}),flush=True)
    except Exception as e: print(json.dumps({'book':identity,'error':str(e)[:250]}),flush=True)
    (root/'openstax-manifest.json').write_text(json.dumps(rows,indent=2))
