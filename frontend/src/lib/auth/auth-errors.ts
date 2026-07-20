function authErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  if (error instanceof Error) return error.message;
  return "";
}

function authErrorStatus(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return undefined;
}

function authErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

/** True when Supabase reports the user must confirm their email before signing in. */
export function isEmailNotConfirmedError(error: unknown): boolean {
  if (authErrorCode(error) === "email_not_confirmed") return true;
  const msg = authErrorMessage(error).toLowerCase();
  return (
    msg.includes("email not confirmed") ||
    msg.includes("confirm your email") ||
    msg.includes("email address not confirmed")
  );
}

/** User-facing copy when Supabase Auth hits email / OTP rate limits (429). */
export function formatAuthRateLimitMessage(error: unknown): string | null {
  const raw = authErrorMessage(error);
  const msg = raw.toLowerCase();
  const status = authErrorStatus(error);

  if (
    status !== 429 &&
    !msg.includes("rate limit") &&
    !msg.includes("too many requests")
  ) {
    return null;
  }

  return (
    "Email sending is temporarily limited (Supabase caps how many confirmation or reset emails " +
    "can go out per hour on the built-in mailer). Wait about an hour and try again, or configure " +
    "custom SMTP under Supabase Dashboard → Authentication → Emails → SMTP Settings for higher limits."
  );
}

/** Prefer rate-limit explanation; otherwise return the original error message. */
export function formatAuthUserFacingError(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const rate = formatAuthRateLimitMessage(error);
  if (rate) return rate;
  const raw = authErrorMessage(error).trim();
  if (raw) return raw;
  return fallback;
}
