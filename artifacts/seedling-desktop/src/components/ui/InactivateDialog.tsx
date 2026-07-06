import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '\./button';
import { AlertTriangle, X } from 'lucide-react';

interface InactivateDialogProps {
  progeny: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (breederComment: string, ghComment: string) => void;
  isLoading?: boolean;
}

export function InactivateDialog({ progeny, open, onClose, onConfirm, isLoading }: InactivateDialogProps) {
  const { t } = useTranslation();
  const [breederComment, setBreederComment] = useState('');
  const [ghComment, setGhComment] = useState('');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card rounded-2xl border shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{t('inactivateDialog.title')}</h3>
              <p className="text-sm text-muted-foreground">{progeny}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary/20">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('inactivateDialog.confirmMessage')}
          </p>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('inactivateDialog.breederComment')}</label>
            <textarea
              value={breederComment}
              onChange={e => setBreederComment(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-1 focus:ring-primary outline-none resize-none"
              rows={2}
              placeholder={t('inactivateDialog.optionalBreeder')}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('inactivateDialog.ghTeamComment')}</label>
            <textarea
              value={ghComment}
              onChange={e => setGhComment(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-1 focus:ring-primary outline-none resize-none"
              rows={2}
              placeholder={t('inactivateDialog.optionalGh')}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 p-5 border-t">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>{t('inactivateDialog.noCancel')}</Button>
          <Button variant="destructive" onClick={() => onConfirm(breederComment, ghComment)} disabled={isLoading}>
            {isLoading ? t('inactivateDialog.inactivating') : t('inactivateDialog.yesInactivate')}
          </Button>
        </div>
      </div>
    </div>
  );
}
