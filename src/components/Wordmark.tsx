/** The name in chrome. Text, not an image: it scales with its context. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wide chrome-text select-none leading-none ${className}`} translate="no">
      ROLL
    </span>
  );
}
