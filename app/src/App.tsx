import { EngineStartup } from "@/components/EngineStartup";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export default function App() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="text-base font-semibold tracking-tight">Statly</span>
        <ThemeSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <EngineStartup />
      </main>
    </div>
  );
}
