import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog.tsx";
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
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-4xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-xs text-foreground/70">
            Cut / fill volume summary. Use the print button for a PDF-friendly copy.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-white">
          <iframe
            title={title}
            srcDoc={srcDoc}
            style={{ width: "100%", height: "60vh", border: "none", display: "block" }}
          />
        </div>
        <DialogFooter className="px-6 py-3 border-t gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
            <Printer size={14} /> Print / PDF
          </Button>
          <Button size="sm" onClick={onClose} className="gap-2">
            <X size={14} /> Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
