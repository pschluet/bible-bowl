'use client';

const shortcuts = [
  { keys: ['0', '1', '2', '3'], label: 'Enter score' },
  { keys: ['x'], label: 'Delete score' },
  { keys: ['↑', '↓', 'Tab'], label: 'Move between teams' },
];

export default function KeyboardLegend() {
  return (
    // hidden on mobile; visible on md+ (desktop), where keyboard shortcuts apply
    <div className="group relative hidden md:inline-flex items-center">
      <button
        type="button"
        aria-label="Keyboard shortcuts"
        className="flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {/* info circle icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Tooltip — revealed on hover or keyboard focus within the group */}
      <div
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-50 mt-2 w-max -translate-x-1/2 rounded-md border border-gray-200 bg-white p-3 text-xs shadow-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <p className="mb-2 font-semibold text-gray-700">Keyboard shortcuts</p>
        <dl className="space-y-1.5">
          {shortcuts.map(({ keys, label }) => (
            <div key={label} className="flex items-center gap-2">
              <dt className="flex shrink-0 gap-1">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-gray-300 bg-gray-100 px-1 font-mono text-[10px] text-gray-700"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-gray-500">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
