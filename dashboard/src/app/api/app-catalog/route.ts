import { requireStaff } from "@/lib/auth";
import catalog from "@/data/app-catalog.json";
export async function GET() {
 await requireStaff();
 return Response.json({source:catalog.source,timestamp:catalog.timestamp,apps:catalog.apps.map(a=>({id:a.id,title:a.title,description:a.description,icon:a.icon,category:a.category,size:a.size,version:a.version,featured:a.featured}))},{headers:{'Cache-Control':'private, max-age=300'}});
}
