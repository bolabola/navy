const test = require("node:test");
const assert = require("node:assert/strict");
const { isUrlSafe } = require("../../.tmp-test/src/urlSafety.js");
const { isStoredUrlAllowed, validateBoardState } = require("../../.tmp-test/src/validation.js");

const validBoard = {
  id: "board-1",
  title: "Tools",
  accent: "#0079bf",
  icon: "layout-grid",
  height: 240,
  collapsed: false,
  column: null,
  displayMode: "list",
  items: [
    { id: "item-1", name: "OpenAI", url: "https://openai.com/" },
    { id: "item-2", name: "", url: "github.com" }
  ]
};

test("validateBoardState accepts a valid board payload", () => {
  assert.equal(validateBoardState([validBoard]), null);
});

test("validateBoardState rejects invalid board shape", () => {
  assert.equal(validateBoardState({ boards: [] }), "Expected array");
  assert.equal(validateBoardState([{ ...validBoard, id: "" }]), "Invalid board id");
  assert.equal(validateBoardState([{ ...validBoard, accent: "blue" }]), "Invalid board accent");
  assert.equal(validateBoardState([{ ...validBoard, displayMode: "grid" }]), "Invalid board display mode");
});

test("validateBoardState rejects invalid item URLs", () => {
  assert.equal(
    validateBoardState([{ ...validBoard, items: [{ id: "item-1", name: "Bad", url: "javascript:alert(1)" }] }]),
    "Invalid item URL"
  );
});

test("validateBoardState enforces board and item limits", () => {
  assert.equal(validateBoardState(Array.from({ length: 101 }, (_, i) => ({ ...validBoard, id: "b-" + i }))), "Too many boards");
  assert.equal(
    validateBoardState([{ ...validBoard, items: Array.from({ length: 501 }, (_, i) => ({ id: "i-" + i, name: "", url: "https://example.com/" })) }]),
    "Too many board items"
  );
});

test("isStoredUrlAllowed accepts http, https, protocol-relative, and bare domains", () => {
  assert.equal(isStoredUrlAllowed("https://example.com/path"), true);
  assert.equal(isStoredUrlAllowed("http://example.com/path"), true);
  assert.equal(isStoredUrlAllowed("//example.com/path"), true);
  assert.equal(isStoredUrlAllowed("example.com/path"), true);
});

test("isStoredUrlAllowed rejects dangerous or malformed values", () => {
  assert.equal(isStoredUrlAllowed("javascript:alert(1)"), false);
  assert.equal(isStoredUrlAllowed("data:text/html,hi"), false);
  assert.equal(isStoredUrlAllowed("https://exa mple.com"), false);
  assert.equal(isStoredUrlAllowed(""), false);
});

test("isUrlSafe rejects private and local network targets", () => {
  assert.equal(isUrlSafe("http://localhost/"), false);
  assert.equal(isUrlSafe("http://127.0.0.1/"), false);
  assert.equal(isUrlSafe("http://10.0.0.1/"), false);
  assert.equal(isUrlSafe("http://172.16.0.1/"), false);
  assert.equal(isUrlSafe("http://192.168.1.1/"), false);
  assert.equal(isUrlSafe("http://169.254.169.254/"), false);
  assert.equal(isUrlSafe("http://[::1]/"), false);
  assert.equal(isUrlSafe("http://service.local/"), false);
  assert.equal(isUrlSafe("http://service.internal/"), false);
  assert.equal(isUrlSafe("http://service.lan/"), false);
  assert.equal(isUrlSafe("http://metadata.google.internal/"), false);
  assert.equal(isUrlSafe("http://2130706433/"), false);
  assert.equal(isUrlSafe("http://0x7f000001/"), false);
});
