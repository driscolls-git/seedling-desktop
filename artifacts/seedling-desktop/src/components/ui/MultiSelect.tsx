import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, ChevronDown } from 'lucide-react';

interface MultiSelectProps {
  value: number[];
  onChange: (val: number[]) => void;
  options: { value: number; label: string }[];
  placeholder?: string;
  className?: string;
}

export function MultiSelect({ value, onChange, options, placeholder = 'All', className = '' }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search) return options;
    const lower = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(lower));
  }, [options, search]);

  const selectedLabels = useMemo(() => {
    const map = new Map(options.map(o => [o.value, o.label]));
    return value.map(v => map.get(v) || String(v));
  }, [value, options]);

  const toggle = (v: number) => {
    if (value.includes(v)) {
      onChange(value.filter(x => x !== v));
    } else {
      onChange([...value, v]);
    }
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(''); }}
        className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-background focus:ring-1 focus:ring-primary outline-none flex items-center gap-1 min-h-[34px] text-left"
      >
        <div className="flex-1 flex flex-wrap gap-1 min-w-0">
          {value.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : value.length <= 2 ? (
            selectedLabels.map((label, i) => (
              <span key={value[i]} className="inline-flex items-center gap-0.5 bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-medium max-w-[120px] truncate">
                {label}
                <X className="w-3 h-3 shrink-0 cursor-pointer hover:text-destructive" onClick={e => { e.stopPropagation(); toggle(value[i]); }} />
              </span>
            ))
          ) : (
            <span className="text-xs font-medium text-primary">{value.length} selected</span>
          )}
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-card border rounded-lg shadow-lg overflow-hidden">
          <div className="p-1.5">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full border rounded px-2 py-1 text-xs bg-background outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-primary/5 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={value.includes(o.value)}
                  onChange={() => toggle(o.value)}
                  className="rounded"
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No results</p>
            )}
          </div>
          {value.length > 0 && (
            <div className="border-t p-1.5">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
