"""Create original, openly licensed illustrated school posters; no scraped art."""
from pathlib import Path
import hashlib,json,sys
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor,white
import fitz

OUT=Path(sys.argv[1]);(OUT/'files').mkdir(parents=True,exist_ok=True)
SCHOOL='14eea188-73b1-40bc-8f8d-15afbea27ffa'
SOURCE='https://github.com/wilson3centaurus/primesecure/blob/feat/student-hub/tools/library/create-explore-guides.py'
GUIDES=[
 ('How does it really work?','A robot: sense, decide, act', [('SENSE','A sensor measures light, distance or a button press.'),('DECIDE','The controller compares the reading with a rule.'),('ACT','A motor, light or buzzer produces an output.'),('REPEAT','Measure again. Feedback helps the robot adjust.')]),
 ('How does it really work?','From roots to leaves', [('ROOTS','Absorb water and mineral ions from the soil.'),('STEM','Xylem carries water towards the leaves.'),('LEAVES','Light energy supports photosynthesis using water and carbon dioxide.'),('GROWTH','Sugars support respiration, growth and storage; oxygen is released.')]),
 ('DIY','Plan a paper bridge', [('PLAN','Use paper, two supports and a few identical coins. Ask your teacher first.'),('BUILD','Compare a flat sheet, a folded beam and an accordion fold.'),('TEST','Keep the span and paper size the same. Add coins one at a time.'),('IMPROVE','Record the load each design holds. Explain why folds may help.')]),
 ('DIY','Sketch your first robot', [('PURPOSE','Choose one task, such as warning when an object is near.'),('PARTS','Draw a sensor, controller, output and suitable power supply.'),('RULE','Write: if distance is below the threshold, turn the buzzer on.'),('SAFETY','Have a teacher check real wiring. Never connect directly to mains electricity.')]),
 ('Life lessons','Pause before you share', [('PAUSE','Would you be comfortable if your teacher or family saw it?'),('CHECK','Is it true? Do you have permission to share the photo or file?'),('RESPECT','Do not forward private, harmful or humiliating material.'),('ASK','If something worries you, contact a trusted adult or school support.')]),
 ('Life lessons','Ask for help clearly', [('DESCRIBE','Explain what you were trying to do.'),('SHOW','Write the error and attach a relevant screenshot without passwords.'),('EXPLAIN','Say what happened and what you expected instead.'),('FOLLOW UP','Read the reply, try the suggestion and explain the result.')]),
 ('Motivational statements','Small steps still count', [('START','Choose one small task you can finish today.'),('FOCUS','Give it your attention for a short, planned study session.'),('NOTICE','Write down one thing you now understand better.'),('CONTINUE','Rest, then take the next step. Progress grows through practice.')]),
 ('Motivational statements','A mistake can teach you', [('TRY','Make an honest attempt before looking at the answer.'),('COMPARE','Find the first step where your reasoning changed.'),('CORRECT','Explain the correction in your own words.'),('RETURN','Try a similar problem later without the solution.')]),
 ('Key to passing and success','Study with recall', [('RECALL','Close the book and write what you remember.'),('CHECK','Compare with your notes and fill the gaps.'),('SPACE','Revisit the topic on different days.'),('PRACTISE','Use questions, mark your work and review errors.')]),
 ('Key to passing and success','Make a past paper useful', [('PREPARE','Check the syllabus, paper instructions and permitted materials.'),('ATTEMPT','Work under a realistic time limit when ready.'),('MARK','Use an authorised marking guide; ask about unclear answers.'),('REVISE','List weak topics, practise them, then attempt another paper.')]),
]
rows=[]
for folder,title,steps in GUIDES:
    temporary=OUT/'poster.pdf';c=canvas.Canvas(str(temporary),pagesize=(620,860),invariant=1)
    c.setTitle(title);c.setAuthor('RoboKorda');c.setFillColor(HexColor('#f2f4ff'));c.rect(0,0,620,860,fill=1,stroke=0)
    c.setFillColor(HexColor('#6553dc'));c.roundRect(28,713,564,120,18,fill=1,stroke=0)
    c.setFillColor(white);c.setFont('Helvetica',11);c.drawString(48,802,'RO B O K O R D A  /  EXPLORE & GROW')
    c.setFont('Helvetica-Bold',23);c.drawString(48,759,title)
    import textwrap
    for n,(label,body) in enumerate(steps):
        y=562-n*143;c.setFillColor(white);c.roundRect(48,y,524,124,14,fill=1,stroke=0)
        c.setFillColor(HexColor('#6553dc'));c.circle(77,y+87,16,fill=1,stroke=0);c.setFillColor(white);c.setFont('Helvetica-Bold',13);c.drawCentredString(77,y+82,str(n+1))
        c.setFillColor(HexColor('#202b4a'));c.setFont('Helvetica-Bold',12);c.drawString(105,y+83,label)
        c.setFont('Helvetica',12)
        for k,line in enumerate(textwrap.wrap(body,66)):c.drawString(69,y+53-k*17,line)
        if n<3:
            c.setStrokeColor(HexColor('#6553dc'));c.setLineWidth(2);c.line(310,y-2,310,y-15);c.line(305,y-10,310,y-15);c.line(315,y-10,310,y-15)
    c.setFillColor(HexColor('#53617d'));c.setFont('Helvetica',9);c.drawString(48,32,'Original RoboKorda learning guide - CC BY 4.0 - Free school use and sharing with credit.')
    c.save()
    with fitz.open(temporary) as doc:data=doc[0].get_pixmap(matrix=fitz.Matrix(1.2,1.2),alpha=False).tobytes('png')
    digest=hashlib.sha256(data).hexdigest();name=digest[:24]+'.png';(OUT/'files'/name).write_bytes(data)
    rows.append(dict(filename=name,sha256=digest,size=len(data),title=title,form_level='Explore & grow',subject=folder,category='Illustrated guides',mime_type='image/png',description='Original illustrated school guide. RoboKorda, CC BY 4.0. '+body,source_url=SOURCE,license='CC BY 4.0',attribution='RoboKorda, original educational text and diagrams'))
temporary.unlink()
(OUT/'manifest.json').write_text(json.dumps({'school_id':SCHOOL,'resources':rows},indent=2))
print(json.dumps({'original_illustrated_guides':len(rows),'bytes':sum(r['size'] for r in rows)}))
