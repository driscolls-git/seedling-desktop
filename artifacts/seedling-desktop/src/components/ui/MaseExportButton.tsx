import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { useListMarkers } from '@workspace/api-client-react';
import type { Cross } from '@workspace/api-client-react';

function escapeCsvField(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function MaseExportButton({ crosses, berryId }: { crosses: Cross[]; berryId?: number }) {
  const hasBerry = berryId != null && berryId > 0;
  const { data: markers = [] } = useListMarkers(hasBerry ? { berryId, active: true } : { active: true });

  const handleExport = () => {
    const filteredMarkers = hasBerry
      ? markers.filter((m: any) => m.berryId === berryId)
      : markers;

    const markerAliases = filteredMarkers
      .map((m: any) => m.markerAliasDriscolls)
      .filter((a: string | null | undefined): a is string => !!a)
      .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i);

    const rejectionCols = markerAliases.map((name: string) => `${name}~rejection`);
    const segregationCols = markerAliases.map((name: string) => `${name}~segregation_ratio`);

    const headers = [
      'Berry', 'Pollination Year', 'Label No', 'Cross', 'Parentage1',
      'Parent1', 'Parent2', 'Parentage2', 'Author', 'Duplicate',
      'Cross Location', 'Crosses Grown', 'Program', 'Purpose',
      ...rejectionCols, ...segregationCols,
    ];

    const rows = crosses.map((c: Cross) => {
      const fixed = [
        escapeCsvField(c.berry),
        escapeCsvField(c.pollinationYear),
        '',
        escapeCsvField(c.progeny),
        '',
        escapeCsvField(c.parent1),
        escapeCsvField(c.parent2),
        '',
        escapeCsvField(c.crossDesignedBy),
        '',
        escapeCsvField(c.teamName),
        escapeCsvField(c.plantNumTransplanted),
        escapeCsvField(c.d1Program),
        '',
      ];
      const blanks = new Array(rejectionCols.length + segregationCols.length).fill('');
      return [...fixed, ...blanks].join(',');
    });

    const csv = [headers.map(escapeCsvField).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const berryName = crosses[0]?.berry || 'All';
    a.download = `${berryName}_Crosses_MASE_Export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={!hasBerry || !crosses.length} title={!hasBerry ? 'Select a berry filter first' : 'MASE Export CSV'}>
      <Download className="w-4 h-4 mr-1.5" />
      MASE Export
    </Button>
  );
}
