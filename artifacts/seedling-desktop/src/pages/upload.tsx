import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { Loader2, AlertCircle } from "lucide-react";

export default function UploadPage() {
  const { t } = useTranslation();
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setError("Not authenticated");
      return;
    }

    const apiBase = import.meta.env.VITE_API_BASE || "/api";
    const url = `${apiBase}/auth/upload-token`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const ct = res.headers.get("content-type") || "";
        const body = await res.text();
        if (!res.ok) {
          throw new Error(`GET ${url} returned ${res.status}: ${body.slice(0, 120)}`);
        }
        if (!ct.includes("application/json")) {
          throw new Error(
            `GET ${url} returned non-JSON (${ct || "unknown"}); first chars: ${body.slice(0, 60)}`,
          );
        }
        const data = JSON.parse(body) as { token: string; uploadAppUrl: string };
        setIframeSrc(`${data.uploadAppUrl}/?token=${data.token}`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <Topbar />
        <main className="flex-1 overflow-hidden">
          {error ? (
            <div className="flex items-center justify-center h-full gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm">{error}</span>
            </div>
          ) : !iframeSrc ? (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{t("common.loading")}</span>
            </div>
          ) : (
            <iframe
              src={iframeSrc}
              className="w-full h-full border-0"
              title={t("nav.uploadData")}
              allow="clipboard-write"
            />
          )}
        </main>
      </div>
    </div>
  );
}
