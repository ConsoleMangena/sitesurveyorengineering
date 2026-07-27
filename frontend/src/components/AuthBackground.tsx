/**
 * AuthBackground
 *
 * Decorative, pointer-free layer for the auth screens. It adds slow-moving
 * gradient orbs and a faint survey-grid pattern behind the card without
 * stealing focus from the form.
 */
export default function AuthBackground() {
  return (
    <div className="auth-background" aria-hidden="true">
      <div className="auth-blob auth-blob-1" />
      <div className="auth-blob auth-blob-2" />
      <div className="auth-blob auth-blob-3" />
      <svg className="auth-bg-grid" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id="auth-survey-grid"
            width="80"
            height="80"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 80 0 L 0 0 0 80"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.7"
              strokeOpacity="0.18"
            />
            <circle
              cx="40"
              cy="40"
              r="1.5"
              fill="currentColor"
              fillOpacity="0.22"
            />
            <path
              d="M 40 30 L 40 50 M 30 40 L 50 40"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.7"
              strokeOpacity="0.16"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#auth-survey-grid)" />
      </svg>
      <div className="auth-bg-vignette" />
    </div>
  );
}
