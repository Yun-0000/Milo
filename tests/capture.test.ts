import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dataUrlToPayload, stopTracks } from "../web/src/capture.ts";

describe("screenshot helpers", () => {
  it("stops every track", () => {
    const stopped: string[] = [];
    const stream = {
      getTracks: () => [
        { stop: () => stopped.push("a") },
        { stop: () => stopped.push("b") },
      ],
    } as unknown as MediaStream;
    stopTracks(stream);
    assert.deepEqual(stopped, ["a", "b"]);
  });

  it("parses a local data URL only after confirm-time encoding", () => {
    const payload = dataUrlToPayload("data:image/png;base64,abc");
    assert.equal(payload.imageMediaType, "image/png");
    assert.equal(payload.imageBase64, "abc");
  });
});
