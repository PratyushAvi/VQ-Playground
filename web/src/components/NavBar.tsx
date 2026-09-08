// The top bar, shared by the landing page and the playground.

const LINKS = [
  { label: "vq-bench.com", href: "https://www.vq-bench.com", external: true },
  { label: "GitHub", href: "https://github.com/pinecone-io/vq-bench", external: true },
];

type Props = {
  /** Which in-app view is showing; the other is offered as a link. */
  view: "landing" | "playground";
  onNavigate: (view: "landing" | "playground") => void;
};

export function NavBar({ view, onNavigate }: Props) {
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <button
          onClick={() => onNavigate("landing")}
          className="font-serif text-base tracking-tight text-slate-900"
        >
          VQ-bench Playground
        </button>

        <div className="flex flex-1 items-center gap-4 text-sm">
          <button
            onClick={() => onNavigate("playground")}
            className={
              view === "playground"
                ? "font-medium text-slate-900"
                : "text-slate-500 hover:text-slate-900"
            }
          >
            Playground
          </button>
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="text-slate-500 hover:text-slate-900"
            >
              {link.label}
              <span aria-hidden className="ml-0.5 text-xs text-slate-400">
                ↗
              </span>
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
