/** PostgREST caps each response. Never mistake one page for an entire library. */
export async function readAllPages<T>(read:(start:number,end:number)=>PromiseLike<{data:T[]|null;error:{message:string}|null}>,pageSize=500){
 const rows:T[]=[];
 for(let start=0;;start+=pageSize){
  const result=await read(start,start+pageSize-1);
  if(result.error)return {data:null,error:result.error};
  rows.push(...(result.data||[]));
  if(!result.data||result.data.length<pageSize)return {data:rows,error:null};
 }
}
