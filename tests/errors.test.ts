import assert from "node:assert/strict";
import { it } from "node:test";
import { publicApiFailure } from "../server/src/errors.ts";
import { voiceErrorMessage } from "../web/src/components/VoiceChat.tsx";

it("distinguishes exhausted credits from rate limiting without leaking raw SDK errors", () => {
  const credit = publicApiFailure({ status: 429, code: "credit_balance_exhausted", message: "sensitive SDK request" });
  assert.equal(credit.code, "API_CREDITS_EXHAUSTED");
  assert.match(voiceErrorMessage(new Error(credit.message)), /credits are exhausted/);
  assert.equal(publicApiFailure({ status: 429, code: "rate_limit_exceeded" }).code, "API_RATE_LIMITED");
  assert.equal(publicApiFailure({ status: 401 }).code, "API_AUTH_FAILED");
  assert.doesNotMatch(JSON.stringify(credit), /sensitive/);
});
