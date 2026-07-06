import React, { useState, useRef, useEffect, useMemo, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup } from '@/components/ui/input-otp';
import { OTPInputContext, REGEXP_ONLY_DIGITS } from 'input-otp';
import { useListEmployees } from '@workspace/api-client-react';
import { GettingStartedContent } from '@/pages/help';
import { Leaf, ChevronDown, Search, X, HelpCircle, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

// Local slot for the PIN: separated rounded boxes that match the login design,
// with optional masking so the digit shows as • when "hide" is on.
function PinSlot({ index, mask }: { index: number; mask: boolean }) {
  const ctx = useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = ctx.slots[index];
  const display = char != null ? (mask ? '•' : char) : '';
  return (
    <div
      className={cn(
        "relative flex h-12 w-12 items-center justify-center rounded-xl border border-input bg-background text-xl font-semibold shadow-sm transition-all",
        isActive && "z-10 ring-2 ring-primary border-primary"
      )}
    >
      {display}
      {hasFakeCaret && !char && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-foreground" />
        </div>
      )}
    </div>
  );
}

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
}: {
  options: { id: number | string; label: string }[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const selectedLabel = options.find(o => String(o.id) === value)?.label ?? '';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(!open); setSearch(''); }}
        className="flex items-center h-12 w-full rounded-xl border border-input bg-background px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary transition-all text-left"
      >
        <span className={`flex-1 truncate ${!value ? 'text-muted-foreground' : ''}`}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown size={16} className={`ml-2 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-background border border-input rounded-xl shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-input">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={placeholder}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            )}
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-4 py-2 text-sm text-muted-foreground text-center">{placeholder}</li>
            ) : (
              filtered.map(o => (
                <li
                  key={o.id}
                  onClick={() => { onChange(String(o.id)); setOpen(false); setSearch(''); }}
                  className={`px-4 py-2 text-sm cursor-pointer hover:bg-primary/10 transition-colors ${String(o.id) === value ? 'bg-primary/5 font-medium text-primary' : ''}`}
                >
                  {o.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      <input type="hidden" name="employeeId" value={value} required />
    </div>
  );
}

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  // Auto-populate the last logged-in employee on this device.
  const [employeeId, setEmployeeId] = useState<string>(() => localStorage.getItem('last_employee_id') ?? '');
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showGettingStarted, setShowGettingStarted] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const { data: employees, isLoading } = useListEmployees({ active: true });

  const employeeOptions = useMemo(
    () => (employees ?? []).map(emp => ({ id: emp.id, label: emp.ghEmployee })),
    [employees]
  );

  const handleEmployeeChange = (val: string) => {
    setEmployeeId(val);
    setTimeout(() => codeInputRef.current?.focus(), 50);
  };

  // Auto-focus the code input on mount if the employee was pre-filled from a prior session.
  useEffect(() => {
    if (!employeeId) return;
    const t = setTimeout(() => codeInputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !code) return;
    
    setIsSubmitting(true);
    try {
      await login(Number(employeeId), Number(code));
    } catch (err) {
      // Error handled by context
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-sidebar relative overflow-hidden">
      <img 
        src={`${import.meta.env.BASE_URL}images/auth-bg.png`} 
        alt="Background" 
        className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-overlay"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-sidebar/90" />

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md p-8 bg-card/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30 mb-4">
            <Leaf className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">{t('auth.seedlingPortal')}</h1>
          <p className="text-muted-foreground mt-2 text-center text-sm">{t('auth.signInDescription')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground ml-1">{t('auth.selectEmployee')}</label>
            <SearchableSelect
              options={employeeOptions}
              value={employeeId}
              onChange={handleEmployeeChange}
              placeholder={t('auth.selectYourName')}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground ml-1">{t('auth.fourDigitCode')}</label>
            <div className="flex items-center gap-3">
              <InputOTP
                ref={codeInputRef}
                maxLength={4}
                pattern={REGEXP_ONLY_DIGITS}
                inputMode="numeric"
                value={code}
                onChange={setCode}
                containerClassName="gap-2"
              >
                <InputOTPGroup className="gap-2">
                  <PinSlot index={0} mask={!showCode} />
                  <PinSlot index={1} mask={!showCode} />
                  <PinSlot index={2} mask={!showCode} />
                  <PinSlot index={3} mask={!showCode} />
                </InputOTPGroup>
              </InputOTP>
              <button
                type="button"
                onClick={() => setShowCode(s => !s)}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label={showCode ? 'Hide code' : 'Show code'}
                title={showCode ? 'Hide code' : 'Show code'}
              >
                {showCode ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <Button 
            type="submit" 
            className="w-full h-12 text-base font-semibold mt-2" 
            disabled={isSubmitting || !employeeId || code.length !== 4}
          >
            {isSubmitting ? t('auth.authenticating') : t('auth.signIn')}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setShowGettingStarted(true)}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
            {t('help.gettingStartedButton')}
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {showGettingStarted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowGettingStarted(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card rounded-2xl shadow-2xl border border-border w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-primary" />
                  {t('help.gettingStarted.title')}
                </h2>
                <button
                  onClick={() => setShowGettingStarted(false)}
                  className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
                <GettingStartedContent />
              </div>
              <div className="px-6 py-3 border-t border-border flex justify-end">
                <Button variant="outline" onClick={() => setShowGettingStarted(false)}>
                  {t('common.close')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
