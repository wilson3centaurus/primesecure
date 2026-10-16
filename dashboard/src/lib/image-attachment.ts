// Re-encode selected files as bounded JPEGs; never embed uploaded SVG/HTML.
export async function prepareImage(file: File): Promise<string> {
 if (!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024) throw Error('Choose a JPG, PNG or WebP image under 10 MB.');
 const image=await createImageBitmap(file);
 try {
  if(image.width*image.height>40000000)throw Error('Choose a smaller image.');
  let edge=1000;
  for(let attempt=0;attempt<6;attempt++) {
   const canvas=document.createElement('canvas'),scale=Math.min(1,edge/Math.max(image.width,image.height));
   canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image preview is unavailable.');
   ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
   const encoded=canvas.toDataURL('image/jpeg',0.76);
   if(encoded.length<=100000)return encoded;
   edge=Math.floor(edge*0.78);
  }
  throw Error('Choose a smaller image.');
 } finally {image.close();}
}
