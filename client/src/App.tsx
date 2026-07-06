import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "./components/ui/toaster";
import ChatPage from "./pages/ChatPage";
import AdminPage from "./pages/AdminPage";
import ConsentFormPage from "./pages/ConsentFormPage";
import NotFound from "./pages/not-found";
import { useEffect } from "react";

// Keep the backend sandbox warm so users never hit a cold-start error
const API_PING_BASE = "https://colony-city-finance.onrender.com";

function KeepAlive() {
  useEffect(() => {
    const ping = () =>
      fetch(`${API_PING_BASE}/api/health`).catch(() => {});
    ping(); // ping immediately on load to wake the sandbox
    const id = setInterval(ping, 2 * 60 * 1000); // then every 2 minutes
    return () => clearInterval(id);
  }, []);
  return null;
}

function Nav() {
  const [location] = useLocation();
  return (
    <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <svg aria-label="Colony City Finance" viewBox="0 0 36 36" width="32" height="32" fill="none">
            <rect width="36" height="36" rx="8" fill="hsl(43,96%,56%)" />
            <path d="M18 6C11.37 6 6 11.37 6 18s5.37 12 12 12 12-5.37 12-12S24.63 6 18 6zm0 2c5.52 0 10 4.48 10 10S23.52 28 18 28 8 23.52 8 18 12.48 8 18 8z" fill="hsl(222,47%,11%)" />
            <path d="M14 14h2v8h-2zm4-2h2v12h-2zm4 4h2v6h-2z" fill="hsl(222,47%,11%)" />
          </svg>
          <span className="font-semibold text-sm tracking-tight">
            Colony City <span className="text-primary">Finance</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${location === "/" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            Apply Now
          </Link>
          <Link
            href="/consent"
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${location === "/consent" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            Consent Form
          </Link>
          <Link
            href="/admin"
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${location === "/admin" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            Admin
          </Link>
        </nav>
      </div>
    </header>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <KeepAlive />
      <Router hook={useHashLocation}>
        <div className="min-h-screen flex flex-col">
          <Nav />
          <main className="flex-1">
            <Switch>
              <Route path="/" component={ChatPage} />
              <Route path="/admin" component={AdminPage} />
              <Route path="/consent" component={ConsentFormPage} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
