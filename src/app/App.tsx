export function App() {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900">
      <a tabIndex={0} className="skip-link" href="#main">Skip to content</a>
      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 sm:px-10">
        <span className="text-xl font-semibold tracking-tight">Gibberish<span aria-hidden="true" className="text-emerald-800">.</span></span>
        <span className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium">In development · M0</span>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-12 sm:px-10 sm:py-24">
        <p className="mb-6 text-sm font-semibold uppercase tracking-widest text-emerald-800">A little space of your own</p>
        <h1 className="max-w-3xl text-4xl font-medium leading-tight tracking-tight sm:text-6xl">Your thoughts.<br />Your language.<br />Your privacy.</h1>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-stone-600">A calm, private place to write freely. Gibberish is being built around local-first journaling and encryption on your device.</p>
        <section aria-labelledby="status-heading" className="mt-12 max-w-2xl rounded-2xl border border-stone-200 bg-white p-6 sm:p-8">
          <h2 id="status-heading" className="text-lg font-semibold">The foundation is taking shape</h2>
          <p className="mt-3 leading-relaxed text-stone-600">This is an application shell. Journaling, encryption, and storage are not available yet. You cannot enter or save journal content in this version.</p>
        </section>
      </main>
      <footer className="mx-auto max-w-5xl px-6 py-8 text-sm text-stone-600 sm:px-10">Gibberish · A private journal, thoughtfully built.</footer>
    </div>
  )
}
