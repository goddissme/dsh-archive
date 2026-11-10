// dsh-archive-delete — client bundle (ModuleLoader format, no build step).
//
// Pure-DOM UI: a floating entry at the bottom-right corner opens a panel with
// two tabs — 归档 (archived sessions) and 回收站 (local trash). All data comes
// from the host half over same-origin HTTP (/dsh-archive-delete/api/*).
window.__ModuleLoader__.load({
	id: "dsh-archive-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var plugin = {
			name: "dsh-archive-delete",
			apply(ctx) {
				var doc = typeof document !== "undefined" ? document : null;
				if (!doc) return; // headless surface

				var API = "/dsh-archive-delete/api";

				var dicts = {
					zh: {
						fab: "归档清理",
						title: "归档会话",
						subtitle: "删除后进入本地回收站",
						tabArchived: "归档",
						tabTrash: "回收站",
						close: "关闭",
						emptyArchived: "没有已归档的会话",
						emptyArchivedHint: "在侧边栏右键会话选择「归档」，这里就会出现。",
						emptyTrash: "回收站是空的",
						emptyTrashHint: "删除的归档会话会先放在这里，可以还原。",
						restore: "恢复",
						unarchive: "取消归档",
						remove: "删除",
						trashRestore: "还原",
						purge: "彻底删除",
						emptyAll: "清空回收站",
						confirmDeleteTitle: "删除这条归档会话？",
						confirmDeleteBody: "会话日志会移入本地回收站，可随时还原；不会立即从磁盘消失。",
						confirmPurgeTitle: "彻底删除这条会话？",
						confirmPurgeBody: "会话日志将从磁盘永久移除，无法还原。",
						confirmEmptyTitle: "清空回收站？",
						confirmEmptyBody: "回收站里的 {n} 条会话将被永久删除，无法还原。",
						confirm: "确认",
						cancel: "取消",
						untitled: "未命名会话 · {id}",
						createdAt: "创建",
						deletedAt: "删除于",
						missing: "日志缺失",
						size: "大小",
						footer: "删除先进回收站 · 恢复后回到侧边栏",
						working: "处理中…",
						deleted: "已移入回收站：{title}",
						deleteFailed: "删除失败：{title}（{reason}）",
						unarchived: "已取消归档：{title}",
						unarchiveFailed: "取消归档失败：{reason}",
						restored: "已还原：{title}",
						restoreFailed: "还原失败：{reason}",
						purged: "已彻底删除",
						purgeFailed: "彻底删除失败：{reason}",
						emptied: "已清空回收站（{n} 条）",
						loadFailed: "加载失败：{reason}",
						unavailable: "宿主服务不可用",
					},
					en: {
						fab: "Archive cleaner",
						title: "Archived sessions",
						subtitle: "Delete moves to local trash",
						tabArchived: "Archived",
						tabTrash: "Trash",
						close: "Close",
						emptyArchived: "No archived sessions",
						emptyArchivedHint: "Archive a session from the sidebar context menu and it shows up here.",
						emptyTrash: "Trash is empty",
						emptyTrashHint: "Deleted archived sessions wait here, restorable.",
						restore: "Unarchive",
						unarchive: "Unarchive",
						remove: "Delete",
						trashRestore: "Restore",
						purge: "Delete forever",
						emptyAll: "Empty trash",
						confirmDeleteTitle: "Delete this archived session?",
						confirmDeleteBody: "The session log moves to the local trash and can be restored. Nothing leaves the disk yet.",
						confirmPurgeTitle: "Delete this session permanently?",
						confirmPurgeBody: "The session log is removed from disk for good. This cannot be undone.",
						confirmEmptyTitle: "Empty the trash?",
						confirmEmptyBody: "{n} session(s) in the trash will be deleted permanently.",
						confirm: "Confirm",
						cancel: "Cancel",
						untitled: "Untitled · {id}",
						createdAt: "Created",
						deletedAt: "Deleted",
						missing: "log missing",
						size: "Size",
						footer: "Delete → local trash · Restore puts it back in the sidebar",
						working: "Working…",
						deleted: "Moved to trash: {title}",
						deleteFailed: "Delete failed: {title} ({reason})",
						unarchived: "Unarchived: {title}",
						unarchiveFailed: "Unarchive failed: {reason}",
						restored: "Restored: {title}",
						restoreFailed: "Restore failed: {reason}",
						purged: "Deleted permanently",
						purgeFailed: "Permanent delete failed: {reason}",
						emptied: "Trash emptied ({n})",
						loadFailed: "Failed to load: {reason}",
						unavailable: "Host service unavailable",
					},
				};

				var lang = function () {
					try {
						var locale = ctx.get("locale");
						var snap = locale && typeof locale.getLocale === "function" ? locale.getLocale() : null;
						var id = snap && snap.id ? String(snap.id) : "";
						return /^zh/i.test(id) ? "zh" : "en";
					} catch (e) { return "en"; }
				};
				var t = function (key) {
					var d = dicts[lang()] || dicts.en;
					return d[key] !== undefined ? d[key] : (dicts.en[key] !== undefined ? dicts.en[key] : key);
				};

				var fmt = function (pattern, vars) {
					return String(pattern).replace(/\{(\w+)\}/g, function (m, k) {
						return vars && vars[k] !== undefined ? String(vars[k]) : m;
					});
				};

				var CSS = [
					".dad-root{position:fixed;right:16px;bottom:16px;z-index:2147483000;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.45;color:#1f2430}",
					"@media (prefers-color-scheme:dark){.dad-root{color:#d6dae3}}",
					".dad-root *,.dad-panel *,.dad-modal *{box-sizing:border-box}",
					".dad-fab{display:flex;align-items:center;gap:6px;background:#1f2430;color:#fff;border:none;border-radius:999px;padding:8px 12px;cursor:pointer;box-shadow:0 4px 14px rgba(20,30,60,.28);font-size:13px;font-family:inherit}",
					".dad-fab:hover{background:#2c3342}.dad-fab-active{background:#2c3342}.dad-fab[hidden]{display:none}",
					".dad-panel{position:fixed;right:16px;bottom:64px;z-index:2147483001;width:420px;max-width:calc(100vw - 32px);max-height:min(600px,calc(100vh - 96px));background:#fff;border:1px solid #e2e5ec;border-radius:12px;box-shadow:0 12px 36px rgba(20,30,60,.22);display:flex;flex-direction:column;overflow:hidden;color:#1f2430;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px}",
					".dad-panel[hidden]{display:none}",
					"@media (prefers-color-scheme:dark){.dad-panel{background:#232936;border-color:#343c4d;color:#d6dae3}}",
					".dad-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e8eaf0;flex:none}",
					"@media (prefers-color-scheme:dark){.dad-head{border-bottom-color:#343c4d}}",
					".dad-head-title{font-weight:700;display:flex;align-items:baseline;gap:6px}",
					".dad-count{font-size:11px;opacity:.6;background:rgba(0,0,0,.06);border-radius:999px;padding:1px 8px}",
					"@media (prefers-color-scheme:dark){.dad-count{background:rgba(255,255,255,.08)}}",
					".dad-sub{flex:1;font-size:12px;opacity:.6;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
					".dad-icon{border:none;background:none;cursor:pointer;color:inherit;opacity:.55;border-radius:6px;padding:2px 6px;font-family:inherit;font-size:14px}",
					".dad-icon:hover{opacity:1;background:rgba(0,0,0,.06)}",
					".dad-tabs{display:flex;border-bottom:1px solid #e8eaf0;flex:none}",
					"@media (prefers-color-scheme:dark){.dad-tabs{border-bottom-color:#343c4d}}",
					".dad-tab{flex:1;padding:8px 4px;border:none;background:none;cursor:pointer;font-family:inherit;font-size:13px;color:inherit;opacity:.6;border-bottom:2px solid transparent}",
					".dad-tab[aria-selected='true']{opacity:1;border-bottom-color:#4c7df0;font-weight:600}",
					".dad-feedback{margin:8px 12px 0;padding:6px 10px;border-radius:8px;background:rgba(76,125,240,.1);color:#2e7d32;flex:none}",
					"@media (prefers-color-scheme:dark){.dad-feedback{color:#81c784}}",
					".dad-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 0 8px}",
					".dad-actions{padding:8px 12px 2px;display:flex;justify-content:flex-end}",
					".dad-item{border-top:1px solid #f0f1f5}",
					"@media (prefers-color-scheme:dark){.dad-item{border-top-color:#2e3544}}",
					".dad-row{display:flex;align-items:center;gap:8px;padding:8px 12px}",
					".dad-info{flex:1;min-width:0}",
					".dad-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}",
					".dad-meta{font-size:11px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}",
					".dad-btn{border:1px solid #d5d9e2;background:#f6f7fa;color:inherit;border-radius:8px;padding:5px 10px;font-family:inherit;font-size:12px;cursor:pointer;flex:none}",
					".dad-btn:hover{background:#eceef4}",
					"@media (prefers-color-scheme:dark){.dad-btn{background:#2a3140;border-color:#3a4254}.dad-btn:hover{background:#333b4d}}",
					".dad-btn-danger{color:#d64545;border-color:#f0c9c9}",
					"@media (prefers-color-scheme:dark){.dad-btn-danger{color:#f28b8b;border-color:#5a3a3a}}",
					".dad-btn-danger:hover{background:#fdf1f1}",
					"@media (prefers-color-scheme:dark){.dad-btn-danger:hover{background:#3a2b2b}}",
					".dad-btn:disabled{opacity:.5;cursor:default}",
					".dad-empty{padding:28px 12px 4px;text-align:center}",
					".dad-empty-hint{padding:4px 12px 24px;text-align:center;font-size:12px;opacity:.6}",
					".dad-foot{padding:8px 12px 10px;font-size:11px;opacity:.6;flex:none}",
					".dad-modal{position:fixed;inset:0;z-index:2147483002;display:flex;align-items:center;justify-content:center}",
					".dad-modal[hidden]{display:none}",
					".dad-mask{position:absolute;inset:0;background:rgba(20,30,60,.35)}",
					".dad-confirm{position:relative;z-index:1;width:360px;max-width:calc(100vw - 32px);background:#fff;color:#1f2430;border:1px solid #e2e5ec;border-radius:12px;box-shadow:0 12px 36px rgba(20,30,60,.22);padding:16px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px}",
					"@media (prefers-color-scheme:dark){.dad-confirm{background:#232936;border-color:#343c4d;color:#d6dae3}}",
					".dad-confirm-title{font-size:15px;font-weight:700}",
					".dad-confirm-session{margin-top:8px;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
					".dad-confirm-body{margin-top:6px;font-size:12px;opacity:.7}",
					".dad-confirm-actions{margin-top:14px;display:flex;justify-content:flex-end;gap:8px}",
				].join("\n");

				function el(tag, attrs, text) {
					var node = doc.createElement(tag);
					if (attrs) {
						Object.keys(attrs).forEach(function (key) {
							var value = attrs[key];
							if (value === undefined || value === null || value === false) return;
							if (key === "className") node.className = value;
							else if (key === "disabled") node.disabled = true;
							else if (key === "hidden") node.hidden = true;
							else if (key === "autofocus") node.autofocus = true;
							else if (key.indexOf("on") === 0 && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
							else node.setAttribute(key, value === true ? "" : String(value));
						});
					}
					if (text !== undefined) node.textContent = text;
					return node;
				}

				function apiJson(path, options) {
					return fetch(API + path, options).then(function (res) {
						return res.text().then(function (text) {
							var body = null;
							try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
							if (!res.ok) throw new Error((body && (body.message || body.error)) || ("HTTP " + res.status));
							return body;
						});
					});
				}

				var fmtTime = function (ts) {
					if (typeof ts !== "number") return "";
					try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
				};
				var fmtBytes = function (n) {
					if (typeof n !== "number" || n <= 0) return "0 B";
					var units = ["B", "KB", "MB", "GB"];
					var i = 0;
					var v = n;
					while (v >= 1024 && i < units.length - 1) { v = v / 1024; i += 1; }
					return (i === 0 ? String(Math.round(v)) : v.toFixed(1)) + " " + units[i];
				};

				ctx.effect(function () {
					var state = {
						open: false,
						tab: "archived",
						archived: [],
						trash: [],
						phase: "idle",
						error: null,
						busy: null,
						confirm: null,
						feedback: null,
						feedbackTimer: null,
						disposed: false,
					};

					var styleTag = doc.createElement("style");
					styleTag.dataset.plugin = "dsh-archive-delete";
					styleTag.textContent = CSS;
					doc.head.appendChild(styleTag);

					var root = el("div", { className: "dad-root" });
					var fab = el("button", { type: "button", className: "dad-fab", title: t("fab") });
					fab.innerHTML = '<span aria-hidden="true">🗑</span><span class="dad-fab-label"></span>';
					root.appendChild(fab);

					var panel = el("div", { className: "dad-panel", role: "dialog", hidden: true });
					var modal = el("div", { className: "dad-modal", hidden: true });
					var modalMask = el("div", { className: "dad-mask", "aria-hidden": "true" });
					var modalBox = el("div", { className: "dad-confirm" });
					modal.appendChild(modalMask);
					modal.appendChild(modalBox);

					var attached = false;
					var targets = [root, panel, modal];
					var attach = function () {
						if (state.disposed || attached) return;
						if (doc.body === null) {
							doc.addEventListener("DOMContentLoaded", attach, { once: true });
							return;
						}
						attached = true;
						doc.body.appendChild(root);
						doc.body.appendChild(panel);
						doc.body.appendChild(modal);
					};
					attach();

					var displayTitle = function (item) {
						return item.title || fmt(t("untitled"), { id: String(item.sessionId).slice(-8) });
					};

					var render = function () {
						if (state.disposed) return;
						fab.querySelector(".dad-fab-label").textContent = t("fab");
						fab.classList.toggle("dad-fab-active", state.open);
						panel.hidden = !state.open;
						if (state.open) renderPanel();
						modal.hidden = !state.confirm;
						if (state.confirm) renderModal();
					};

					var renderPanel = function () {
						panel.textContent = "";
						var head = el("div", { className: "dad-head" });
						var title = el("div", { className: "dad-head-title" }, "🗑 " + t("title"));
						title.appendChild(el("span", { className: "dad-count" }, String(state.tab === "trash" ? state.trash.length : state.archived.length)));
						head.appendChild(title);
						head.appendChild(el("div", { className: "dad-sub" }, t("subtitle")));
						head.appendChild(el("button", {
							type: "button", className: "dad-icon dad-close", title: t("close"),
							onClick: function () { state.open = false; render(); },
						}, "×"));
						panel.appendChild(head);

						var tabs = el("div", { className: "dad-tabs" });
						tabs.appendChild(el("button", {
							type: "button", role: "tab", className: "dad-tab",
							"aria-selected": state.tab === "archived" ? "true" : "false",
							onClick: function () { state.tab = "archived"; render(); },
						}, t("tabArchived")));
						tabs.appendChild(el("button", {
							type: "button", role: "tab", className: "dad-tab",
							"aria-selected": state.tab === "trash" ? "true" : "false",
							onClick: function () { state.tab = "trash"; loadTrash(); render(); },
						}, t("tabTrash")));
						panel.appendChild(tabs);

						if (state.feedback) panel.appendChild(el("div", { className: "dad-feedback" }, state.feedback));

						panel.appendChild(state.tab === "trash" ? renderTrash() : renderArchived());
						panel.appendChild(el("div", { className: "dad-foot" }, t("footer")));
					};

					var renderArchived = function () {
						var list = el("div", { className: "dad-list" });
						if (state.phase === "error") {
							list.appendChild(el("div", { className: "dad-empty" }, fmt(t("loadFailed"), { reason: state.error || "unknown" })));
							return list;
						}
						if (state.archived.length === 0) {
							if (state.phase === "loading") list.appendChild(el("div", { className: "dad-empty" }, t("working")));
							else {
								list.appendChild(el("div", { className: "dad-empty" }, t("emptyArchived")));
								list.appendChild(el("div", { className: "dad-empty-hint" }, t("emptyArchivedHint")));
							}
							return list;
						}
						state.archived.forEach(function (item) {
							var row = el("div", { className: "dad-item" });
							var line = el("div", { className: "dad-row" });
							var info = el("div", { className: "dad-info" });
							info.appendChild(el("div", { className: "dad-title", title: displayTitle(item) }, displayTitle(item)));
							var bits = [];
							if (item.workspacePath || item.workspaceTitle) bits.push(item.workspacePath || item.workspaceTitle);
							if (typeof item.createdAt === "number") bits.push(t("createdAt") + " " + fmtTime(item.createdAt));
							bits.push(fmtBytes(item.sizeBytes));
							if (!item.hasLog) bits.push(t("missing"));
							info.appendChild(el("div", { className: "dad-meta", title: bits.join(" · ") }, bits.join(" · ")));
							line.appendChild(info);
							line.appendChild(el("button", {
								type: "button", className: "dad-btn", disabled: state.busy === item.sessionId,
								onClick: function () { unarchive(item); },
							}, t("restore")));
							line.appendChild(el("button", {
								type: "button", className: "dad-btn dad-btn-danger", disabled: state.busy === item.sessionId,
								onClick: function () { askDelete(item); },
							}, t("remove")));
							row.appendChild(line);
							list.appendChild(row);
						});
						return list;
					};

					var renderTrash = function () {
						var list = el("div", { className: "dad-list" });
						if (state.trash.length === 0) {
							list.appendChild(el("div", { className: "dad-empty" }, t("emptyTrash")));
							list.appendChild(el("div", { className: "dad-empty-hint" }, t("emptyTrashHint")));
							return list;
						}
						var actions = el("div", { className: "dad-actions" });
						actions.appendChild(el("button", {
							type: "button", className: "dad-btn", onClick: function () { askEmpty(); },
						}, t("emptyAll")));
						list.appendChild(actions);
						state.trash.forEach(function (item) {
							var row = el("div", { className: "dad-item" });
							var line = el("div", { className: "dad-row" });
							var info = el("div", { className: "dad-info" });
							info.appendChild(el("div", { className: "dad-title", title: displayTitle(item) }, displayTitle(item)));
							var bits = [];
							if (typeof item.deletedAt === "number") bits.push(t("deletedAt") + " " + fmtTime(item.deletedAt));
							bits.push(fmtBytes(item.sizeBytes));
							info.appendChild(el("div", { className: "dad-meta" }, bits.join(" · ")));
							line.appendChild(info);
							line.appendChild(el("button", {
								type: "button", className: "dad-btn", disabled: state.busy === item.trashId,
								onClick: function () { restoreTrash(item); },
							}, t("trashRestore")));
							line.appendChild(el("button", {
								type: "button", className: "dad-btn dad-btn-danger", disabled: state.busy === item.trashId,
								onClick: function () { askPurge(item); },
							}, t("purge")));
							row.appendChild(line);
							list.appendChild(row);
						});
						return list;
					};

					var renderModal = function () {
						modalBox.textContent = "";
						var c = state.confirm;
						modalBox.appendChild(el("div", { className: "dad-confirm-title" }, c.title));
						if (c.session) modalBox.appendChild(el("div", { className: "dad-confirm-session" }, c.session));
						modalBox.appendChild(el("div", { className: "dad-confirm-body" }, c.body));
						var actions = el("div", { className: "dad-confirm-actions" });
						actions.appendChild(el("button", { type: "button", className: "dad-btn", autofocus: true, onClick: function () { finishConfirm(false); } }, t("cancel")));
						actions.appendChild(el("button", { type: "button", className: "dad-btn dad-btn-danger", onClick: function () { finishConfirm(true); } }, t("confirm")));
						modalBox.appendChild(actions);
					};

					var setFeedback = function (text) {
						state.feedback = text;
						if (state.feedbackTimer) clearTimeout(state.feedbackTimer);
						state.feedbackTimer = setTimeout(function () {
							state.feedback = null;
							if (!state.disposed) render();
						}, 5000);
						render();
					};

					var loadArchived = function () {
						state.phase = "loading";
						render();
						apiJson("/archived").then(function (res) {
							if (state.disposed) return;
							state.phase = "ready";
							state.archived = res && Array.isArray(res.items) ? res.items : [];
							state.error = res && res.unavailable ? t("unavailable") : null;
							render();
						}).catch(function (e) {
							if (state.disposed) return;
							state.phase = "error";
							state.error = String((e && e.message) || e);
							render();
						});
					};

					var loadTrash = function () {
						apiJson("/trash").then(function (res) {
							if (state.disposed) return;
							state.trash = res && Array.isArray(res.items) ? res.items : [];
							render();
						}).catch(function (e) {
							if (state.disposed) return;
							setFeedback(fmt(t("loadFailed"), { reason: String((e && e.message) || e) }));
						});
					};

					var unarchive = function (item) {
						state.busy = item.sessionId;
						render();
						apiJson("/unarchive", {
							method: "POST", headers: { "content-type": "application/json" },
							body: JSON.stringify({ sessionId: item.sessionId }),
						}).then(function (res) {
							state.busy = null;
							if (res && res.ok) {
								setFeedback(fmt(t("unarchived"), { title: displayTitle(item) }));
								loadArchived();
							} else {
								setFeedback(fmt(t("unarchiveFailed"), { reason: (res && res.message) || "unknown" }));
								render();
							}
						}).catch(function (e) {
							state.busy = null;
							setFeedback(fmt(t("unarchiveFailed"), { reason: String((e && e.message) || e) }));
						});
					};

					var askDelete = function (item) {
						state.confirm = {
							kind: "delete",
							title: t("confirmDeleteTitle"),
							body: t("confirmDeleteBody"),
							session: displayTitle(item),
							run: function () { doDelete(item); },
						};
						render();
					};

					var doDelete = function (item) {
						state.busy = item.sessionId;
						render();
						apiJson("/delete", {
							method: "POST", headers: { "content-type": "application/json" },
							body: JSON.stringify({ sessionIds: [item.sessionId] }),
						}).then(function (res) {
							state.busy = null;
							var failed = res && Array.isArray(res.failed) ? res.failed : [];
							if (res && res.ok && failed.length === 0) {
								setFeedback(fmt(t("deleted"), { title: displayTitle(item) }));
								loadArchived();
							} else {
								var reason = failed.length && (failed[0].message || failed[0].error) || "unknown";
								setFeedback(fmt(t("deleteFailed"), { title: displayTitle(item), reason: reason }));
								render();
							}
						}).catch(function (e) {
							state.busy = null;
							setFeedback(fmt(t("deleteFailed"), { title: displayTitle(item), reason: String((e && e.message) || e) }));
						});
					};

					var restoreTrash = function (item) {
						state.busy = item.trashId;
						render();
						apiJson("/trash/restore", {
							method: "POST", headers: { "content-type": "application/json" },
							body: JSON.stringify({ trashId: item.trashId }),
						}).then(function (res) {
							state.busy = null;
							if (res && res.ok) {
								setFeedback(fmt(t("restored"), { title: displayTitle(item) }));
								loadTrash();
								loadArchived();
							} else {
								setFeedback(fmt(t("restoreFailed"), { reason: (res && res.message) || "unknown" }));
								render();
							}
						}).catch(function (e) {
							state.busy = null;
							setFeedback(fmt(t("restoreFailed"), { reason: String((e && e.message) || e) }));
						});
					};

					var askPurge = function (item) {
						state.confirm = {
							kind: "purge",
							title: t("confirmPurgeTitle"),
							body: t("confirmPurgeBody"),
							session: displayTitle(item),
							run: function () { doPurge(item); },
						};
						render();
					};

					var doPurge = function (item) {
						state.busy = item.trashId;
						render();
						apiJson("/trash/delete", {
							method: "POST", headers: { "content-type": "application/json" },
							body: JSON.stringify({ trashId: item.trashId }),
						}).then(function (res) {
							state.busy = null;
							if (res && res.ok) setFeedback(t("purged"));
							else setFeedback(fmt(t("purgeFailed"), { reason: (res && res.message) || "unknown" }));
							loadTrash();
						}).catch(function (e) {
							state.busy = null;
							setFeedback(fmt(t("purgeFailed"), { reason: String((e && e.message) || e) }));
						});
					};

					var askEmpty = function () {
						state.confirm = {
							kind: "empty",
							title: t("confirmEmptyTitle"),
							body: fmt(t("confirmEmptyBody"), { n: state.trash.length }),
							session: null,
							run: function () { doEmpty(); },
						};
						render();
					};

					var doEmpty = function () {
						apiJson("/trash/empty", { method: "POST" }).then(function (res) {
							setFeedback(fmt(t("emptied"), { n: res && typeof res.removed === "number" ? res.removed : 0 }));
							loadTrash();
						}).catch(function (e) {
							setFeedback(fmt(t("purgeFailed"), { reason: String((e && e.message) || e) }));
						});
					};

					var finishConfirm = function (allowed) {
						var c = state.confirm;
						state.confirm = null;
						render();
						if (allowed && c && typeof c.run === "function") c.run();
					};

					fab.addEventListener("click", function () {
						state.open = !state.open;
						if (state.open) {
							state.tab = "archived";
							loadArchived();
							loadTrash();
						}
						render();
					});
					modalMask.addEventListener("click", function () { finishConfirm(false); });
					var onKey = function (e) {
						if (e && e.key === "Escape") {
							if (state.confirm) finishConfirm(false);
							else if (state.open) { state.open = false; render(); }
						}
					};
					doc.addEventListener("keydown", onKey);
					var onLocale = function () { render(); };
					ctx.on("locale/change", onLocale);

					render();
					// Liveness heartbeat: proves this bundle actually mounted.
					try {
						fetch(API + "/hello", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ v: 1 }),
						}).catch(function () { /* host offline */ });
					} catch (e) { /* ignore */ }
					console.log("[dsh-archive-delete] client ready");

					return function () {
						state.disposed = true;
						if (state.feedbackTimer) clearTimeout(state.feedbackTimer);
						doc.removeEventListener("keydown", onKey);
						try { ctx.off("locale/change", onLocale); } catch (e) { /* ignore */ }
						targets.forEach(function (node) { if (node && node.parentNode) node.parentNode.removeChild(node); });
						if (styleTag.parentNode) styleTag.parentNode.removeChild(styleTag);
					};
				});
			},
		};

		exports.name = plugin.name;
		exports.apply = plugin.apply;
		return module.exports;
	},
});
