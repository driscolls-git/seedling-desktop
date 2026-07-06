import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { FilterProvider } from "@/contexts/FilterContext";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { LANGUAGES } from "@/i18n";

import Login from "@/pages/login";
import Home from "@/pages/home";
import CrossListShort from "@/pages/crosses/list-short";
import CrossListFull from "@/pages/crosses/list-full";
import ParentsList from "@/pages/crosses/parents";
import CrossForm from "@/pages/crosses/form";
import FruitList from "@/pages/propagation/fruit";
import PollenList from "@/pages/propagation/pollen";
import PollinationList from "@/pages/propagation/pollination";
import SeedList from "@/pages/propagation/seed";
import TransplantList from "@/pages/propagation/transplant";
import ScreenByProgenyList from "@/pages/propagation/screen-progeny";
import ScreenByPlateList from "@/pages/propagation/screen-plate";
import ShipList from "@/pages/propagation/ship";
import SortAllocationPage from "@/pages/propagation/sort-allocation";
import LifecycleSummary from "@/pages/propagation/lifecycle-summary";
import RatiosList from "@/pages/reference/ratios";
import DeadlinesList from "@/pages/reference/deadlines";
import EmployeesList from "@/pages/reference/employees";
import TeamsList from "@/pages/reference/teams";
import LabsList from "@/pages/reference/labs";
import MarkersList from "@/pages/reference/markers";
import MarkerBudgetPage from "@/pages/reference/marker-budget";
import MarkerPricesPage from "@/pages/reference/marker-prices";
import TraysList from "@/pages/reference/trays";
import AnalyticsPage from "@/pages/analytics";
import HelpPage from "@/pages/help";
import UploadPage from "@/pages/upload";
import StubPage from "@/pages/stub";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, title }: { component: React.ComponentType<any>, title?: string }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return title ? <Component title={title} /> : <Component />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/">{() => <ProtectedRoute component={Home} />}</Route>
      <Route path="/crosses/short">{() => <ProtectedRoute component={CrossListShort} />}</Route>
      <Route path="/crosses/full">{() => <ProtectedRoute component={CrossListFull} />}</Route>
      <Route path="/crosses/form">{() => <ProtectedRoute component={CrossForm} />}</Route>
      <Route path="/parents">{() => <ProtectedRoute component={ParentsList} />}</Route>

      <Route path="/propagation/lifecycle-summary">{() => <ProtectedRoute component={LifecycleSummary} />}</Route>
      <Route path="/propagation/pollen">{() => <ProtectedRoute component={PollenList} />}</Route>
      <Route path="/propagation/pollination">{() => <ProtectedRoute component={PollinationList} />}</Route>
      <Route path="/propagation/fruit">{() => <ProtectedRoute component={FruitList} />}</Route>
      <Route path="/propagation/seed">{() => <ProtectedRoute component={SeedList} />}</Route>
      <Route path="/propagation/transplant">{() => <ProtectedRoute component={TransplantList} />}</Route>
      <Route path="/propagation/screen-progeny">{() => <ProtectedRoute component={ScreenByProgenyList} />}</Route>
      <Route path="/propagation/screen-plate">{() => <ProtectedRoute component={ScreenByPlateList} />}</Route>
      <Route path="/propagation/ship">{() => <ProtectedRoute component={ShipList} />}</Route>
      <Route path="/propagation/sort-allocation">{() => <ProtectedRoute component={SortAllocationPage} />}</Route>

      <Route path="/reference/labs">{() => <ProtectedRoute component={LabsList} />}</Route>
      <Route path="/reference/teams">{() => <ProtectedRoute component={TeamsList} />}</Route>
      <Route path="/reference/trays">{() => <ProtectedRoute component={TraysList} />}</Route>
      <Route path="/reference/ratios">{() => <ProtectedRoute component={RatiosList} />}</Route>
      <Route path="/reference/deadlines">{() => <ProtectedRoute component={DeadlinesList} />}</Route>
      <Route path="/reference/employees">{() => <ProtectedRoute component={EmployeesList} />}</Route>
      <Route path="/reference/markers">{() => <ProtectedRoute component={MarkersList} />}</Route>
      <Route path="/reference/marker-budget">{() => <ProtectedRoute component={MarkerBudgetPage} />}</Route>
      <Route path="/reference/marker-prices">{() => <ProtectedRoute component={MarkerPricesPage} />}</Route>

      <Route path="/analytics">{() => <ProtectedRoute component={AnalyticsPage} />}</Route>

      <Route path="/upload">{() => <ProtectedRoute component={UploadPage} />}</Route>

      <Route path="/help">{() => <ProtectedRoute component={HelpPage} />}</Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function DirectionHandler() {
  const { i18n } = useTranslation();
  useEffect(() => {
    const resolved = i18n.resolvedLanguage || i18n.language || 'en';
    const lang = LANGUAGES.find(l => l.code === resolved) || LANGUAGES[0];
    document.documentElement.dir = lang.dir;
    document.documentElement.lang = lang.code;
  }, [i18n.language, i18n.resolvedLanguage]);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DirectionHandler />
        <AuthProvider>
          <FilterProvider>
            <SidebarProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <AppRouter />
              </WouterRouter>
            </SidebarProvider>
          </FilterProvider>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
