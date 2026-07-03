import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Phone, DollarSign, TrendingUp, Users, Lock, Eye, EyeOff } from "lucide-react";
import type { Lead } from "@shared/schema";

function ScoreBadge({ score }: { score: string }) {
  const classes =
    score === "hot"
      ? "score-hot"
      : score === "warm"
      ? "score-warm"
      : "score-cold";
  const labels =
    score === "hot"
      ? "🔥 Hot Lead"
      : score === "warm"
      ? "⚡ Warm Lead"
      : "❄️ Cold Lead";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      {labels}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function LoginGate({ onAuth }: { onAuth: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest("POST", "/api/admin/login", { password: pw });
      if (res.ok) {
        onAuth(pw);
      } else {
        setError("Incorrect password. Please try again.");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center mx-auto">
            <Lock size={20} className="text-primary" />
          </div>
          <h1 className="text-lg font-semibold">Admin Access</h1>
          <p className="text-sm text-muted-foreground">Enter your admin password to view leads.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Input
              data-testid="input-admin-password"
              type={show ? "text" : "password"}
              placeholder="Admin password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="pr-10 bg-card border-border/60 focus:border-primary/60"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-destructive" data-testid="text-admin-error">{error}</p>
          )}

          <Button
            data-testid="button-admin-login"
            type="submit"
            disabled={!pw || loading}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {loading ? "Verifying…" : "Access Dashboard"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ adminPassword }: { adminPassword: string }) {
  const { data: leads, isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    queryFn: async () => {
      const res = await fetch("/api/leads", {
        headers: { "x-admin-password": adminPassword },
      });
      if (!res.ok) throw new Error("Unauthorized");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const hot = leads?.filter((l) => l.qualificationScore === "hot").length ?? 0;
  const warm = leads?.filter((l) => l.qualificationScore === "warm").length ?? 0;
  const cold = leads?.filter((l) => l.qualificationScore === "cold").length ?? 0;
  const total = leads?.length ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-bold">Lead Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">All pre-qualified applicants from the chatbot</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Leads", value: total, icon: <Users size={16} />, color: "text-foreground" },
          { label: "Hot Leads", value: hot, icon: "🔥", color: "text-green-400" },
          { label: "Warm Leads", value: warm, icon: "⚡", color: "text-yellow-400" },
          { label: "Cold Leads", value: cold, icon: "❄️", color: "text-blue-400" },
        ].map((stat) => (
          <div key={stat.label} className="bg-card border border-border/60 rounded-xl p-4" data-testid={`stat-${stat.label.toLowerCase().replace(/ /g, "-")}`}>
            <div className="text-muted-foreground text-xs mb-1 flex items-center gap-1">
              {typeof stat.icon === "string" ? stat.icon : stat.icon}
              {stat.label}
            </div>
            <p className={`text-2xl font-bold ${stat.color}`}>{isLoading ? "—" : stat.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
          <h2 className="font-semibold text-sm">Applicants</h2>
          <span className="text-xs text-muted-foreground">Auto-refreshes every 15s</span>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : leads?.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            No leads yet. Share the chatbot link to start collecting applicants.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {[...(leads ?? [])].reverse().map((lead) => (
              <div
                key={lead.id}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 hover:bg-muted/30 transition-colors"
                data-testid={`row-lead-${lead.id}`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                    {lead.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate" data-testid={`text-name-${lead.id}`}>{lead.name}</p>
                    <p className="text-xs text-muted-foreground" data-testid={`text-date-${lead.id}`}>{formatDate(lead.createdAt)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground sm:w-auto">
                  <span className="flex items-center gap-1">
                    <DollarSign size={11} />
                    <span data-testid={`text-loan-${lead.id}`}>{lead.loanAmount}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <TrendingUp size={11} />
                    <span data-testid={`text-credit-${lead.id}`}>{lead.creditScore}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Phone size={11} />
                    <a href={`tel:${lead.phone}`} className="hover:text-foreground" data-testid={`link-phone-${lead.id}`}>{lead.phone}</a>
                  </span>
                </div>

                <div className="sm:text-right">
                  <ScoreBadge score={lead.qualificationScore} />
                  <p className="text-xs text-muted-foreground mt-1 hidden sm:block">{lead.employmentStatus}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [adminPassword, setAdminPassword] = useState<string | null>(null);

  if (!adminPassword) {
    return <LoginGate onAuth={setAdminPassword} />;
  }
  return <Dashboard adminPassword={adminPassword} />;
}
