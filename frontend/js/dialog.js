// 应用内对话框：替代浏览器原生的 alert / confirm / prompt，风格与界面一致。
// 对话框挂在 body 上而不是 #app 里，render() 整体替换 #app 时不会把它冲掉。
import { staticIconNode } from "./dom.js";

const queue = [];
let active = null;

function open(options) {
  return new Promise(function (resolve) {
    queue.push({ options: options, resolve: resolve });
    if (!active) showNext();
  });
}

function showNext() {
  const next = queue.shift();
  if (!next) {
    active = null;
    return;
  }
  const options = next.options;
  const lastFocus = document.activeElement;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop app-dialog";

  const panel = document.createElement("div");
  panel.className = "modal-panel app-dialog__panel" + (options.danger ? " app-dialog__panel--danger" : "");
  panel.setAttribute("role", options.kind === "alert" ? "alertdialog" : "dialog");
  panel.setAttribute("aria-modal", "true");

  const form = document.createElement("form");
  form.className = "app-dialog__form";
  form.noValidate = true;

  if (options.danger) {
    const mark = document.createElement("div");
    mark.className = "app-dialog__mark";
    mark.setAttribute("aria-hidden", "true");
    mark.appendChild(staticIconNode("icon-trash-2"));
    form.appendChild(mark);
  }

  const title = document.createElement("h2");
  title.className = "app-dialog__title";
  title.id = "app-dialog-title";
  title.textContent = options.title;
  panel.setAttribute("aria-labelledby", title.id);
  form.appendChild(title);

  if (options.message) {
    const message = document.createElement("p");
    message.className = "app-dialog__message";
    message.textContent = options.message;
    form.appendChild(message);
  }

  let input = null;
  if (options.kind === "prompt") {
    input = document.createElement("input");
    input.className = "app-dialog__input";
    input.type = "text";
    input.value = options.value || "";
    input.placeholder = options.placeholder || "";
    input.autocomplete = "off";
    input.spellcheck = false;
    if (options.maxLength) input.maxLength = options.maxLength;
    input.setAttribute("aria-label", options.title);
    form.appendChild(input);
  }

  const actions = document.createElement("div");
  actions.className = "app-dialog__actions";
  const confirm = document.createElement("button");
  confirm.type = "submit";
  confirm.className = "board-save-button" + (options.danger ? " app-dialog__danger" : "");
  confirm.textContent = options.confirmText || "确定";
  actions.appendChild(confirm);
  let cancel = null;
  if (options.kind !== "alert") {
    cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "board-cancel-button";
    cancel.textContent = options.cancelText || "取消";
    actions.appendChild(cancel);
  }
  form.appendChild(actions);
  panel.appendChild(form);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  function close(result) {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
    next.resolve(result);
    showNext();
  }

  function dismiss() {
    if (options.kind === "prompt") close(null);
    else close(options.kind === "alert");
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    } else if (event.key === "Tab") {
      // 焦点留在对话框内
      const focusable = Array.from(panel.querySelectorAll("button, input"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (options.kind === "prompt") {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        panel.classList.remove("is-shaking");
        void panel.offsetWidth;
        panel.classList.add("is-shaking");
        return;
      }
      close(value);
    } else {
      close(true);
    }
  });
  if (cancel) cancel.addEventListener("click", dismiss);
  backdrop.addEventListener("mousedown", function (event) {
    if (event.target === backdrop) dismiss();
  });
  document.addEventListener("keydown", onKey, true);

  active = next;
  if (input) {
    input.focus();
    input.select();
  } else {
    (options.danger && cancel ? cancel : confirm).focus();
  }
}

/** 提示信息，只有一个“知道了”按钮。 */
export function alertDialog(message, title) {
  return open({ kind: "alert", title: title || "提示", message: message, confirmText: "知道了" });
}

/** 确认操作，返回 Promise<boolean>。 */
export function confirmDialog(options) {
  return open(Object.assign({ kind: "confirm" }, options));
}

/** 输入一行文字，返回 Promise<string | null>（取消时为 null）。 */
export function promptDialog(options) {
  return open(Object.assign({ kind: "prompt" }, options));
}
