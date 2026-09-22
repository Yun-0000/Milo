import assert from "node:assert/strict";
import { it } from "node:test";
import { openFloatingAssistant } from "../web/src/floating.ts";

it("moves the same assistant host into a floating document and restores it on close", async () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const moved: unknown[] = [];
  const host = {} as HTMLElement;
  let closed = 0;
  let onHide: (() => void) | undefined;
  const floating = {
    document: {
      title: "",
      documentElement: { classList: { add() {} } },
      head: { prepend() {} },
      body: { append: (element: unknown) => moved.push(element) },
      createElement: () => ({}),
    },
    addEventListener: (name: string, callback: () => void, options: { once: boolean }) => {
      assert.equal(name, "pagehide");
      assert.equal(options.once, true);
      onHide = callback;
    },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelectorAll: () => [], baseURI: "https://milo.example/" } });
  try {
    const result = await openFloatingAssistant(host, { append: (element: unknown) => moved.push(element) } as HTMLElement, () => closed++, {
      requestWindow: async (options) => {
        assert.deepEqual(options, { width: 384, height: 240 });
        return floating as unknown as Window;
      },
    });
    assert.equal(result, floating);
    assert.equal(floating.document.title, "Milo");
    assert.deepEqual(moved, [host]);
    onHide!();
    assert.deepEqual(moved, [host, host]);
    assert.equal(closed, 1);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
