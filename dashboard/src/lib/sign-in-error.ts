type SignInError = { code?: string; status?: number };

// Connection failures must never be presented as a rejected password.
export function signInErrorMessage(error: SignInError): string {
  if (error.code === "invalid_credentials") return "Wrong email or password.";
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "Too many sign-in attempts. Please wait a few minutes and try again.";
  }
  if (error.code === "email_not_confirmed") {
    return "Please confirm your email before signing in.";
  }
  return "The sign-in service is temporarily unavailable. Please try again shortly. Your password may be correct.";
}
