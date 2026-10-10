import assert from "node:assert/strict";
import { test } from "vitest";
import demo from "../../docs/demo/navy-demo.json";
import { cleanBoardContent } from "../src/boardStore";

// docs/demo/navy-demo.json 是公开演示站导入用的数据，数据格式变化时要保证它仍然能导入。
test("the demo dataset passes the board validation", () => {
  const content = cleanBoardContent({ pages: demo.pages, activePageId: demo.activePageId, layout: demo.layout });
  assert.notEqual(typeof content, "string", String(content));
  if (typeof content === "string") return;
  assert.equal(content.pages?.length, 2);
  const links = content.pages!.flatMap((page) => page.boards).flatMap((board) => board.items ?? []);
  assert.ok(links.length >= 50);
  assert.ok(links.every((item) => /^https:\/\//.test(item.url)));
});
