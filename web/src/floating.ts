export interface DocumentPip {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

export function pictureInPicture(): DocumentPip | undefined {
  return (window as Window & { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;
}

// Keep the portal host itself: moving its children to another React root would reset the call.
export async function openFloatingAssistant(host: HTMLElement, home: HTMLElement, onClose: () => void, api = pictureInPicture()) {
  if (!api) throw new Error("Floating windows aren’t supported here. Open Milo in desktop Chrome or Edge, or use this window.");
  const floating = await api.requestWindow({ width: 384, height: 240 });
  floating.document.title = "Milo";
  floating.document.documentElement.classList.add("floating-document");
  for (const source of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    const copy = source.cloneNode(true) as HTMLLinkElement;
    if (source instanceof HTMLLinkElement) copy.href = source.href;
    floating.document.head.append(copy);
  }
  const base = floating.document.createElement("base");
  base.href = document.baseURI;
  floating.document.head.prepend(base);
  floating.document.body.append(host);
  floating.addEventListener("pagehide", () => {
    home.append(host);
    onClose();
  }, { once: true });
  return floating;
}
