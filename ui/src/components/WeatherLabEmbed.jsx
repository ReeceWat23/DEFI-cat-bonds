const WEATHER_LAB_URL = 'https://deepmind.google.com/science/weatherlab'

// Google's cyclone tracker is a live, free data source we lean on for
// event tracking instead of building our own. Some Google properties send
// X-Frame-Options / CSP frame-ancestors headers that refuse to be framed —
// that can't be detected from inside the iframe (cross-origin), so we
// always keep an "open in a new tab" escape hatch visible rather than
// silently showing a blank box if framing is ever blocked.
export default function WeatherLabEmbed({ className = '' }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-[var(--rhodex-border-white)] bg-[#1c1f22] shadow-lg ${className}`}>
      {/* browser chrome bar */}
      <div className="flex items-center justify-between gap-3 bg-[#26292d] px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 truncate text-xs text-white/50">deepmind.google.com/science/weatherlab</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/40">
          <span>Google Weather Lab</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5">Experimental</span>
        </div>
        <a
          href={WEATHER_LAB_URL}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/80 transition hover:bg-white/20"
        >
          Open ↗
        </a>
      </div>

      <div className="relative aspect-[16/10] w-full bg-[#10171f]">
        <iframe
          src={WEATHER_LAB_URL}
          title="Google Weather Lab — live cyclone tracker"
          className="h-full w-full border-0"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-white/10 bg-[#1c1f22] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-white/55">
          Live AI cyclone tracks &amp; wind-path data, powered by Google DeepMind WeatherNext.
        </p>
        <a
          href={WEATHER_LAB_URL}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-semibold text-[var(--rhodex-accent)] hover:underline"
        >
          View full tracker ↗
        </a>
      </div>
    </div>
  )
}
