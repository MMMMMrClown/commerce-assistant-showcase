export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5">
      <div className="w-full max-w-lg animate-pulse space-y-4">
        <div className="h-8 w-44 rounded-lg bg-stone-200" />
        <div className="h-4 w-72 max-w-full rounded bg-stone-200" />
        <div className="h-40 rounded-2xl bg-surface shadow-[var(--shadow-card)]" />
      </div>
    </main>
  );
}
