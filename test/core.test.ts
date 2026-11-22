import { test } from "node:test";
import assert from "node:assert/strict";
import { transformTags, renameFn, deleteFn, mergeFn, allTags, addTags, frontmatterTags, bodyTags } from "../src/core/tags";
import { renameKey, deleteKey, setValue, replaceValue, readProps } from "../src/core/props";
import { replaceInNote } from "../src/core/replace";
import { findSimilarTags } from "../src/core/similar";

const note = `---
title: Hello
tags:
  - project
  - Project/alpha
  - reading
aliases: [x]
---
# Heading

Working on #project today, also #project/alpha and #projects.
Email me at a#project or see url http://x.com/#project
\`#project in code\` and #reading.

\`\`\`js
const a = "#project";
\`\`\`
Trailing #project`;

test("collect tags", () => {
	assert.deepEqual(frontmatterTags(note), ["project", "Project/alpha", "reading"]);
	assert.deepEqual(bodyTags(note), ["project", "project/alpha", "projects", "reading", "project"]);
});

test("rename tag incl. nested, frontmatter and body, skipping code", () => {
	const out = transformTags(note, renameFn("project", "work"));
	assert.match(out, /tags:\n  - work\n  - work\/alpha\n  - reading\n/);
	assert.match(out, /Working on #work today, also #work\/alpha and #projects\./);
	assert.match(out, /a#project/); // not a tag
	assert.match(out, /`#project in code`/);
	assert.match(out, /const a = "#project";/);
	assert.match(out, /Trailing #work$/);
	assert.match(out, /aliases: \[x\]/);
});

test("unchanged note returns identical string", () => {
	const out = transformTags(note, renameFn("nothing", "x"));
	assert.equal(out, note);
});

test("delete tag", () => {
	const out = transformTags(note, deleteFn("reading"));
	assert.ok(!out.includes("- reading"));
	assert.match(out, /`#project in code` and\./);
});

test("merge dedupes frontmatter list", () => {
	const n = `---\ntags: [Book, books, novel]\n---\nbody #books`;
	const out = transformTags(n, mergeFn(["Book", "books"], "book"));
	assert.equal(out, `---\ntags: [book, novel]\n---\nbody #book`);
});

test("plain frontmatter tags & CRLF", () => {
	const n = "---\r\ntags: a, b\r\n---\r\ntext #a\r\n";
	const out = transformTags(n, renameFn("a", "c"));
	assert.equal(out, "---\r\ntags: [c, b]\r\n---\r\ntext #c\r\n");
});

test("add tags", () => {
	assert.equal(addTags("hello", ["x"]), "---\ntags:\n  - x\n---\nhello");
	assert.equal(addTags("---\ntitle: a\n---\nb", ["x", "y"]), "---\ntitle: a\ntags:\n  - x\n  - y\n---\nb");
	assert.equal(addTags("---\ntags: [a]\n---\nb", ["A", "z"]), "---\ntags: [a, z]\n---\nb");
	assert.equal(addTags("---\ntags:\n  - a\n---\nb #q", ["q"]), "---\ntags:\n  - a\n---\nb #q");
});

test("korean tags", () => {
	const n = "---\ntags: [독서, 일기]\n---\n오늘 #독서 했다 #일기/11월";
	assert.deepEqual(allTags(n), ["독서", "일기", "독서", "일기/11월"]);
	const out = transformTags(n, renameFn("일기", "저널"));
	assert.equal(out, "---\ntags: [독서, 저널]\n---\n오늘 #독서 했다 #저널/11월");
});

test("properties", () => {
	const n = "---\nstatus: draft\nauthor: me\nlist:\n  - a\n  - b\n---\nbody";
	assert.equal(renameKey(n, "status", "state").content, "---\nstate: draft\nauthor: me\nlist:\n  - a\n  - b\n---\nbody");
	assert.equal(renameKey(n, "status", "author").status, "conflict");
	assert.equal(deleteKey(n, "list").content, "---\nstatus: draft\nauthor: me\n---\nbody");
	assert.equal(setValue(n, "status", "done").content, "---\nstatus: done\nauthor: me\nlist:\n  - a\n  - b\n---\nbody");
	assert.equal(setValue("x", "k", "v").content, "---\nk: v\n---\nx");
	assert.equal(replaceValue(n, "list", "b", "c").content, "---\nstatus: draft\nauthor: me\nlist:\n  - a\n  - c\n---\nbody");
	assert.deepEqual(readProps(n).map((p) => p.key), ["status", "author", "list"]);
	assert.equal(setValue(n, "status", "yes").content.includes('status: "yes"'), true);
});

test("find and replace", () => {
	const n = "---\ntitle: cat\n---\nThe cat sat. Catalog `cat` cat";
	const r = replaceInNote(n, { find: "cat", replace: "dog", regex: false, caseSensitive: false, wholeWord: true, includeFrontmatter: false, skipCode: true });
	assert.equal(r.content, "---\ntitle: cat\n---\nThe dog sat. Catalog `cat` dog");
	assert.equal(r.count, 2);
	const r2 = replaceInNote("2024-01-05", { find: "(\\d+)-(\\d+)-(\\d+)", replace: "$3.$2.$1", regex: true, caseSensitive: true, wholeWord: false, includeFrontmatter: true, skipCode: false });
	assert.equal(r2.content, "05.01.2024");
});

test("similar tags", () => {
	const g = findSimilarTags([
		{ tag: "book", count: 10 },
		{ tag: "Books", count: 2 },
		{ tag: "to-read", count: 5 },
		{ tag: "toread", count: 1 },
		{ tag: "javascript", count: 4 },
		{ tag: "javascirpt", count: 1 },
		{ tag: "python", count: 3 },
	]);
	const byT = Object.fromEntries(g.map((x) => [x.target, x.sources]));
	assert.deepEqual(byT["book"], ["Books"]);
	assert.deepEqual(byT["to-read"], ["toread"]);
	assert.ok(!("python" in byT));
});
