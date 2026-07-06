import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Download, ArrowUpDown, Save, Undo2 } from 'lucide-react';
import { Button } from './button';
import { cn, formatNumber } from '@/lib/utils';

export interface EditableConfig {
  type: 'text' | 'number' | 'dropdown';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  displayMultiplier?: number;
}

export interface ColumnDef<T> {
  key: keyof T | string;
  header: string;
  isNumeric?: boolean;
  render?: (row: T, editedValue?: any) => React.ReactNode;
  totalsRender?: (value: number) => React.ReactNode;
  width?: string;
  sticky?: boolean;
  editable?: EditableConfig;
  cellClassName?: (row: T) => string;
  headerClassName?: string;
  hidden?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  title?: string;
  totals?: Partial<Record<string, number>>;
  rowKey?: keyof T;
  onBatchSave?: (updates: { id: number; [key: string]: any }[], clearEdits: () => void) => void;
  isSaving?: boolean;
  isLoading?: boolean;
  actionBar?: React.ReactNode;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  resetPageSignal?: number;
  /**
   * Auto-fit the page size to the available viewport height (default).
   * Approximate row/header heights are used; off-by-one is acceptable.
   * Pass `false` to restore the manual "Show ## entries" dropdown.
   */
  dynamicPageSize?: boolean;
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  title,
  totals,
  rowKey = 'id' as keyof T,
  onBatchSave,
  isSaving,
  isLoading,
  actionBar,
  onRowClick,
  rowClassName,
  resetPageSignal,
  dynamicPageSize = true,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [pendingEdits, setPendingEdits] = useState<Map<number, Record<string, any>>>(new Map());
  const [selectedRowId, setSelectedRowId] = useState<number | string | null>(null);

  React.useEffect(() => {
    if (resetPageSignal !== undefined) setPage(1);
  }, [resetPageSignal]);

  // Dynamic page sizing: when enabled, fit as many rows as the viewport allows.
  // Approximations (row ≈ 41px including padding+border, header ≈ 44px, totals
  // row ≈ 44px, footer ≈ 60px). Recomputes on window resize.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dynamicPageSize) return;
    const ROW_H = 41;
    const HEADER_H = 44;
    const TOTALS_H = 44;
    const FOOTER_H = 60;
    const compute = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const available = window.innerHeight - top - FOOTER_H;
      const usable = available - HEADER_H - (totals ? TOTALS_H : 0);
      const next = Math.max(5, Math.floor(usable / ROW_H));
      setPageSize(next);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [dynamicPageSize, !!totals]);

  const visibleColumns = useMemo(() => columns.filter(c => !c.hidden), [columns]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const result = aVal < bVal ? -1 : 1;
      return sortDir === 'asc' ? result : -result;
    });
  }, [data, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));

  React.useEffect(() => {
    setPage(p => Math.min(p, Math.max(1, Math.ceil(data.length / pageSize))));
  }, [data.length, pageSize]);

  const safePage = Math.min(page, totalPages);

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, safePage, pageSize]);

  const handleCellEdit = useCallback((rowId: number, key: string, value: any) => {
    setPendingEdits(prev => {
      const next = new Map(prev);
      const existing = next.get(rowId) || {};
      existing[key] = value;
      next.set(rowId, existing);
      return next;
    });
  }, []);

  const getCellValue = useCallback((row: T, key: string) => {
    const rowId = row[rowKey as keyof T] as number;
    const edits = pendingEdits.get(rowId);
    if (edits && key in edits) return edits[key];
    return row[key as keyof T];
  }, [pendingEdits, rowKey]);

  const handleSave = useCallback(() => {
    if (!onBatchSave) return;
    const updates = Array.from(pendingEdits.entries()).map(([id, changes]) => ({
      id,
      ...changes,
    }));
    onBatchSave(updates, () => setPendingEdits(new Map()));
  }, [pendingEdits, onBatchSave]);

  const handleDiscard = useCallback(() => {
    setPendingEdits(new Map());
  }, []);

  const editCount = pendingEdits.size;
  const hasEdits = editCount > 0;

  const exportCSV = () => {
    const headers = visibleColumns.map(c => c.header).join(',');
    const rows = sortedData.map(row =>
      visibleColumns.map(c => {
        const raw = row[c.key as keyof T];
        const val = typeof raw === 'string' ? `"${raw.replace(/"/g, '""')}"` : raw;
        return val ?? '';
      }).join(',')
    ).join('\n');
    const blob = new Blob([`${headers}\n${rows}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'export'}.csv`;
    a.click();
  };

  return (
    <div className="w-full flex flex-col bg-card rounded-2xl border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b bg-card gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-foreground font-display whitespace-nowrap">{title || t('dataTable.dataList')}</h2>
          {actionBar}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasEdits && (
            <>
              <Button variant="outline" size="sm" onClick={handleDiscard} className="gap-1.5 rounded-lg text-muted-foreground">
                <Undo2 className="w-3.5 h-3.5" /> {t('dataTable.discardChanges')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1.5 rounded-lg">
                <Save className="w-3.5 h-3.5" />
                {t('dataTable.saveChanges')}
                <span className="ml-1 bg-white/20 px-1.5 py-0.5 rounded text-xs font-bold">{editCount}</span>
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-2 rounded-lg">
            <Download className="w-4 h-4" /> {t('common.export')}
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="w-full overflow-auto max-h-[calc(100vh-320px)] relative">
        {isLoading && (
          <div className="absolute inset-0 bg-card/60 z-30 flex items-center justify-center">
            <div className="w-7 h-7 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-xs text-muted-foreground uppercase bg-card border-b sticky top-0 z-30 shadow-[0_2px_4px_-1px_rgba(0,0,0,0.06)]">
            <tr>
              {visibleColumns.map((col) => (
                <th
                  key={col.key as string}
                  className={cn(
                    "px-3 py-3 font-semibold cursor-pointer hover:bg-secondary/10 transition-colors select-none",
                    col.isNumeric ? "text-right" : "text-left",
                    col.sticky && "sticky left-0 bg-card z-40 border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]",
                    col.editable && "bg-sky-50 border-b-2 border-b-sky-300",
                    col.width,
                    col.headerClassName
                  )}
                  onClick={() => handleSort(col.key as string)}
                >
                  <div className={cn("flex items-center gap-1", col.isNumeric && "justify-end")}>
                    {col.header}
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-primary" /> : <ChevronDown className="w-3 h-3 text-primary" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {totals && (
              <tr className="bg-primary/5 font-semibold text-foreground border-b border-primary/20">
                {visibleColumns.map((col, i) => (
                  <td
                    key={`total-${col.key as string}`}
                    className={cn(
                      "px-3 py-2.5",
                      col.isNumeric ? "text-right" : "text-left",
                      col.sticky && "sticky left-0 bg-teal-50 z-20 border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
                    )}
                  >
                    {!col.isNumeric && i === visibleColumns.findIndex(c => !c.isNumeric) ? `TOTALS (${formatNumber(sortedData.length)})` : totals[col.key as string] !== undefined ? (col.totalsRender ? col.totalsRender(totals[col.key as string]!) : formatNumber(Math.round(totals[col.key as string]!), 0)) : ""}
                  </td>
                ))}
              </tr>
            )}

            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-12 text-center text-muted-foreground">
                  No data available.
                </td>
              </tr>
            ) : (
              paginatedData.map((row, i) => {
                const rowId = row[rowKey as keyof T] as number;
                const isEdited = pendingEdits.has(rowId);
                const isSelected = selectedRowId !== null && selectedRowId === rowId;
                return (
                  <tr
                    key={rowId ?? i}
                    className={cn(
                      "border-b last:border-0 transition-colors even:bg-secondary/5",
                      isSelected
                        ? "bg-yellow-100 hover:bg-yellow-200 even:bg-yellow-100"
                        : "hover:bg-accent/5",
                      isEdited && "ring-1 ring-inset ring-amber-300/50",
                      "cursor-pointer",
                      rowClassName?.(row)
                    )}
                    onClick={() => {
                      setSelectedRowId(rowId);
                      onRowClick?.(row);
                    }}
                  >
                    {visibleColumns.map((col) => {
                      const cellValue = getCellValue(row, col.key as string);
                      const originalValue = row[col.key as keyof T];
                      const cellClass = col.cellClassName?.(row);

                      return (
                        <td
                          key={col.key as string}
                          className={cn(
                            "px-3 py-2",
                            col.isNumeric ? "text-right" : "text-left",
                            col.sticky && "sticky left-0 z-20 border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]",
                            col.sticky && (isSelected ? "bg-yellow-100" : "bg-card"),
                            col.editable && !isSelected && "bg-sky-50/60",
                            col.width,
                            cellClass
                          )}
                        >
                          {col.editable ? (
                            <EditableCell
                              config={col.editable}
                              value={cellValue}
                              originalValue={originalValue}
                              onChange={(val) => handleCellEdit(rowId, col.key as string, val)}
                              isNumeric={col.isNumeric}
                            />
                          ) : col.render ? (
                            col.render(row, cellValue)
                          ) : (
                            cellValue as React.ReactNode
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t bg-secondary/5">
        {dynamicPageSize ? (
          <div className="text-sm text-muted-foreground">
            Auto-fit: {pageSize} rows per page
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Show</span>
            <select
              className="bg-transparent border border-input rounded-md px-2 py-1 focus:ring-1 focus:ring-primary outline-none"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>entries</span>
          </div>
        )}

        <div className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground mr-4">
            Showing {Math.min((safePage - 1) * pageSize + 1, sortedData.length)} to {Math.min(safePage * pageSize, sortedData.length)} of {sortedData.length} entries
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="h-8 w-8 p-0"
          >
            &lt;
          </Button>
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground font-medium">
            {safePage}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => p + 1)}
            disabled={safePage >= totalPages}
            className="h-8 w-8 p-0"
          >
            &gt;
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditableCell({
  config,
  value,
  originalValue,
  onChange,
  isNumeric,
}: {
  config: EditableConfig;
  value: any;
  originalValue: any;
  onChange: (val: any) => void;
  isNumeric?: boolean;
}) {
  const isChanged = value !== originalValue;

  if (config.type === 'dropdown') {
    return (
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={cn(
          "w-full bg-transparent border border-transparent rounded px-1.5 py-0.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none hover:border-input transition-colors",
          isChanged && "bg-amber-50 border-amber-300"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">—</option>
        {config.options?.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  if (config.type === 'number') {
    const mult = config.displayMultiplier ?? 1;
    const displayVal = value != null ? Number((value * mult).toFixed(10)) : '';
    const displayOrig = originalValue != null ? Number((originalValue * mult).toFixed(10)) : '';
    const displayChanged = String(displayVal) !== String(displayOrig);
    const suffix = mult !== 1 ? '%' : null;
    return (
      <span className={suffix ? "inline-flex items-center gap-0.5" : undefined}>
        <input
          type="number"
          value={displayVal}
          min={config.min}
          max={config.max}
          onChange={(e) => {
            let num = e.target.value === '' ? null : Number(e.target.value);
            if (num !== null && config.min !== undefined) num = Math.max(config.min, num);
            if (num !== null && config.max !== undefined) num = Math.min(config.max, num);
            onChange(num !== null ? num / mult : null);
          }}
          className={cn(
            "w-20 bg-transparent border border-transparent rounded px-1.5 py-0.5 text-sm text-right focus:border-primary focus:ring-1 focus:ring-primary outline-none hover:border-input transition-colors",
            displayChanged && "bg-amber-50 border-amber-300"
          )}
          onClick={(e) => e.stopPropagation()}
        />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </span>
    );
  }

  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        "w-full bg-transparent border border-transparent rounded px-1.5 py-0.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none hover:border-input transition-colors",
        isChanged && "bg-amber-50 border-amber-300"
      )}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
