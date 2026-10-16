"""Prepare the reviewed October 2026 school library; never publishes by itself.

Inputs are publisher downloads under artifacts/school-library-expansion.
Retains source URLs, rejects repaired/encrypted PDFs and deduplicates by SHA256.
"""
from pathlib import Path
import json, hashlib, re, shutil, html, os
import fitz
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT=Path(__file__).resolve().parents[2]
STAGE=ROOT/'artifacts/school-library-expansion'
OUT=STAGE/'bundle'
FILES=OUT/'files'
FILES.mkdir(parents=True,exist_ok=True)
rows=[]; rejected=[]; seen=set()
SUBJECTS=['Agriculture Engineering','Agricultural Engineering','Food Technology and Design','Physical Education','Guidance and Counselling','Business Enterprise Skills','Building Technology and Design','Family and Religious Studies','Communication Skills','Combined Science','Computer Science','Additional Mathematics','Pure Mathematics','Economic History','Commercial Studies','Business Studies','Animal Science','Crop Science','Design and Technology','Design & Technology','Building Technology','Mathematics','Accounting','Biology','Chemistry','Physics','Geography','History','Economics','Horticulture','Agriculture','English','Shona','Heritage','Art','Dance','French','Ndebele','Literature','Textile','Music']
def load(name): return json.loads((STAGE/name).read_text(encoding='utf-8'))
def subject(title):
    text=title.lower().replace('maths','mathematics')
    return next((s.replace('Design & Technology','Design and Technology') for s in SUBJECTS if s.lower() in text),'Other subjects')
def add(path,title,form,sub,category,source,licence,credit,notes=''):
    data=path.read_bytes(); sha=hashlib.sha256(data).hexdigest()
    if sha in seen: return
    if path.suffix=='.pdf':
        try:
            with fitz.open(path) as doc:
                assert len(doc)>0 and not doc.is_repaired and not doc.needs_pass
                assert data.startswith(b'%PDF-') and b'%%EOF' in data[-2048:]
                pages=len(doc)
        except Exception as e:
            rejected.append({'title':title,'reason':'Invalid PDF: '+str(e)});return
    else: pages=None
    seen.add(sha)
    filename=sha[:24]+path.suffix
    shutil.copyfile(path,FILES/filename)
    rows.append(dict(filename=filename,title=title.removesuffix('.pdf')[:160],form_level=form,subject=sub,category=category,source_url=source,license=licence,attribution=credit,description=(notes+' Attribution: '+credit+' Source: '+source).strip(),sha256=sha,size=len(data),pages=pages,mime_type='application/pdf' if path.suffix=='.pdf' else 'image/png'))

for item in load('sytbay-downloads.json'):
    if not item.get('success'): rejected.append(item);continue
    title=item['title']; low=title.lower(); path=STAGE/'sytbay-pdfs'/item['filename']
    with fitz.open(path) as doc: cover=' '.join(doc[i].get_text() for i in range(min(3,len(doc)))).lower()
    # Printed level wins over distributor labels, which sometimes mislabel 4000-series papers.
    advanced=bool(re.search(r'advanced\s+level|forms?\s*5\s*[-–]\s*6|a[ -]level',cover))
    ordinary=bool(re.search(r'ordinary\s+level|forms?\s*1\s*[-–]\s*4|o[ -]level',cover))
    if ordinary and not advanced: level='O-Level'
    elif advanced: level='A-Level'
    else: level='A-Level' if re.search(r'a[ -]level',low) else 'O-Level'
    if 'syllab' in low and 'specimen' not in low:
        category='Archived syllabuses' if '2015' in low else level+' syllabuses'
        form='Syllabuses'
    else:
        form='Form 6' if level=='A-Level' else 'Form 4'
        category='Specimen papers' if 'specimen' in low else ('Marking guides' if any(x in low for x in ['marking','memo','answers']) else 'Past exam papers')
        if any(x in low for x in ['supervisor','booking form','dimension form','instructions']): category='Practical inserts & instructions'
    add(path,title,form,subject(title),category,item['page_url'],'Educational exam-board material','ZIMSEC / Ministry of Primary and Secondary Education; public educational download via Sytbay Academy. Ownership notices retained.','School-private educational reference. '+level+'. Verify the printed syllabus and examination year; legacy papers may follow an older curriculum.')

for item in load('official-downloads.json'):
    if not item.get('success'): continue
    text=item.get('first_text','').lower(); title=item['title']
    if 'grade 7' in text or 'grade seven' in text: continue
    if not ('report' in text and ('examin' in text)): rejected.append({'title':title,'reason':'Report identity not confirmed'});continue
    advanced='advanced level' in text or title.upper().startswith('A LEVEL')
    add(STAGE/'official-pdfs'/item['filename'],title+' - Examiner report','Form 6' if advanced else 'Form 4',subject(title),'Examiner reports',item['page_url'],'Official educational examiner report','Zimbabwe School Examinations Council. Original official report; ownership notices retained.','Feedback and revision guidance, not a past question paper. November 2022 unless otherwise printed.')

for item in load('shona-downloads.json'):
    if not item.get('success'): continue
    path=STAGE/'shona'/item['filename']
    with fitz.open(path) as doc: text=' '.join(p.get_text() for p in doc)
    if not re.search(r'chishona|shona',text,re.I): rejected.append({'title':item['title'],'reason':'Shona language not confirmed'});continue
    add(path,item['title'],'Reading library','Shona','Readers & stories',item['source_url'],'CC-BY-4.0',item['author']+' and the credited illustrator/translator; African Storybook, CC BY 4.0. Full credits retained.','Illustrated Shona reading practice; a short reader, not a prescribed secondary novel.')

font=Path(os.environ.get('PRIMESECURE_LIBRARY_FONT','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('LibrarySans',str(font)))
styles=getSampleStyleSheet()
for style in styles.byName.values(): style.fontName='LibrarySans'
styles['BodyText'].fontSize=10;styles['BodyText'].leading=15
for item in load('novel-candidates.json'):
    if not item.get('success'): continue
    text=(STAGE/'gutenberg'/item['filename']).read_text(encoding='utf-8-sig')
    assert 'PROJECT GUTENBERG' in text.upper() and len(text)>20000
    path=STAGE/('novel-'+str(item['id'])+'.pdf')
    story=[Paragraph(html.escape(item['title']),styles['Title']),Paragraph(html.escape(item['author']),styles['Heading2']),Paragraph('Public-domain literature. Source and full Project Gutenberg licence retained below. Suggested reading level is for teacher review; this is not a prescribed ZIMSEC text.',styles['BodyText']),Spacer(1,18)]
    for para in re.split(r'\n\s*\n',text):
        cleaned=re.sub(r'\s+',' ',para).strip()
        if cleaned: story.extend([Paragraph(html.escape(cleaned),styles['BodyText']),Spacer(1,6)])
    def footer(canvas,doc):
        canvas.setFont('LibrarySans',8);canvas.drawString(42,24,item['title'][:75]);canvas.drawRightString(550,24,str(doc.page))
    if not path.exists() or path.stat().st_size<1000:
        SimpleDocTemplate(str(path),leftMargin=44,rightMargin=44,topMargin=44,bottomMargin=42).build(story,onFirstPage=footer,onLaterPages=footer)
    add(path,item['title']+' - '+item['author'],'Reading library','English','Plays' if item['id'] in [23042,1514,1524,1533] else 'Novels',item['page_url'],'Public domain',item['author']+'; Project Gutenberg transcription. Source text and Gutenberg licence retained.','Reformatted as an offline PDF; no abridgement. Teacher review recommended.')

guide=STAGE/'downloads/sparkfun-v41a.pdf'
url='https://github.com/sparkfun/SIK_Guide'
credit='SparkFun Electronics, Inventor\'s Kit Guide v4.1a, CC BY-SA 4.0. Publisher credits retained.'
add(guide,'SparkFun Inventor Kit - complete corrected v4.1a guide','Form 3','Robotics','Textbooks',url,'CC-BY-SA-4.0',credit,'Supplementary robotics reference for Forms 1-3; kit-specific wiring. Teacher-supervised low-voltage work only.')
with fitz.open(guide) as original:
    for form,title,start,end in [('Form 1','Breadboards, components and LED circuits',3,36),('Form 2','Buttons, sound, servo and distance sensors',37,71),('Form 3','Displays, motors and autonomous robot',72,107)]:
        out=fitz.open();out.insert_pdf(original,from_page=0,to_page=2);out.insert_pdf(original,from_page=start,to_page=end);out.insert_pdf(original,from_page=111,to_page=111)
        path=STAGE/(form.replace(' ','-')+'-robotics.pdf');out.save(path,garbage=0,deflate=True);out.close()
        add(path,title+' - practical robotics',''+form,'Robotics','Practical handouts',url,'CC-BY-SA-4.0',credit,'Excerpt selected for '+form+'. Original printed page numbers retained. Supplementary grouping, not an official ZIMSEC syllabus. Teacher-supervised low-voltage circuits only.')
    for form,page,title in [('Form 1',16,'LED and resistor breadboard wiring'),('Form 1',22,'Potentiometer circuit connections'),('Form 2',57,'Servo motor circuit connections'),('Form 2',62,'Ultrasonic distance sensor connections'),('Form 3',94,'Motor driver wiring'),('Form 3',104,'Autonomous robot wiring')]:
        path=STAGE/('robotics-diagram-'+str(page)+'.png');original[page].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(path)
        add(path,title,form,'Robotics','Diagrams',url,'CC-BY-SA-4.0',credit,'Rendered guide page '+str(page+1)+'. Teacher-supervised low-voltage circuit; confirm component compatibility before connecting.')

for item in json.loads((ROOT/'artifacts/learning-library/downloaded-textbooks.json').read_text(encoding='utf-8')):
    if item['license']=='CC-BY-NC-4.0':
        add(ROOT/'artifacts/learning-library/files'/item['filename'],item['title'],item['form_level'],item['subject'],'Textbooks',item['source_url'],item['license'],item['attribution'],'Free noncommercial school access. South African CAPS supplement; form placement is for teacher review, not ZIMSEC approval.')
(OUT/'manifest.json').write_text(json.dumps({'schema_version':1,'school_id':'14eea188-73b1-40bc-8f8d-15afbea27ffa','resources':rows,'rejected':rejected},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'resources':len(rows),'bytes':sum(x['size'] for x in rows),'rejected':len(rejected)}))
