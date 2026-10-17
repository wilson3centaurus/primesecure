export type AppAvailability={school_id:string|null;published:boolean;preinstall:boolean};
export function appAvailable(item:AppAvailability,id:string,enabled:Set<string>){return item.published&&(item.school_id!==null||enabled.has(id));}
export function filterApps<T extends AppAvailability&{id:string;title:string;description:string;package_name:string;version_name:string;storage_path:string}>(items:T[],enabled:Set<string>,query:string,status:string,install:string){
 const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 return items.filter(item=>terms.every(t=>`${item.title} ${item.description} ${item.package_name||''} ${item.version_name||''} ${item.storage_path}`.toLowerCase().includes(t))&&(status==='enabled'?appAvailable(item,item.id,enabled):status==='disabled'?!appAvailable(item,item.id,enabled):status==='withdrawn'?!item.published:true)&&(install==='default'?item.preinstall:install==='optional'?!item.preinstall:true));
}
