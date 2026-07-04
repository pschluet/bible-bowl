/**
 * Small inline spinner for use inside buttons while an async action
 * (typically a delete) is in flight. Size and color inherit from
 * className so it can match its surrounding button.
 */
export default function Spinner({
  className = 'h-4 w-4 border-2 border-white/40 border-t-white',
}: {
  className?: string;
}) {
  return (
    <span className={`inline-block animate-spin rounded-full ${className}`} aria-hidden="true" />
  );
}
