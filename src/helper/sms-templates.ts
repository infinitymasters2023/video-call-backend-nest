/**
 * DLT-registered SMS templates.
 *
 * Indian DLT rules mean the operator only delivers a message whose body matches
 * the template registered against the `tid` it was sent with — anything else is
 * accepted by the gateway (HTTP 200) and then silently dropped, so the sender
 * sees success and the handset gets nothing.
 *
 * Every OTP message therefore goes through one builder here. If the wording and
 * the id ever need to change they change together, in one place.
 */

/** Registered as: "Welcome to Infinity, Your OTP to Login to Infinity TechCare
 *  Lounge is {#var#}. For Help, Call Infinity 8447882424. 9AM-6PM Mon-Sat" */
export const OTP_TEMPLATE_ID =
  process.env.SMS_OTP_TEMPLATE_ID?.trim() || '1107162426891569578';

/**
 * The one approved OTP body. The code is the only variable part.
 *
 * Used for signup, profile completion and password reset alike. A reset-specific
 * wording would read better, but it needs its own DLT registration first — set
 * SMS_OTP_TEMPLATE_ID and update this builder together once that exists.
 */
export function buildOtpSms(code: string): string {
  return `Welcome to Infinity, Your OTP to Login to Infinity TechCare Lounge is ${code}. For Help, Call Infinity 8447882424. 9AM-6PM Mon-Sat`;
}
