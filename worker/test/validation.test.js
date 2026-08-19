const test = require("node:test");
const assert = require("node:assert/strict");
const { isUrlSafe } = require("../../.tmp-test/src/urlSafety.js");
const { isStoredUrlAllowed, validateBoardState, validateLayoutSettings, validatePagesState } = require("../../.tmp-test/src/validation.js");

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

test("validateLayoutSettings accepts and rejects layout options", () => {
  assert.equal(validateLayoutSettings(undefined), null);
  assert.equal(validateLayoutSettings({ columnMode: "auto", columns: 3, columnWidth: 250, columnGap: 10, rowGap: 10, align: "left", showBoardIcon: false, showBoardCount: true, showItemDragHandle: false }), null);
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 6, columnWidth: 360, columnGap: 32, rowGap: 0, align: "center" }), null);
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 7, columnWidth: 250, align: "left" }), "Invalid layout columns");
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 3, columnWidth: 200, align: "left" }), "Invalid layout column width");
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 3, columnWidth: 250, columnGap: 33, align: "left" }), "Invalid layout column gap");
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 3, columnWidth: 250, rowGap: -1, align: "left" }), "Invalid layout row gap");
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 3, columnWidth: 250, align: "right" }), "Invalid layout alignment");
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 3, columnWidth: 250, showBoardIcon: "no" }), "Invalid layout board icon visibility");
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 3, columnWidth: 250, showBoardCount: "no" }), "Invalid layout board count visibility");
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 3, columnWidth: 250, showItemDragHandle: "no" }), "Invalid layout item drag handle visibility");
});

test("validatePagesState accepts and rejects page payloads", () => {
  assert.equal(validatePagesState(undefined), null);
  assert.equal(validatePagesState([{ id: "page-1", name: "Home", boards: [validBoard] }]), null);
  assert.equal(validatePagesState({ pages: [] }), "Invalid pages");
  assert.equal(validatePagesState(Array.from({ length: 31 }, (_, i) => ({ id: "p-" + i, name: "Page " + i, boards: [] }))), "Too many pages");
  assert.equal(validatePagesState([{ id: "", name: "Home", boards: [] }]), "Invalid page id");
  assert.equal(validatePagesState([{ id: "page-1", name: "", boards: [] }]), "Invalid page name");
  assert.equal(validatePagesState([{ id: "page-1", name: "Home", boards: "bad" }]), "Invalid page boards");
  assert.equal(validatePagesState([{ id: "page-1", name: "Home", boards: [{ ...validBoard, id: "" }] }]), "Invalid board id");
  assert.equal(validatePagesState([{ id: "page-1", name: "Home", boards: [] }, { id: "page-1", name: "Work", boards: [] }]), "Duplicate page id");
});

test("validateBoardState enforces board limit", () => {
  assert.equal(validateBoardState(Array.from({ length: 101 }, (_, i) => ({ ...validBoard, id: "b-" + i }))), "Too many boards");
});

test("validateBoardState enforces board tab and item limits", () => {
  assert.equal(
    validateBoardState([{ ...validBoard, activeTabId: "t-0", tabs: Array.from({ length: 100 }, (_, i) => ({ id: "t-" + i, name: "Tab " + i })), items: [] }]),
    null
  );
  assert.equal(
    validateBoardState([{ ...validBoard, activeTabId: "t-0", tabs: Array.from({ length: 101 }, (_, i) => ({ id: "t-" + i, name: "Tab " + i })), items: [] }]),
    "Too many board tabs"
  );
  assert.equal(
    validateBoardState([{ ...validBoard, items: Array.from({ length: 500 }, (_, i) => ({ id: "i-" + i, name: "", url: "https://example.com/" + i })) }]),
    null
  );
  assert.equal(
    validateBoardState([{ ...validBoard, items: Array.from({ length: 501 }, (_, i) => ({ id: "i-" + i, name: "", url: "https://example.com/" + i })) }]),
    "Too many board tab items"
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
