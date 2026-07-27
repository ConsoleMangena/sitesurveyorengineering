import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface LineItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
}

interface LineItemsEditorProps {
  items: LineItem[];
  onChange: (
    id: string,
    field: keyof LineItem,
    value: string | number,
  ) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  className?: string;
}

export function LineItemsEditor({
  items,
  onChange,
  onAdd,
  onRemove,
  className,
}: LineItemsEditorProps) {
  const total = items.reduce(
    (sum, item) => sum + (Number(item.qty) || 0) * (Number(item.rate) || 0),
    0,
  );
  const vat = total * 0.15;

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="bg-muted/60">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-1/2">
                  Description
                </th>
                <th className="text-right px-3 py-2 font-medium w-20">Qty</th>
                <th className="text-left px-3 py-2 font-medium w-28">Unit</th>
                <th className="text-right px-3 py-2 font-medium w-28">Rate</th>
                <th className="text-right px-3 py-2 font-medium w-28">Total</th>
                <th className="px-3 py-2 w-12" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const itemTotal =
                  (Number(item.qty) || 0) * (Number(item.rate) || 0);
                return (
                  <tr
                    key={item.id}
                    className="border-t last:border-b hover:bg-muted/30"
                  >
                    <td className="px-3 py-2">
                      <Input
                        placeholder="Item description"
                        value={item.description}
                        onChange={(e) =>
                          onChange(item.id, "description", e.target.value)
                        }
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={item.qty}
                        onChange={(e) =>
                          onChange(
                            item.id,
                            "qty",
                            Number(e.target.value) || 0,
                          )
                        }
                        className="h-8 text-right"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        placeholder="Unit"
                        value={item.unit}
                        onChange={(e) =>
                          onChange(item.id, "unit", e.target.value)
                        }
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={item.rate}
                        onChange={(e) =>
                          onChange(
                            item.id,
                            "rate",
                            Number(e.target.value) || 0,
                          )
                        }
                        className="h-8 text-right"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatCurrency(itemTotal)}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(item.id)}
                        disabled={items.length === 1}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove line item ${index + 1}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t bg-muted/20">
          <Button variant="outline" size="sm" onClick={onAdd} className="gap-1">
            <Plus size={14} />
            Add Line Item
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <div className="w-full max-w-xs space-y-2 text-sm bg-muted/40 rounded-lg p-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT (15%)</span>
            <span>{formatCurrency(vat)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-bold">
            <span>Total Amount</span>
            <span>{formatCurrency(total + vat)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
