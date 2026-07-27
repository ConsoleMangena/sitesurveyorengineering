import { DialogTemplate } from "@/components/templates/DialogTemplate.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Printer, X } from "lucide-react";
import { REPORT_CSS } from "./io/report.ts";

interface CadReportDialogProps {
  open: boolean;
  title: string;
  html: string;
  onClose: () => void;
}

export function CadReportDialog({ open, title, html, onClose }: CadReportDialogProps) {
  const srcDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>${REPORT_CSS}</style>
</head>
<body>${html}</body>
</html>`;

  const handlePrint = () => {
    const win = window.open("", "_blank", "width=900,height=960");
    if (!win) return;
    win.document.write(srcDoc);
    win.document.close();
    win.focus();
  };

  return (
    <DialogTemplate
      open={open}
      onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
      title={title}
      description="Cut / fill volume summary. Use the print button for a PDF-friendly copy."
      size="full"
      className="sm:max-w-4xl p-0 overflow-hidden"
      contentClassName="p-0 overflow-hidden"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
            <Printer size={14} /> Print / PDF
          </Button>
          <Button size="sm" onClick={onClose} className="gap-2">
            <X size={14} /> Close
          </Button>
        </>
      }
    >
      <div className="bg-white">
        <iframe
          title={title}
          srcDoc={srcDoc}
          style={{ width: "100%", height: "60vh", border: "none", display: "block" }}
        />
      </div>
    </DialogTemplate>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
