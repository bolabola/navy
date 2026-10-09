import assert from "node:assert/strict";
import { test } from "vitest";
import { isUrlSafe } from "../src/urlSafety";
import { cleanBoards, isStoredUrlAllowed, validateBoardState, validateLayoutSettings, validatePagesState } from "../src/validation";

const validBoard = {
  id: "board-1",
  title: "Tools",
  accent: "#0079bf",
  icon: "layout-grid",
  height: 240,
  collapsed: false,
  column: null,
  displayMode: "list",
  iconSize: "medium",
  tabs: [{ id: "default", name: "默认" }, { id: "tab-mev", name: "MEV" }],
  activeTabId: "default",
  items: [
    { id: "item-1", name: "OpenAI", url: "https://openai.com/", icon: "sparkles", description: "AI tools", tabId: "default" },
    { id: "item-2", name: "", url: "github.com", tabId: "tab-mev" }
  ]
};

test("validateBoardState accepts a valid board payload", () => {
  assert.equal(validateBoardState([validBoard]), null);
  assert.equal(validateBoardState([{ ...validBoard, displayMode: "urls" }]), null);
  assert.equal(validateBoardState([{ ...validBoard, tabs: undefined, activeTabId: undefined, items: validBoard.items.map(({ tabId: _t, ...item }) => item) }]), null);
});

test("cleanBoards keeps known fields, drops unknown ones and clamps height", () => {
  const result = cleanBoards([{ ...validBoard, height: 99999, junk: true, items: [{ ...validBoard.items[0], junk: 1 }], tabs: [{ id: "default", name: "默认", junk: 1 }] }]);
  assert.ok(result.ok);
  const [b] = result.value;
  assert.equal(b.height, 4096);
  assert.equal(b.iconSize, "medium");
  assert.equal("junk" in b, false);
  assert.equal("collapsed" in b, false);
  assert.deepEqual(Object.keys(b.items![0]).sort(), ["description", "icon", "id", "name", "tabId", "url"]);
  assert.deepEqual(b.tabs, [{ id: "default", name: "默认" }]);
});

test("validateBoardState rejects invalid board shape", () => {
  assert.equal(validateBoardState({ boards: [] }), "Expected array");
  assert.equal(validateBoardState([{ ...validBoard, id: "" }]), "Invalid board id");
  assert.equal(validateBoardState([{ ...validBoard, accent: "blue" }]), "Invalid board accent");
  assert.equal(validateBoardState([{ ...validBoard, displayMode: "grid" }]), "Invalid board display mode");
  assert.equal(validateBoardState([{ ...validBoard, iconSize: "xl" }]), "Invalid board icon size");
  assert.equal(validateBoardState([{ ...validBoard, tabs: "MEV" }]), "Invalid board tabs");
  assert.equal(validateBoardState([{ ...validBoard, activeTabId: "missing" }]), "Invalid board active tab");
  assert.equal(validateBoardState([{ ...validBoard, tabs: [{ id: "default", name: "" }] }]), "Invalid board tab name");
  assert.equal(validateBoardState([{ ...validBoard, items: [{ id: "item-1", name: "Bad tab", url: "https://example.com", tabId: "missing" }] }]), "Invalid item tab");
  assert.equal(validateBoardState([{ ...validBoard, items: [{ id: "item-1", name: "Bad icon", url: "https://example.com", icon: "bad icon" }] }]), "Invalid item icon");
  assert.equal(validateBoardState([{ ...validBoard, items: [{ id: "item-1", name: "Long desc", url: "https://example.com", description: "x".repeat(301) }] }]), "Invalid item description");
});

test("validateBoardState rejects invalid item URLs", () => {
  assert.equal(validateBoardState([{ ...validBoard, items: [{ id: "item-1", name: "Bad", url: "javascript:alert(1)" }] }]), "Invalid item URL");
});

test("validateLayoutSettings accepts and rejects layout options", () => {
  assert.equal(validateLayoutSettings(undefined), null);
  assert.equal(validateLayoutSettings({ columnMode: "auto", columns: 3, columnWidth: 250, columnGap: 10, rowGap: 10, align: "left", showBoardIcon: false, showBoardCount: true, showItemDragHandle: false }), null);
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 6, columnWidth: 360, columnGap: 32, rowGap: 0, align: "center" }), null);
  assert.equal(validateLayoutSettings({ columnMode: "manual", columns: 7 }), "Invalid layout columns");
  assert.equal(validateLayoutSettings({ columnWidth: 200 }), "Invalid layout column width");
  assert.equal(validateLayoutSettings({ columnGap: 33 }), "Invalid layout column gap");
  assert.equal(validateLayoutSettings({ rowGap: -1 }), "Invalid layout row gap");
  assert.equal(validateLayoutSettings({ align: "right" }), "Invalid layout alignment");
  assert.equal(validateLayoutSettings({ showBoardIcon: "yes" }), "Invalid layout board icon visibility");
  assert.equal(validateLayoutSettings({ columnMode: "grid" }), "Invalid layout column mode");
});

test("validatePagesState accepts and rejects page payloads", () => {
  assert.equal(validatePagesState(undefined), null);
  assert.equal(validatePagesState([{ id: "p1", name: "Home", boards: [validBoard] }]), null);
  assert.equal(validatePagesState("pages"), "Invalid pages");
  assert.equal(validatePagesState([{ id: "", name: "Home", boards: [] }]), "Invalid page id");
  assert.equal(validatePagesState([{ id: "p1", name: "Home", boards: [] }, { id: "p1", name: "Dup", boards: [] }]), "Duplicate page id");
  assert.equal(validatePagesState([{ id: "p1", name: "", boards: [] }]), "Invalid page name");
  assert.equal(validatePagesState([{ id: "p1", name: "Home", boards: {} }]), "Invalid page boards");
  assert.equal(validatePagesState(Array.from({ length: 31 }, (_, i) => ({ id: "p" + i, name: "P", boards: [] }))), "Too many pages");
});

test("validateBoardState enforces board, tab and item limits", () => {
  assert.equal(validateBoardState(Array.from({ length: 101 }, (_, i) => ({ id: "b" + i, title: "B" }))), "Too many boards");
  const tabs = Array.from({ length: 101 }, (_, i) => ({ id: "t" + i, name: "T" }));
  assert.equal(validateBoardState([{ id: "b", title: "B", tabs }]), "Too many board tabs");
  const items = Array.from({ length: 501 }, (_, i) => ({ id: "i" + i, name: "", url: "https://example.com" }));
  assert.equal(validateBoardState([{ id: "b", title: "B", items }]), "Too many board tab items");
});

test("isStoredUrlAllowed accepts http, https, protocol-relative, and bare domains", () => {
  for (const url of ["https://example.com", "http://example.com/a?b=c", "//example.com/path", "example.com", "sub.example.com/path"]) {
    assert.equal(isStoredUrlAllowed(url), true, url);
  }
});

test("isStoredUrlAllowed rejects dangerous or malformed values", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "", "https://exa mple.com", "x".repeat(2049)]) {
    assert.equal(isStoredUrlAllowed(url), false, url);
  }
});

test("isUrlSafe rejects private and local network targets", () => {
  for (const url of [
    "http://localhost/", "http://127.0.0.1/", "http://10.1.2.3/", "http://172.16.0.1/", "http://192.168.1.1/",
    "http://169.254.169.254/", "http://[::1]/", "http://0x7f000001/", "http://2130706433/", "http://foo.internal/",
    "http://100.64.0.1/", "http://198.18.0.1/", "ftp://example.com/"
  ]) {
    assert.equal(isUrlSafe(url), false, url);
  }
  assert.equal(isUrlSafe("https://example.com/"), true);
  assert.equal(isUrlSafe("https://8.8.8.8/"), true);
});
