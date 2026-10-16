"""Split large CC BY publisher PDFs into verified, fully attributed volumes.

Every source page remains present. Original licence/credit pages are repeated in
later volumes; text and representative rendered pages are checked after saving.
"""
from pathlib import Path
import argparse,hashlib,json
import fitz

p=argparse.ArgumentParser();p.add_argument('manifest',type=Path);p.add_argument('--limit',type=int,default=45000000);args=p.parse_args()
rows=json.loads(args.manifest.read_text());output=[]
for row in rows:
    source=args.manifest.parent/row['filename']
    assert hashlib.sha256(source.read_bytes()).hexdigest()==row['sha256']
    with fitz.open(source) as original:
        credits=[i for i in range(min(40,len(original))) if any(s in original[i].get_text().lower() for s in ['creative commons','creativecommons.org/licenses/'])]
        assert credits,'Cannot identify original publisher licence pages'
        first=list(range(max(credits)+1));parts=[]
        def save(start,end):
            part=fitz.open();prefix=[i for i in first if i<start]
            for i in prefix:part.insert_pdf(original,from_page=i,to_page=i)
            part.insert_pdf(original,from_page=start,to_page=end-1)
            path=args.manifest.parent/(source.stem+'-pages-'+str(start+1)+'-'+str(end)+'.pdf')
            part.save(path,garbage=3,deflate=True);part.close()
            if path.stat().st_size>args.limit:
                path.unlink();assert end-start>1,'One source page exceeds the file limit'
                middle=(start+end)//2;save(start,middle);save(middle,end);return
            with fitz.open(path) as check:
                assert not check.is_repaired and len(check)==len(prefix)+end-start
                for n,i in enumerate(prefix+list(range(start,end))):
                    assert check[n].get_text()==original[i].get_text(),'Text changed during splitting'
                for n,i in [(len(prefix),start),(len(check)-1,end-1)]:
                    assert check[n].get_pixmap().samples==original[i].get_pixmap().samples,'Page appearance changed'
            parts.append((start,end,path))
        for start in range(0,len(original),250):save(start,min(start+250,len(original)))
        assert sum(end-start for start,end,path in parts)==len(original)
        for n,(start,end,path) in enumerate(parts,1):
            data=path.read_bytes();extra=dict(row)
            extra.update(title=row['title']+' - volume '+str(n)+' of '+str(len(parts)),filename=path.name,size=len(data),sha256=hashlib.sha256(data).hexdigest(),pages=len(first)+end-start)
            extra['description']='Supplementary textbook; teacher review required for ZIMSEC alignment. Split from the publisher original without changing page content. Original PDF pages '+str(start+1)+'-'+str(end)+' of '+str(len(original))+'. Publisher licence and credit pages retained/repeated. '+row['attribution']+' Source: '+row['source_url']+' Licence: '+row['license']
            output.append(extra)
target=args.manifest.parent/'openstax-volumes.json';target.write_text(json.dumps(output,indent=2))
print(json.dumps({'verified_volumes':len(output),'bytes':sum(r['size'] for r in output),'manifest':str(target)}))
