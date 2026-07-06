import React from 'react';
import { Layout } from '@/components/layout/Layout';
import { Construction } from 'lucide-react';

interface StubProps {
  title: string;
}

export default function StubPage({ title }: StubProps) {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center h-[70vh] text-center space-y-6">
        <div className="w-24 h-24 bg-primary/10 rounded-3xl flex items-center justify-center mb-2 shadow-inner">
          <Construction className="w-12 h-12 text-primary opacity-80" />
        </div>
        <h1 className="text-4xl font-display font-bold text-foreground tracking-tight">{title}</h1>
        <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
          This module is part of the application roadmap and will be implemented in a future update.
        </p>
      </div>
    </Layout>
  );
}
