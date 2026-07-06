import React, { createContext, useContext, useState, useEffect } from 'react';
import { Employee, useGetMe, useLogin } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

interface AuthContextType {
  user: Employee | null;
  isLoading: boolean;
  login: (employeeId: number, employeeNum: number) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isBreeder: boolean;
  isMolecular: boolean;
  canAccessEmployees: boolean;
  canEditMarkers: boolean;
  // Per spec: Breeder (2), Admin3 (4), and Molecular (5) can edit/add crosses & parents.
  // Basic (1) and Admin1 (3) are read-only.
  canEditCrosses: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('auth_token'));
  const { toast } = useToast();
  
  // We use the query only if we have a token (or assume cookie based). 
  // For this mock/demo, we'll store the user directly after login to avoid complex session setups if not needed.
  const [user, setUser] = useState<Employee | null>(null);
  
  // Try to fetch me on mount if token exists
  const { data: meData, isLoading: isMeLoading } = useGetMe({
    query: {
      queryKey: ['/api/auth/me'],
      enabled: !!token,
      retry: false,
    }
  });

  useEffect(() => {
    if (meData) {
      setUser(meData);
    }
  }, [meData]);

  const loginMutation = useLogin();

  const login = async (employeeId: number, employeeNum: number) => {
    try {
      const res = await loginMutation.mutateAsync({ data: { employeeId, employeeNum } });
      if (res.success && res.employee) {
        setUser(res.employee);
        if (res.token) {
          setToken(res.token);
          localStorage.setItem('auth_token', res.token);
        }
        // Remember the last logged-in employee so the login form auto-populates next time.
        localStorage.setItem('last_employee_id', String(res.employee.id));
        toast({
          title: "Welcome back",
          description: `Logged in as ${res.employee.ghEmployee}`,
        });
      }
    } catch (error) {
      toast({
        title: "Login failed",
        description: "Invalid credentials. Please try again.",
        variant: "destructive"
      });
      throw error;
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('auth_token');
    // Don't clear last_employee_id — we want it to auto-populate on the login screen.
    // Don't redirect — ProtectedRoute renders <Login /> automatically when user is null,
    // and a hard redirect would break sub-path deployments.
  };

  const userLevel = user?.userLevelFk || 0;
  const isAdmin = userLevel >= 3 && userLevel <= 4;
  const isBreeder = userLevel >= 2;
  const isMolecular = userLevel === 5;
  const canAccessEmployees = userLevel >= 3;
  const canEditMarkers = userLevel === 4 || userLevel === 5;
  const canEditCrosses = userLevel === 2 || userLevel === 4 || userLevel === 5;

  return (
    <AuthContext.Provider value={{
      user,
      isLoading: isMeLoading && !!token,
      login,
      logout,
      isAdmin,
      isBreeder,
      isMolecular,
      canAccessEmployees,
      canEditMarkers,
      canEditCrosses,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
