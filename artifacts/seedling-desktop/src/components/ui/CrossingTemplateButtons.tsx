import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export function CrossingTemplateButtons() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const handleNavigate = () => {
    const url = new URL('https://drc-dev.driscolls.com/seedling/template');
    if (user) {
      url.searchParams.set('employeeId', String(user.id));
      url.searchParams.set('employeeName', user.ghEmployee);
      url.searchParams.set('employeeNum', String(user.employeeNum));
    }
    window.open(url.toString(), '_blank');
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleNavigate} title={t('crosses.downloadTemplate')}>
        <FileSpreadsheet className="w-4 h-4 mr-1.5" />
        {t('common.template')}
      </Button>
    </div>
  );
}
