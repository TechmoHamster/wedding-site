import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

async function ensureServer(t) {
  try {
    const response = await fetch(`${BASE_URL}/api/form-config`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    t.skip(`Server not reachable at ${BASE_URL}. Start with: npm run dev`);
  }
}

async function getCsrfToken() {
  const response = await fetch(`${BASE_URL}/api/csrf`, { cache: "no-store" });
  assert.equal(response.ok, true, "CSRF endpoint should return 200");
  const body = await response.json();
  const setCookie = response.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0] || "";
  return {
    token: body.token,
    cookie,
  };
}

test("public config loads with expected structure", async (t) => {
  await ensureServer(t);

  const response = await fetch(`${BASE_URL}/api/form-config`, { cache: "no-store" });
  assert.equal(response.ok, true);

  const body = await response.json();
  assert.equal(Array.isArray(body.fields), true);
  assert.equal(typeof body.branding?.title, "string");

  const rsvpField = body.fields.find((field) => field.id === "rsvp");
  assert.equal(Array.isArray(rsvpField?.options), true);
});

test("submission succeeds with csrf token and unique email", async (t) => {
  await ensureServer(t);

  const { token, cookie } = await getCsrfToken();
  const unique = Date.now();

  const payload = {
    firstName: "E2E",
    lastName: "Tester",
    email: `e2e-${unique}@example.com`,
    phone: "3035551212",
    smsOptIn: "No",
    street1: "123 Test Lane",
    street2: "",
    city: "Denver",
    state: "CO",
    postalCode: "80202",
    country: "United States",
    rsvp: "Yes",
    guests: "1",
    dietaryNotes: "",
    message: "Automated e2e submission",
    website: "",
  };

  const response = await fetch(`${BASE_URL}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": token,
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.submissionId, "string");
  assert.equal(body.submissionId.length > 10, true);
});

test("conditional flow: RSVP No can submit without guest count", async (t) => {
  await ensureServer(t);

  const { token, cookie } = await getCsrfToken();
  const unique = `${Date.now()}-no`;

  const payload = {
    firstName: "E2E",
    lastName: "Tester",
    email: `e2e-${unique}@example.com`,
    phone: "3035551212",
    smsOptIn: "Yes",
    street1: "123 Test Lane",
    city: "Denver",
    state: "CO",
    postalCode: "80202",
    country: "United States",
    rsvp: "No",
    guests: "",
    dietaryNotes: "",
    message: "No RSVP path",
    website: "",
  };

  const response = await fetch(`${BASE_URL}/api/submissions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": token,
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
});
