export type ShareResult = "shared" | "copied" | "dismissed";

interface ShareLinkInput {
  title: string;
  text?: string;
  url: string;
}

async function copyWithFallback(text: string) {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // iOS/PWA webviews may expose Clipboard API but reject it without a gesture.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function shareLink(input: ShareLinkInput): Promise<ShareResult> {
  const payload: ShareData = {
    title: input.title,
    text: input.text,
    url: input.url,
  };

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (caughtError) {
      if (
        caughtError &&
        typeof caughtError === "object" &&
        "name" in caughtError &&
        caughtError.name === "AbortError"
      ) {
        return "dismissed";
      }
    }
  }

  await copyWithFallback(input.url);
  return "copied";
}
