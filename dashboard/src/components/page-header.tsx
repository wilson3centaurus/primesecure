import { AppWindow, BookOpen, ClipboardList, Download, FolderOpen, Laptop, LayoutDashboard, Mail, MessageCircle, School, Settings, ShieldCheck, Users, BarChart3 } from "lucide-react";
export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  const Icon=/message/i.test(title)?Mail:/support/i.test(title)?MessageCircle:/app|viewer/i.test(title)?AppWindow:/notes|content|wallpaper|files|library/i.test(title)?FolderOpen:/device|student/i.test(title)?Laptop:/setting/i.test(title)?Settings:/polic/i.test(title)?ShieldCheck:/report/i.test(title)?BarChart3:/cases|issues/i.test(title)?ClipboardList:/staff/i.test(title)?Users:/school/i.test(title)?School:/agent|release|update/i.test(title)?Download:/learn/i.test(title)?BookOpen:LayoutDashboard;
  return (
    <div className="page-heading">
      <div className="flex min-w-0 items-center gap-3"><span className="page-heading-icon"><Icon size={20} strokeWidth={1.7}/></span><div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div></div>
      {children}
    </div>
  );
}
