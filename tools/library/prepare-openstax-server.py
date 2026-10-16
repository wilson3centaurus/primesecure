"""Server-only publisher downloads. Keeps text intact while reducing image size."""
import sys,json,hashlib,urllib.request,time
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
                while chunk:=response.read(1024*1024):output.write(chunk)
            temp.rename(original)
        dest=root/('openstax-'+str(identity)+'.pdf')
        with fitz.open(original) as doc:
            assert not doc.is_repaired and not doc.needs_pass and len(doc)>10
            before=[hashlib.sha256(p.get_text().encode()).hexdigest() for p in doc]
            copyright=' '.join(doc[i].get_text() for i in range(min(12,len(doc))))
            assert 'creative commons' in copyright.lower()
            if not dest.exists() or dest.stat().st_size<1000:
                doc.rewrite_images(dpi_threshold=180,dpi_target=120,quality=78,bitonal=False)
                doc.save(dest,garbage=3,deflate=True)
        with fitz.open(dest) as doc:
            assert before==[hashlib.sha256(p.get_text().encode()).hexdigest() for p in doc]
            assert not doc.is_repaired
            pages=len(doc)
        data=dest.read_bytes()
        assert len(data)<90000000
        row=dict(title=meta['title'],form_level=form,subject=subject,category='Textbooks',source_url=meta['meta']['html_url'],download_url=url,license=meta.get('license_url','See original copyright page'),filename=dest.name,size=len(data),sha256=hashlib.sha256(data).hexdigest(),pages=pages,mime_type='application/pdf',attribution='OpenStax / Rice University and credited contributors. Full publisher credits and licence retained.',description='Supplementary textbook; form grouping is for teacher review, not ZIMSEC approval. Offline copy has reduced-resolution images; all extracted text and page counts verified unchanged. Free school access only. Source: '+meta['meta']['html_url'],copyright_excerpt=copyright[:12000])
        row['description']+=' Attribution: '+row['attribution']+' Licence: '+str(row['license'])
        rows.append(row); print(json.dumps({'book':identity,'bytes':len(data),'pages':pages}),flush=True)
    except Exception as e: print(json.dumps({'book':identity,'error':str(e)[:250]}),flush=True)
    (root/'openstax-manifest.json').write_text(json.dumps(rows,indent=2))
