import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

interface SidebarContextType {
  collapsed: boolean;
  pinned: boolean;
  toggle: () => void;
  collapse: () => void;
  togglePin: () => void;
}

const SidebarContext = createContext<SidebarContextType>({ collapsed: false, pinned: false, toggle: () => {}, collapse: () => {}, togglePin: () => {} });

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [pinned, setPinned] = useState(() => localStorage.getItem('sidebar_pinned') === 'true');
  const [collapsed, setCollapsed] = useState(false);
  const pinnedRef = useRef(pinned);

  const toggle = useCallback(() => setCollapsed(prev => !prev), []);
  const collapse = useCallback(() => {
    if (!pinnedRef.current) setCollapsed(true);
  }, []);
  const togglePin = useCallback(() => {
    setPinned(prev => {
      const next = !prev;
      pinnedRef.current = next;
      localStorage.setItem('sidebar_pinned', String(next));
      if (next) setCollapsed(false);
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, pinned, toggle, collapse, togglePin }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
