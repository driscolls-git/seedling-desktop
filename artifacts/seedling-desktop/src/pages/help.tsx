import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { BookOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Section {
  id: string;
  titleKey: string;
  contentKey: string;
  children?: Section[];
}

const MANUAL_SECTIONS: Section[] = [
  { id: 'getting-started', titleKey: 'help.gettingStarted.title', contentKey: 'help.gettingStarted.content' },
  { id: 'navigation', titleKey: 'help.navigation.title', contentKey: 'help.navigation.content' },
  { id: 'global-filters', titleKey: 'help.globalFilters.title', contentKey: 'help.globalFilters.content' },
  { id: 'dashboard', titleKey: 'help.dashboard.title', contentKey: 'help.dashboard.content' },
  { id: 'analytics', titleKey: 'help.analytics.title', contentKey: 'help.analytics.content' },
  {
    id: 'crosses', titleKey: 'help.crosses.title', contentKey: 'help.crosses.content',
    children: [
      { id: 'crossing-list-simplified', titleKey: 'help.crosses.simplified.title', contentKey: 'help.crosses.simplified.content' },
      { id: 'crossing-list-full', titleKey: 'help.crosses.full.title', contentKey: 'help.crosses.full.content' },
      { id: 'cross-form', titleKey: 'help.crosses.form.title', contentKey: 'help.crosses.form.content' },
      { id: 'parent-inventory', titleKey: 'help.crosses.parents.title', contentKey: 'help.crosses.parents.content' },
    ],
  },
  {
    id: 'propagation', titleKey: 'help.propagation.title', contentKey: 'help.propagation.content',
    children: [
      { id: 'lifecycle-summary', titleKey: 'help.propagation.lifecycle.title', contentKey: 'help.propagation.lifecycle.content' },
      { id: 'pollen', titleKey: 'help.propagation.pollen.title', contentKey: 'help.propagation.pollen.content' },
      { id: 'pollination', titleKey: 'help.propagation.pollination.title', contentKey: 'help.propagation.pollination.content' },
      { id: 'fruit', titleKey: 'help.propagation.fruit.title', contentKey: 'help.propagation.fruit.content' },
      { id: 'seed', titleKey: 'help.propagation.seed.title', contentKey: 'help.propagation.seed.content' },
      { id: 'transplant', titleKey: 'help.propagation.transplant.title', contentKey: 'help.propagation.transplant.content' },
      { id: 'screen-progeny', titleKey: 'help.propagation.screenProgeny.title', contentKey: 'help.propagation.screenProgeny.content' },
      { id: 'screen-plate', titleKey: 'help.propagation.screenPlate.title', contentKey: 'help.propagation.screenPlate.content' },
      { id: 'sort-allocation', titleKey: 'help.propagation.sortAllocation.title', contentKey: 'help.propagation.sortAllocation.content' },
      { id: 'ship', titleKey: 'help.propagation.ship.title', contentKey: 'help.propagation.ship.content' },
    ],
  },
  {
    id: 'reference', titleKey: 'help.reference.title', contentKey: 'help.reference.content',
    children: [
      { id: 'ref-labs', titleKey: 'help.reference.labs.title', contentKey: 'help.reference.labs.content' },
      { id: 'ref-teams', titleKey: 'help.reference.teams.title', contentKey: 'help.reference.teams.content' },
      { id: 'ref-trays', titleKey: 'help.reference.trays.title', contentKey: 'help.reference.trays.content' },
      { id: 'ref-ratios', titleKey: 'help.reference.ratios.title', contentKey: 'help.reference.ratios.content' },
      { id: 'ref-deadlines', titleKey: 'help.reference.deadlines.title', contentKey: 'help.reference.deadlines.content' },
      { id: 'ref-employees', titleKey: 'help.reference.employees.title', contentKey: 'help.reference.employees.content' },
      { id: 'ref-markers', titleKey: 'help.reference.markers.title', contentKey: 'help.reference.markers.content' },
      { id: 'ref-marker-budget', titleKey: 'help.reference.markerBudget.title', contentKey: 'help.reference.markerBudget.content' },
      { id: 'ref-marker-prices', titleKey: 'help.reference.markerPrices.title', contentKey: 'help.reference.markerPrices.content' },
    ],
  },
  { id: 'languages', titleKey: 'help.languages.title', contentKey: 'help.languages.content' },
  { id: 'roles', titleKey: 'help.roles.title', contentKey: 'help.roles.content' },
  { id: 'tips', titleKey: 'help.tips.title', contentKey: 'help.tips.content' },
];

function TocItem({ section, activeId, depth = 0, onClick }: { section: Section; activeId: string; depth?: number; onClick: (id: string) => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const hasChildren = section.children && section.children.length > 0;
  const isActive = activeId === section.id;

  return (
    <div>
      <button
        onClick={() => {
          onClick(section.id);
          if (hasChildren) setExpanded(e => !e);
        }}
        className={cn(
          'flex items-center gap-1.5 w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors',
          depth > 0 && 'ml-4',
          isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
      >
        {hasChildren && (expanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />)}
        <span className="truncate">{t(section.titleKey)}</span>
      </button>
      {hasChildren && expanded && (
        <div className="mt-0.5">
          {section.children!.map(child => (
            <TocItem key={child.id} section={child} activeId={activeId} depth={depth + 1} onClick={onClick} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContentBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listKey = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${listKey++}`} className="list-disc list-inside space-y-1 mb-4 text-sm text-muted-foreground">
          {listItems.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      );
      listItems = [];
    }
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      listItems.push(trimmed.slice(2));
    } else if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(<h4 key={`h4-${i}`} className="text-sm font-semibold text-foreground mt-4 mb-2">{trimmed.slice(4)}</h4>);
    } else if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(<h3 key={`h3-${i}`} className="text-base font-semibold text-foreground mt-5 mb-2">{trimmed.slice(3)}</h3>);
    } else {
      flushList();
      elements.push(<p key={`p-${i}`} className="text-sm text-muted-foreground mb-3 leading-relaxed">{trimmed}</p>);
    }
  });
  flushList();

  return <>{elements}</>;
}

export function GettingStartedContent() {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <ContentBlock text={t('help.gettingStarted.content')} />
    </div>
  );
}

export default function HelpPage() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState('getting-started');

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(`help-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          const id = visible[0].target.id.replace('help-', '');
          setActiveSection(id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 }
    );

    const allSections = MANUAL_SECTIONS.flatMap(s => [s, ...(s.children ?? [])]);
    allSections.forEach(s => {
      const el = document.getElementById(`help-${s.id}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const allSections = MANUAL_SECTIONS.flatMap(s => [s, ...(s.children ?? [])]);

  return (
    <Layout>
      <div className="flex gap-8">
        <nav className="hidden lg:block w-64 shrink-0">
          <div className="sticky top-0 space-y-1 max-h-[calc(100vh-160px)] overflow-y-auto custom-scrollbar pr-2">
            <div className="flex items-center gap-2 px-3 py-2 mb-3">
              <BookOpen className="w-5 h-5 text-primary" />
              <span className="font-semibold text-foreground">{t('help.title')}</span>
            </div>
            {MANUAL_SECTIONS.map(section => (
              <TocItem key={section.id} section={section} activeId={activeSection} onClick={scrollToSection} />
            ))}
          </div>
        </nav>

        <div className="flex-1 min-w-0 max-w-3xl">
          <div className="mb-8">
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-3">
              <BookOpen className="w-7 h-7 text-primary" />
              {t('help.title')}
            </h1>
            <p className="text-muted-foreground mt-2">{t('help.subtitle')}</p>
          </div>

          <div className="space-y-10">
            {allSections.map(section => (
              <section key={section.id} id={`help-${section.id}`} className="scroll-mt-20">
                <h2 className="text-lg font-semibold text-foreground mb-3 pb-2 border-b border-border">
                  {t(section.titleKey)}
                </h2>
                <ContentBlock text={t(section.contentKey)} />
              </section>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
