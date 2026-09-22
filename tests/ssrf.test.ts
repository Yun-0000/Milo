import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrivateIp, parsePublicHttpUrl } from "../server/src/ssrf.ts";

describe("SSRF guard", () => {
  it("blocks loopback, private, and metadata targets", () => {
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("10.0.0.4"), true);
    assert.equal(isPrivateIp("192.168.1.9"), true);
    assert.equal(isPrivateIp("169.254.169.254"), true);
    assert.equal(isPrivateIp("172.16.5.1"), true);
    assert.equal(isPrivateIp("8.8.8.8"), false);
    assert.equal(isPrivateIp("192.0.66.161"), false, "NASA's public hosting network is not private");
    for (const ip of ["::", "::ffff:7f00:1", "fe90::1", "ff02::1", "224.0.0.1", "198.18.0.1", "192.0.2.1"]) assert.equal(isPrivateIp(ip), true, ip);
    assert.throws(() => parsePublicHttpUrl("https://example.com:8443/"), /ports/);
    assert.throws(() => parsePublicHttpUrl("http://[::ffff:127.0.0.1]/"), /Private IP/);
    assert.throws(() => parsePublicHttpUrl("http://localhost/secret"), /not allowed/);
    assert.throws(() => parsePublicHttpUrl("file:///etc/passwd"), /http/);
    assert.throws(() => parsePublicHttpUrl("http://127.0.0.1/"), /not allowed|Private IP/);
    assert.throws(() => parsePublicHttpUrl("https://user:pass@example.com"), /credentials/);
  });
});
