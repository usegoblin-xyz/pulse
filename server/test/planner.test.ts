import { test } from "node:test";
import assert from "node:assert/strict";
import { planFill, type ModelClient } from "../src/planner.js";
import type { FormField } from "../src/types.js";

/** A fake model whose reply is fixed per test; also records what it was sent. */
function mockModel(reply: string) {
  const seen: { system: string; user: string }[] = [];
  const client: ModelClient = {
    async complete(system, user) {
      seen.push({ system, user });
      return reply;
    },
  };
  return { client, seen };
}

const F = (id: string, over: Partial<FormField> = {}): FormField => ({ id, type: "text", ...over });

test("fills known non-sensitive fields from the model", async () => {
  const fields = [F("f1", { label: "Full name" }), F("f2", { label: "Email", type: "email" })];
  const { client } = mockModel(JSON.stringify({ fills: [
    { fieldId: "f1", value: "Ada Lovelace" },
    { fieldId: "f2", value: "ada@example.com" },
  ] }));
  const plan = await planFill(fields, { fullName: "Ada Lovelace", email: "ada@example.com" }, client);
  assert.deepEqual(plan.fills, [
    { fieldId: "f1", value: "Ada Lovelace" },
    { fieldId: "f2", value: "ada@example.com" },
  ]);
});

test("drops values for unknown / hallucinated field ids", async () => {
  const fields = [F("f1", { label: "City" })];
  const { client } = mockModel(JSON.stringify({ fills: [
    { fieldId: "f1", value: "Paris" },
    { fieldId: "ghost", value: "malware" },
  ] }));
  const plan = await planFill(fields, { city: "Paris" }, client);
  assert.deepEqual(plan.fills, [{ fieldId: "f1", value: "Paris" }]);
});

test("GUARDRAIL: a model that tries to submit/click/navigate produces no such action", async () => {
  const fields = [F("f1", { label: "Name" })];
  // Adversarial model reply smuggling extra action keys.
  const { client } = mockModel(JSON.stringify({
    fills: [{ fieldId: "f1", value: "Grace" }],
    submit: true,
    actions: [{ type: "click", selector: "button[type=submit]" }],
    navigate: "https://evil.example/checkout",
  }));
  const plan = await planFill(fields, { fullName: "Grace" }, client);
  // The plan can only ever be { fills, asks } — no path exists for a submit.
  assert.deepEqual(Object.keys(plan).sort(), ["asks", "fills"]);
  assert.equal((plan as any).submit, undefined);
  assert.equal((plan as any).actions, undefined);
  assert.equal((plan as any).navigate, undefined);
});

test("GUARDRAIL: sensitive fields are never sent to the model and never filled", async () => {
  const fields = [
    F("f1", { label: "Email", type: "email" }),
    F("pw", { label: "Password", type: "password" }),
    F("cc", { label: "Card number", name: "cardNumber" }),
    F("ssn", { label: "Social security number" }),
  ];
  // Even if the model returned values for the secrets, they must be ignored.
  const { client, seen } = mockModel(JSON.stringify({ fills: [
    { fieldId: "f1", value: "a@b.com" },
    { fieldId: "pw", value: "hunter2" },
    { fieldId: "cc", value: "4111111111111111" },
    { fieldId: "ssn", value: "078-05-1120" },
  ] }));
  const plan = await planFill(fields, { email: "a@b.com" }, client);

  // Only the email got filled.
  assert.deepEqual(plan.fills, [{ fieldId: "f1", value: "a@b.com" }]);
  // The three secrets are asks, not fills.
  for (const id of ["pw", "cc", "ssn"]) assert.ok(plan.asks.some((a) => a.fieldId === id));
  // And their labels/names were never put in front of the model.
  const sent = seen.map((s) => s.user).join("\n");
  for (const needle of ["Password", "Card number", "cardNumber", "Social security"]) {
    assert.ok(!sent.includes(needle), `sensitive hint "${needle}" leaked to model`);
  }
});

test("GUARDRAIL: sensitive-looking profile keys are scrubbed before the model sees them", async () => {
  const fields = [F("f1", { label: "Full name" })];
  const { client, seen } = mockModel(JSON.stringify({ fills: [{ fieldId: "f1", value: "Ada" }] }));
  await planFill(fields, { fullName: "Ada", ssn: "078-05-1120", cardNumber: "4111111111111111" }, client);
  const sent = seen.map((s) => s.user).join("\n");
  assert.ok(sent.includes("Ada"), "safe profile value should be sent");
  assert.ok(!sent.includes("078-05-1120"), "SSN profile value leaked to model");
  assert.ok(!sent.includes("4111111111111111"), "card profile value leaked to model");
});

test("select values must be one of the real options", async () => {
  const fields = [F("f1", { label: "Country", type: "select", options: ["US", "UK", "CA"] })];
  const { client } = mockModel(JSON.stringify({ fills: [{ fieldId: "f1", value: "Atlantis" }] }));
  const plan = await planFill(fields, { country: "Atlantis" }, client);
  assert.equal(plan.fills.length, 0); // invalid option rejected
});

test("required fields with no value become asks", async () => {
  const fields = [F("f1", { label: "Passport #", required: true })];
  const { client } = mockModel(JSON.stringify({ fills: [] }));
  const plan = await planFill(fields, {}, client);
  assert.ok(plan.asks.some((a) => a.fieldId === "f1"));
});
