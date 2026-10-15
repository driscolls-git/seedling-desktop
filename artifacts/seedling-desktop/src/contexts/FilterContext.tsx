import React, { createContext, useContext, useState } from 'react';

interface GlobalFilters {
  berryId: number | undefined;
  teamId: number | undefined;
  pollinationYear: number;
  // Cross Season (Strawberry only): true = Summer (SP_Crosses = 1),
  // false = Winter (SP_Crosses = 0), undefined = both / no filter.
  spCrosses: boolean | undefined;
}

interface FilterContextType {
  filters: GlobalFilters;
  setFilter: <K extends keyof GlobalFilters>(key: K, value: GlobalFilters[K]) => void;
  resetFilters: () => void;
}

const currentYear = new Date().getFullYear();

const defaultFilters: GlobalFilters = {
  berryId: undefined,
  teamId: undefined,
  pollinationYear: currentYear,
  spCrosses: undefined,
};

const FilterContext = createContext<FilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<GlobalFilters>(defaultFilters);

  const setFilter = <K extends keyof GlobalFilters>(key: K, value: GlobalFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
  };

  return (
    <FilterContext.Provider value={{ filters, setFilter, resetFilters }}>
      {children}
    </FilterContext.Provider>
  );
}

export const useFilters = () => {
  const context = useContext(FilterContext);
  if (context === undefined) {
    throw new Error('useFilters must be used within a FilterProvider');
  }
  return context;
};
