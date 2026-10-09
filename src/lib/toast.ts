import { toast as baseToast } from "sonner";

/** Keep diagnostic details out of visible alerts without hiding useful validation messages. */
export function friendlyErrorMessage(message: string): string {
  if (
    /supabase|one\s*signal|firebase|\bfcm\b|cloudflare|\br2\b|\bsdk\b|environment variable|service.role|publishable.key|configuration|\bsql\b|\brls\b|database|relation .*does not exist|violates .*constraint/i.test(
      message,
    )
  ) {
    return "We couldn't complete that request right now. Please try again later. If it continues, contact MKU Pulse support.";
  }
  if (/unauthorized|bearer|invalid token|no token|jwt|session expired/i.test(message)) {
    return "Your session has expired. Please sign in again and retry.";
  }
  return message;
}

export const toast = Object.assign(
  (...args: Parameters<typeof baseToast>) => baseToast(...args),
  baseToast,
  {
    error: (...args: Parameters<typeof baseToast.error>) => {
      const [message, options] = args;
      return baseToast.error(
        typeof message === "string" ? friendlyErrorMessage(message) : message,
        options,
      );
    },
  },
);
