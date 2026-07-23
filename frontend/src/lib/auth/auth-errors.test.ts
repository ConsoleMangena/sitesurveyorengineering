import { describe, expect, it } from "vitest";
import {
  formatAuthRateLimitMessage,
  formatAuthUserFacingError,
  isEmailNotConfirmedError,
} from "./auth-errors.ts";

describe("formatAuthRateLimitMessage", () => {
  it("detects message substring", () => {
    expect(
      formatAuthRateLimitMessage(new Error("Email rate limit exceeded")),
    ).toContain("SMTP");
  });

  it("detects HTTP 429 status", () => {
    const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
    expect(formatAuthRateLimitMessage(err)).toContain("SMTP");
  });

  it("returns null for unrelated errors", () => {
    expect(formatAuthRateLimitMessage(new Error("Invalid login"))).toBeNull();
  });
});

describe("formatAuthUserFacingError", () => {
  it("uses fallback for unknown errors", () => {
    expect(formatAuthUserFacingError(null, "Fallback.")).toBe("Fallback.");
  });
});

describe("isEmailNotConfirmedError", () => {
  it("detects Supabase error code", () => {
    const err = Object.assign(new Error("anything"), {
      code: "email_not_confirmed",
    });
    expect(isEmailNotConfirmedError(err)).toBe(true);
  });

  it("detects classic 'Email not confirmed' message", () => {
    expect(isEmailNotConfirmedError(new Error("Email not confirmed"))).toBe(
      true,
    );
  });

  it("returns false for unrelated errors", () => {
    expect(
      isEmailNotConfirmedError(new Error("Invalid login credentials")),
    ).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isEmailNotConfirmedError(null)).toBe(false);
    expect(isEmailNotConfirmedError(undefined)).toBe(false);
  });
});
