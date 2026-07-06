import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import {
  Home, Sprout, Network, BookOpen,
  Leaf, Users, Calendar, Target,
  LogOut, Box, FlaskConical, MapPin, DollarSign, Tag,
  PanelLeftClose, PanelLeftOpen, Pin, PinOff,
  ListChecks, ListTree, FileEdit, Warehouse,
  Flower2, Sparkles, Cherry, Bean,
  ArrowRightLeft, Microscope, Grid3x3, Truck, Split,
  BarChart3, ClipboardCheck, HelpCircle, Upload
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';

interface NavChild {
  name: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  hidden?: boolean;
}

interface NavSection {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  defaultHref?: string;
  children?: NavChild[];
}

function CollapsedFlyout({ section, location, onNavigate }: { section: NavSection; location: string; onNavigate: (href: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { collapse } = useSidebar();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const isActive = section.children?.some(c => location === c.href);

  const handleClick = () => {
    if (section.defaultHref) {
      onNavigate(section.defaultHref);
      collapse();
    } else {
      setOpen(!open);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); setOpen(!open); }}
        className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group",
          isActive
            ? "bg-sidebar-accent text-white"
            : "text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-white"
        )}
        title={section.defaultHref ? `${section.name} (right-click for menu)` : section.name}
      >
        <section.icon className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute left-full top-0 ml-2 z-50 w-56 bg-sidebar border border-sidebar-border rounded-xl shadow-xl py-2 px-1">
          <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40">{section.name}</p>
          {section.children?.filter(c => !c.hidden).map((child) => (
            <Link
              key={child.href}
              href={child.href}
              onClick={() => { setOpen(false); collapse(); }}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200",
                location === child.href
                  ? "bg-sidebar-accent text-white font-medium"
                  : "text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent/50"
              )}
            >
              {child.icon && <child.icon className="w-4 h-4 opacity-70" />}
              {child.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

let savedNavScrollTop = 0;

export function Sidebar() {
  const [location, navigate] = useLocation();
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { collapsed, pinned, toggle, collapse, togglePin } = useSidebar();
  const navScrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (navScrollRef.current && savedNavScrollTop > 0) {
      navScrollRef.current.scrollTop = savedNavScrollTop;
    }
  }, []);

  const handleNavClick = (href: string) => {
    if (navScrollRef.current) {
      savedNavScrollTop = navScrollRef.current.scrollTop;
    }
    if (href !== '/') {
      collapse();
    }
  };

  const navigation: NavSection[] = [
    { name: t('nav.homeDashboard'), href: '/', icon: Home },
    { name: t('nav.analytics'), href: '/analytics', icon: BarChart3 },
    { name: t('nav.uploadData'), href: '/upload', icon: Upload },
    { name: t('nav.help'), href: '/help', icon: HelpCircle },
    { 
      name: t('nav.crosses'), 
      icon: Network,
      defaultHref: '/crosses/short',
      children: [
        { name: t('nav.crossingListSimplified'), href: '/crosses/short', icon: ListChecks },
        { name: t('nav.crossingListFull'), href: '/crosses/full', icon: ListTree },
        { name: t('nav.crossForm'), href: '/crosses/form', icon: FileEdit },
        { name: t('nav.parentInventory'), href: '/parents', icon: Warehouse },
      ]
    },
    {
      name: t('nav.propagationLifecycle'),
      icon: Sprout,
      defaultHref: '/propagation/lifecycle-summary',
      children: [
        { name: t('nav.lifecycleSummary'), href: '/propagation/lifecycle-summary', icon: ClipboardCheck },
        { name: t('nav.pollen'), href: '/propagation/pollen', icon: Sparkles },
        { name: t('nav.pollination'), href: '/propagation/pollination', icon: Flower2 },
        { name: t('nav.fruit'), href: '/propagation/fruit', icon: Cherry },
        { name: t('nav.seed'), href: '/propagation/seed', icon: Bean },
        { name: t('nav.transplant'), href: '/propagation/transplant', icon: ArrowRightLeft },
        { name: t('nav.screenByProgeny'), href: '/propagation/screen-progeny', icon: Microscope },
        { name: t('nav.screenByPlate'), href: '/propagation/screen-plate', icon: Grid3x3 },
        { name: t('nav.sortAllocation'), href: '/propagation/sort-allocation', icon: Split },
        { name: t('nav.ship'), href: '/propagation/ship', icon: Truck },
      ]
    },
    {
      name: t('nav.referenceTables'),
      icon: BookOpen,
      defaultHref: '/reference/labs',
      children: [
        { name: t('nav.labs'), href: '/reference/labs', icon: FlaskConical },
        { name: t('nav.teams'), href: '/reference/teams', icon: Users },
        { name: t('nav.trays'), href: '/reference/trays', icon: Box },
        { name: t('nav.ratios'), href: '/reference/ratios', icon: Target },
        { name: t('nav.deadlines'), href: '/reference/deadlines', icon: Calendar },
        { name: t('nav.employees'), href: '/reference/employees', icon: Users },
        { name: t('nav.markerList'), href: '/reference/markers', icon: MapPin },
        { name: t('nav.markerAllocations'), href: '/reference/marker-budget', icon: DollarSign },
        { name: t('nav.markerPrices'), href: '/reference/marker-prices', icon: Tag },
      ]
    },
  ];

  return (
    <div className={cn(
      "flex flex-col h-screen bg-sidebar border-r border-sidebar-border text-sidebar-foreground transition-all duration-300",
      collapsed ? "w-16" : "w-72"
    )}>
      <div className={cn("flex items-center", collapsed ? "p-3 justify-center" : "p-6 gap-3")}>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20 flex-shrink-0">
          <Leaf className="w-6 h-6 text-white" />
        </div>
        {!collapsed && (
          <div>
            <h1 className="text-xl font-display font-bold tracking-tight text-white">{t('nav.seedling')}</h1>
            <p className="text-xs text-sidebar-foreground/60 font-medium">{t('nav.desktopPortal')}</p>
          </div>
        )}
      </div>

      <div ref={navScrollRef} className={cn("flex-1 overflow-y-auto py-4 space-y-6 custom-scrollbar", collapsed ? "px-1" : "px-3")}>
        {navigation.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {collapsed ? (
              section.href ? (
                <Link href={section.href} onClick={() => handleNavClick(section.href!)} className={cn(
                  "w-10 h-10 mx-auto rounded-xl flex items-center justify-center transition-all duration-200 group",
                  location === section.href
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-white"
                )} title={section.name}>
                  <section.icon className="w-5 h-5" />
                </Link>
              ) : (
                <div className="flex flex-col items-center">
                  <CollapsedFlyout section={section} location={location} onNavigate={(href) => { navigate(href); handleNavClick(href); }} />
                </div>
              )
            ) : (
              section.href ? (
                <Link href={section.href} onClick={() => handleNavClick(section.href!)} className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 group",
                  location === section.href 
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white"
                )}>
                  <section.icon className={cn("w-5 h-5", location === section.href ? "text-primary-foreground" : "text-sidebar-foreground/50 group-hover:text-white")} />
                  {section.name}
                </Link>
              ) : (
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40 mb-2">
                    <section.icon className="w-4 h-4" />
                    {section.name}
                  </div>
                  <div className="space-y-1 mt-2 border-l border-sidebar-border ml-2 pl-3">
                    {section.children?.filter(c => !c.hidden).map((child) => (
                      <Link key={child.href} href={child.href} onClick={() => handleNavClick(child.href)} className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200",
                        location === child.href 
                          ? "bg-sidebar-accent text-white font-medium" 
                          : "text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent/50"
                      )}>
                        {child.icon && <child.icon className="w-4 h-4 opacity-70" />}
                        {child.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        ))}
      </div>

      <div className={cn("border-t border-sidebar-border bg-sidebar/50", collapsed ? "p-2" : "p-4")}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center" title={user?.ghEmployee || 'User'}>
              <span className="text-sm font-bold text-primary-foreground">{user?.ghEmployee.charAt(0) || 'U'}</span>
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-lg hover:bg-destructive/20 hover:text-destructive text-sidebar-foreground/50 transition-colors"
              title={t('auth.logout')}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-sidebar-accent/50 border border-sidebar-border">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-primary-foreground">{user?.ghEmployee.charAt(0) || 'U'}</span>
              </div>
              <div className="truncate">
                <p className="text-sm font-medium text-white truncate">{user?.ghEmployee || t('common.user')}</p>
                <p className="text-xs text-sidebar-foreground/60">{user?.teamName || t('common.team')}</p>
              </div>
            </div>
            <button 
              onClick={logout}
              className="p-2 rounded-lg hover:bg-destructive/20 hover:text-destructive text-sidebar-foreground/50 transition-colors"
              title={t('auth.logout')}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className={cn("flex items-center mb-3", collapsed ? "justify-center" : "justify-end gap-1 mr-3")}>
        {!collapsed && (
          <button
            onClick={togglePin}
            className={cn(
              "p-2 rounded-lg transition-colors",
              pinned
                ? "text-primary bg-primary/20 hover:bg-primary/30"
                : "text-sidebar-foreground/50 hover:text-white hover:bg-sidebar-accent"
            )}
            title={pinned ? t('nav.unpinSidebar') : t('nav.pinSidebar')}
          >
            {pinned ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
          </button>
        )}
        <button
          onClick={toggle}
          className="p-2 rounded-lg text-sidebar-foreground/50 hover:text-white hover:bg-sidebar-accent transition-colors"
          title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
