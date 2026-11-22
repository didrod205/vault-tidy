import { App, Modal, Setting } from "obsidian";
import { Plan, PlanItem } from "../engine";

export function promptText(app: App, title: string, label: string, value = "", placeholder = ""): Promise<string | null> {
	return new Promise((resolve) => {
		const m = new (class extends Modal {
			val = value;
			done = false;
			onOpen() {
				this.titleEl.setText(title);
				new Setting(this.contentEl).setName(label).addText((t) => {
					t.setValue(value).setPlaceholder(placeholder).onChange((v) => (this.val = v));
					t.inputEl.addEventListener("keydown", (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							this.finish(true);
						}
					});
					window.setTimeout(() => t.inputEl.focus(), 10);
				});
				new Setting(this.contentEl)
					.addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(false)))
					.addButton((b) => b.setButtonText("Continue").setCta().onClick(() => this.finish(true)));
			}
			finish(ok: boolean) {
				this.done = true;
				resolve(ok ? this.val.trim() : null);
				this.close();
			}
			onClose() {
				if (!this.done) resolve(null);
				this.contentEl.empty();
			}
		})(app);
		m.open();
	});
}

/** Shows every file a change will touch, lets the user untick files, resolves with the selected items. */
export function previewPlan(app: App, plan: Plan): Promise<PlanItem[] | null> {
	return new Promise((resolve) => {
		const m = new (class extends Modal {
			selected = new Set(plan.items.map((i) => i.path));
			done = false;
			onOpen() {
				this.modalEl.addClass("vt-preview-modal");
				this.titleEl.setText(plan.title);
				const { contentEl } = this;
				const summary = contentEl.createDiv({ cls: "vt-summary" });
				if (plan.items.length === 0) {
					summary.setText("Nothing to change. Your vault already looks tidy for this action.");
				} else {
					summary.setText(`${plan.items.length} note${plan.items.length === 1 ? "" : "s"} will change. Review, untick anything you want to keep, then apply. You can undo the whole batch later from History.`);
				}
				if (plan.skipped.length) {
					const sk = contentEl.createEl("details", { cls: "vt-skipped" });
					sk.createEl("summary", { text: `${plan.skipped.length} skipped` });
					const ul = sk.createEl("ul");
					plan.skipped.slice(0, 200).forEach((s) => ul.createEl("li", { text: `${s.path}: ${s.reason}` }));
				}
				if (plan.items.length > 1) {
					const bar = contentEl.createDiv({ cls: "vt-bar" });
					const all = bar.createEl("a", { text: "Select all", href: "#" });
					const none = bar.createEl("a", { text: "Select none", href: "#" });
					all.onclick = (e) => {
						e.preventDefault();
						plan.items.forEach((i) => this.selected.add(i.path));
						list.querySelectorAll("input").forEach((c) => (c.checked = true));
						this.updateBtn();
					};
					none.onclick = (e) => {
						e.preventDefault();
						this.selected.clear();
						list.querySelectorAll("input").forEach((c) => (c.checked = false));
						this.updateBtn();
					};
				}
				const list = contentEl.createDiv({ cls: "vt-files" });
				for (const it of plan.items.slice(0, 2000)) {
					const row = list.createDiv({ cls: "vt-file" });
					const head = row.createEl("label", { cls: "vt-file-head" });
					const cb = head.createEl("input", { type: "checkbox" });
					cb.checked = true;
					cb.onchange = () => {
						cb.checked ? this.selected.add(it.path) : this.selected.delete(it.path);
						this.updateBtn();
					};
					head.createSpan({ cls: "vt-path", text: it.path });
					if (it.note) head.createSpan({ cls: "vt-note", text: it.note });
					for (const s of it.snippets) {
						const d = row.createDiv({ cls: "vt-diff" });
						d.createDiv({ cls: "vt-del", text: "− " + truncate(s.before) });
						d.createDiv({ cls: "vt-add", text: "+ " + truncate(s.after) });
					}
				}
				if (plan.items.length > 2000) list.createDiv({ text: `…and ${plan.items.length - 2000} more (all selected)` });
				const footer = new Setting(contentEl);
				footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(false)));
				if (plan.items.length) {
					footer.addButton((b) => {
						this.btn = b.buttonEl;
						b.setCta().onClick(() => this.finish(true));
					});
					this.updateBtn();
				}
			}
			btn?: HTMLButtonElement;
			updateBtn() {
				if (!this.btn) return;
				const n = this.selected.size;
				this.btn.setText(`Apply to ${n} note${n === 1 ? "" : "s"}`);
				this.btn.disabled = n === 0;
			}
			finish(ok: boolean) {
				this.done = true;
				resolve(ok ? plan.items.filter((i) => this.selected.has(i.path)) : null);
				this.close();
			}
			onClose() {
				if (!this.done) resolve(null);
				this.contentEl.empty();
			}
		})(app);
		m.open();
	});
}

function truncate(s: string, n = 220): string {
	const one = s.replace(/\n/g, " ⏎ ");
	return one.length > n ? one.slice(0, n) + "…" : one;
}
