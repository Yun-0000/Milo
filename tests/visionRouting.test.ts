import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestHasImage, toImageDataUrl } from "../server/src/imagePayload.ts";

describe("image payload helpers", () => {
  it("routes to vision only when an image payload is present", () => {
    assert.equal(requestHasImage(undefined), false);
    assert.equal(requestHasImage({ data: "abc", mediaType: "image/png" }), true);
    assert.equal(toImageDataUrl({ data: "abc", mediaType: "image/jpeg" }), "data:image/jpeg;base64,abc");
  });
});
