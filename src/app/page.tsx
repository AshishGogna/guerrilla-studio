export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative mx-auto max-w-6xl px-6 py-20 sm:px-10 lg:px-16">
        <header className="mb-24 flex items-center justify-between">
          <span className="font-mono text-sm uppercase tracking-[0.2em] text-foreground/60">
            Studio
          </span>
          <nav className="flex gap-8 font-mono text-sm">
            <a href="/projects" className="text-foreground/70 transition hover:text-accent">
              Projects
            </a>
            <a href="/panels" className="text-foreground/70 transition hover:text-accent">
              Panels
            </a>
            <a href="#work" className="text-foreground/70 transition hover:text-accent">
              Work
            </a>
            <a href="#about" className="text-foreground/70 transition hover:text-accent">
              About
            </a>
            <a href="#contact" className="text-foreground/70 transition hover:text-accent">
              Contact
            </a>
          </nav>
        </header>

        <main className="pt-12">
          <h1 className="font-sans text-[clamp(3.5rem,12vw,8rem)] font-extrabold leading-[0.95] tracking-tight text-foreground">
            Guerrilla
          </h1>
          <h1 className="font-sans text-[clamp(3.5rem,12vw,8rem)] font-extrabold leading-[0.95] tracking-tight text-accent">
            Studio
          </h1>

          <p className="mt-12 max-w-xl text-lg text-foreground/75 sm:text-xl">
            Unconventional creative work. No brief too wild, no idea too raw.
            We make things that stick.
          </p>

          <div className="mt-16 flex flex-wrap gap-4">
            <a
              href="#work"
              className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-semibold text-background transition hover:bg-accent-muted"
            >
              See the work
            </a>
            <a
              href="#contact"
              className="inline-flex items-center gap-2 rounded-full border border-foreground/30 px-6 py-3 font-semibold transition hover:border-accent hover:text-accent"
            >
              Get in touch
            </a>
          </div>
        </main>

        <footer className="absolute bottom-8 left-6 right-6 flex justify-between sm:left-10 sm:right-10 lg:left-16 lg:right-16">
          <span className="font-mono text-xs text-foreground/40">
            Est. 2025
          </span>
          <span className="font-mono text-xs text-foreground/40">
            Make it raw.
          </span>
        </footer>
      </div>
    </div>
  );
}
