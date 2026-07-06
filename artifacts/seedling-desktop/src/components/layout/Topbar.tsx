import React from 'react';
import { useTranslation } from 'react-i18next';
import { useFilters } from '@/contexts/FilterContext';
import { useListBerries, useListTeams } from '@workspace/api-client-react';
import { LANGUAGES } from '@/i18n';
import { Globe } from 'lucide-react';
import driscolLogo from "@assets/Driscoll's_Logo_2_1773421568342.png";
import blackberryIcon from "@assets/Blackberry_Icon_3_1773690118373.png";
import blueberryIcon from "@assets/Blueberry_Icon_3_1773690118375.png";
import raspberryIcon from "@assets/Raspberry_Icon_3_1773690118376.png";
import strawberryIcon from "@assets/Strawberry_Icon_3_1773690118377.png";

const berryIconMap: Record<string, string> = {
  BLACK: blackberryIcon,
  BLUE: blueberryIcon,
  RASP: raspberryIcon,
  STRAW: strawberryIcon,
};

const IS_TEST_ENVIRONMENT = true; // Set to false for production

export function Topbar() {
  const { t, i18n } = useTranslation();
  const { filters, setFilter, resetFilters } = useFilters();
  
  const { data: berries } = useListBerries();
  const { data: teams } = useListTeams({ active: true });

  const years = Array.from({ length: 8 }, (_, i) => 2025 + i);

  const handleBerryClick = (id: number) => {
    setFilter('berryId', filters.berryId === id ? undefined : id);
  };

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
  };

  return (
    <div className="h-16 border-b bg-card px-6 flex items-center justify-between sticky top-0 z-30 shadow-sm shadow-black/5">
      <div className="flex items-center gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t('filters.globalFilters')}</h2>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-muted/40 rounded-xl px-1.5 py-1">
            {berries?.map(b => {
              const icon = berryIconMap[b.berryType];
              const isSelected = filters.berryId === b.id;
              const hasSelection = filters.berryId !== undefined;
              return (
                <button
                  key={b.id}
                  onClick={() => handleBerryClick(b.id)}
                  title={b.berryType}
                  className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 ${
                    isSelected
                      ? 'bg-white shadow-md ring-2 ring-primary/40 scale-110'
                      : hasSelection
                        ? 'opacity-35 hover:opacity-70 hover:bg-white/50'
                        : 'hover:bg-white/50 hover:scale-105'
                  }`}
                >
                  {icon && (
                    <img
                      src={icon}
                      alt={b.berryType}
                      className="w-7 h-7 object-contain"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <select 
            className="h-9 px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
            value={filters.teamId || ''}
            onChange={(e) => setFilter('teamId', e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">{t('filters.allTeams')}</option>
            {teams?.map(t => (
              <option key={t.id} value={t.id}>{t.teamName}</option>
            ))}
          </select>

          <select 
            className="h-9 px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
            value={filters.pollinationYear}
            onChange={(e) => setFilter('pollinationYear', Number(e.target.value))}
          >
            {years.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer select-none">
            <input 
              type="checkbox" 
              className="w-4 h-4 rounded border-input text-primary focus:ring-primary transition-all"
              checked={filters.spCrosses}
              onChange={(e) => setFilter('spCrosses', e.target.checked)}
            />
            {t('filters.spCrosses')}
          </label>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Globe className="w-4 h-4 text-muted-foreground" />
          <select
            className="h-8 px-2 py-1 rounded-lg border border-input bg-background text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
            value={i18n.resolvedLanguage || i18n.language}
            onChange={(e) => changeLanguage(e.target.value)}
          >
            {LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>{lang.label}</option>
            ))}
          </select>
        </div>
        <button 
          onClick={resetFilters}
          className="text-sm text-muted-foreground hover:text-primary transition-colors font-medium underline underline-offset-4"
        >
          {t('filters.resetFilters')}
        </button>
        {IS_TEST_ENVIRONMENT && (
          <span className="inline-flex items-center justify-center bg-gradient-to-br from-[#ff6b6b] to-[#ee5a5a] text-white text-[11px] font-bold tracking-wide py-1 px-3 rounded-xl shadow-[0_2px_8px_rgba(255,107,107,0.3)] border border-white/30 select-none"
            style={{ textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }}>
            Test Environment
          </span>
        )}
        <img src={driscolLogo} alt="Driscoll's Logo" className="h-10 object-contain" />
      </div>
    </div>
  );
}
