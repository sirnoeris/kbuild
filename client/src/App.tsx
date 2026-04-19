import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "./components/theme-provider";
import { AppShell } from "./components/app-shell";
import Library from "./pages/library";
import Chat from "./pages/chat";
import Settings from "./pages/settings";
import NotFound from "./pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router hook={useHashLocation}>
          <AppShell>
            <Switch>
              <Route path="/" component={Library} />
              <Route path="/chat" component={Chat} />
              <Route path="/chat/:id" component={Chat} />
              <Route path="/settings" component={Settings} />
              <Route component={NotFound} />
            </Switch>
          </AppShell>
        </Router>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
