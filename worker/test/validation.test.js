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
  tabs: [
    { id: "default", name: "默认" },
    { id: "tab-mev", name: "MEV" }
  ],
  activeTabId: "default",
  items: [
    { id: "item-1", name: "OpenAI", url: "https://openai.com/", icon: "sparkles", description: "AI tools", tabId: "default" },
    { id: "item-2", name: "", url: "github.com", tabId: "tab-mev" }
  ]
};

test("validateBoardState accepts a valid board payload", () => {
  assert.equal(validateBoardState([validBoard]), null);
  assert.equal(validateBoardState([{ ...validBoard, displayMode: "urls" }]), null);
  assert.equal(validateBoardState([{ ...validBoard, tabs: undefined, activeTabId: undefined, items: validBoard.items.map(({ tabId, ...item }) => item) }]), null);
});

test("validateBoardState rejects invalid board shape", () => {
  assert.equal(validateBoardState({ boards: [] }), "Expected array");
  assert.equal(validateBoardState([{ ...validBoard, id: "" }]), "Invalid board id");
  assert.equal(validateBoardState([{ ...validBoard, accent: "blue" }]), "Invalid board accent");
  assert.equal(validateBoardState([{ ...validBoard, displayMode: "grid" }]), "Invalid board display mode");
  assert.equal(validateBoardState([{ ...validBoard, tabs: "MEV" }]), "Invalid board tabs");
  assert.equal(validateBoardState([{ ...validBoard, activeTabId: "missing" }]), "Invalid board active tab");
  assert.equal(validateBoardState([{ ...validBoard, tabs: [{ id: "default", name: "" }] }]), "Invalid board tab name");
  assert.equal(validateBoardState([{ ...validBoard, items: [{ id: "item-1", name: "Bad tab", url: "https://example.com", tabId: "missing" }] }]), "Invalid item tab");
  assert.equal(validateBoardState([{ ...validBoard, items: [{ id: "item-1", name: "Bad icon", url: "https://example.com", icon: "bad icon" }] }]), "Invalid item icon");
  assert.equal(validateBoardState([{ ...validBoard, items: [{ id: "item-1", name: "Long desc", url: "https://example.com", description: "x".repeat(301) }] }]), "Invalid item description");
});

test("validateBoardState rejects invalid item URLs", () => {
  assert.equal(
    validateBoardState([{ ...validBoard, items: [{ id: "item-1", name: "Bad", url: "javascript:alert(1)" }] }]),
    "Invalid item URL"
  );
});

test("validateBoardState enforces board limit", () => {
  assert.equal(validateBoardState(Array.from({ length: 101 }, (_, i) => ({ ...validBoard, id: "b-" + i }))), "Too many boards");
});

test("validateBoardState enforces board item limit", () => {
  assert.equal(
    validateBoardState([{ ...validBoard, items: Array.from({ length: 100 }, (_, i) => ({ id: "i-" + i, name: "", url: "https://example.com/" + i })) }]),
    null
  );
  assert.equal(
    validateBoardState([{ ...validBoard, items: Array.from({ length: 101 }, (_, i) => ({ id: "i-" + i, name: "", url: "https://example.com/" + i })) }]),
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
