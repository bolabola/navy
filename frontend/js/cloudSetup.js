// 云备份 OAuth 配置向导：在网站里一步步配置 Google Drive / Dropbox，不用去 Cloudflare 后台加变量。
// 和 dialog.js 一样挂在 body 上，render() 整体替换 #app 时不会把它冲掉。
import { staticIconNode } from "./dom.js";
import { apiSend } from "./sync.js";

const GUIDES = {
  google: {
    title: "配置 Google Drive 备份",
    intro: "在 Google Cloud 创建一个 OAuth 客户端，把下面的地址填进去，再把生成的 Client ID 和 Client secret 粘贴回来。",
    idLabel: "Client ID",
    secretLabel: "Client secret",
    steps: function (provider, origin) {
      return [
        { text: "打开 Google Cloud Console，选择或新建一个项目，先启用 Google Drive API。", link: "https://console.cloud.google.com/apis/library/drive.googleapis.com", linkLabel: "启用 Drive API" },
        { text: "进入“凭据”页面，点“创建凭据 → OAuth 客户端 ID”，应用类型选“Web 应用”。第一次使用会先要求配置 OAuth 同意屏幕，按提示填写应用名称和邮箱即可。", link: "https://console.cloud.google.com/apis/credentials", linkLabel: "打开凭据页面" },
        { text: "在“已获授权的 JavaScript 来源”中添加：", copy: origin },
        { text: "在“已获授权的重定向 URI”中添加：", copy: provider.callbackUrl },
        { text: "创建后复制 Client ID 和 Client secret，粘贴到下面。如果同意屏幕处于“测试”状态，记得把自己的 Google 账号加入“测试用户”。" }
      ];
    }
  },
  dropbox: {
    title: "配置 Dropbox 备份",
    intro: "在 Dropbox 创建一个应用，开启文件权限并填写回调地址，再把 App key 和 App secret 粘贴回来。",
    idLabel: "App key",
    secretLabel: "App secret",
    steps: function (provider) {
      return [
        { text: "打开 Dropbox App Console，点 Create app：API 选 Scoped access，访问类型选 App folder（只能访问一个专用文件夹）。", link: "https://www.dropbox.com/developers/apps", linkLabel: "打开 App Console" },
        { text: "在 Permissions 页勾选 files.content.read、files.content.write、files.metadata.read、files.metadata.write，然后点页面底部的 Submit 保存。" },
        { text: "在 Settings 页的 OAuth 2 → Redirect URIs 中添加：", copy: provider.callbackUrl },
        { text: "在同一页复制 App key 和 App secret（点 Show 显示），粘贴到下面。" }
      ];
    }
  }
};

let open = null;

/**
 * 打开配置向导。provider 来自 /api/cloud-backup/status。
 * 保存成功后调用 onSaved(providerId)。
 */
export function openCloudSetup(provider, onSaved) {
  const guide = GUIDES[provider.id];
  if (!guide || open) return;
  const origin = window.location.origin;
  const lastFocus = document.activeElement;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop app-dialog";
  const panel = document.createElement("div");
  panel.className = "modal-panel modal-panel--wide app-dialog__panel cloud-setup";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "cloud-setup-title");

  const form = document.createElement("form");
  form.className = "app-dialog__form";
  form.noValidate = true;

  const title = document.createElement("h2");
  title.className = "app-dialog__title";
  title.id = "cloud-setup-title";
  title.textContent = guide.title;
  form.appendChild(title);

  const intro = document.createElement("p");
  intro.className = "app-dialog__message";
  intro.textContent = guide.intro;
  form.appendChild(intro);

  const steps = document.createElement("ol");
  steps.className = "cloud-setup__steps";
  guide.steps(provider, origin).forEach(function (step) {
    const item = document.createElement("li");
    item.className = "cloud-setup__step";
    const textNode = document.createElement("span");
    textNode.textContent = step.text + " ";
    item.appendChild(textNode);
    if (step.link) {
      const link = document.createElement("a");
      link.className = "cloud-setup__link";
      link.href = step.link;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.append(step.linkLabel, " ");
      link.appendChild(staticIconNode("icon-external-link"));
      item.appendChild(link);
    }
    if (step.copy) item.appendChild(renderCopyField(step.copy));
    steps.appendChild(item);
  });
  form.appendChild(steps);

  const fields = document.createElement("div");
  fields.className = "cloud-setup__fields";
  const idInput = renderInput(fields, guide.idLabel, "clientId", "text");
  const secretInput = renderInput(fields, guide.secretLabel, "clientSecret", "password");
  form.appendChild(fields);

  const error = document.createElement("p");
  error.className = "login-form__error cloud-setup__error";
  error.hidden = true;
  form.appendChild(error);

  const actions = document.createElement("div");
  actions.className = "app-dialog__actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "board-save-button";
  save.textContent = "保存";
  actions.appendChild(save);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "board-cancel-button";
  cancel.textContent = "取消";
  actions.appendChild(cancel);
  if (provider.configuredBy === "app") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "board-cancel-button cloud-setup__remove";
    remove.textContent = "移除配置";
    remove.addEventListener("click", function () {
      remove.disabled = true;
      apiSend("/cloud-backup/" + encodeURIComponent(provider.id) + "/client", "DELETE").then(function () {
        close();
        if (onSaved) onSaved(provider.id, { removed: true });
      }).catch(function () {
        remove.disabled = false;
        showError("移除失败，请稍后再试。");
      });
    });
    actions.appendChild(remove);
  }
  form.appendChild(actions);

  panel.appendChild(form);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  open = backdrop;

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  function close() {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    open = null;
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const clientId = idInput.value.trim();
    const clientSecret = secretInput.value.trim();
    if (!clientId || !clientSecret) {
      showError("请填写 " + guide.idLabel + " 和 " + guide.secretLabel + "。");
      (clientId ? secretInput : idInput).focus();
      return;
    }
    if (/\s/.test(clientId) || /\s/.test(clientSecret)) {
      showError("粘贴的内容里有空格或换行，请检查后重新粘贴。");
      return;
    }
    save.disabled = true;
    error.hidden = true;
    apiSend("/cloud-backup/" + encodeURIComponent(provider.id) + "/client", "PUT", { clientId: clientId, clientSecret: clientSecret }).then(function () {
      close();
      if (onSaved) onSaved(provider.id, { removed: false });
    }).catch(function (err) {
      save.disabled = false;
      showError(err && err.status === 409 ? "这个云盘已经在 Cloudflare 后台配置过，只能在那里修改。" : "保存失败，请稍后再试。");
    });
  });
  cancel.addEventListener("click", close);
  backdrop.addEventListener("mousedown", function (event) {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey, true);
  idInput.focus();
}

function renderInput(container, label, name, type) {
  const wrapper = document.createElement("label");
  wrapper.className = "cloud-setup__field";
  const caption = document.createElement("span");
  caption.className = "cloud-setup__label";
  caption.textContent = label;
  wrapper.appendChild(caption);
  const input = document.createElement("input");
  input.className = "app-dialog__input";
  input.type = type;
  input.name = name;
  input.autocomplete = "off";
  input.spellcheck = false;
  wrapper.appendChild(input);
  container.appendChild(wrapper);
  return input;
}

function renderCopyField(value) {
  const field = document.createElement("div");
  field.className = "cloud-setup__copy";
  const code = document.createElement("code");
  code.textContent = value;
  field.appendChild(code);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cloud-setup__copy-button";
  button.textContent = "复制";
  button.addEventListener("click", function () {
    const done = function () {
      button.textContent = "已复制";
      window.setTimeout(function () { button.textContent = "复制"; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(function () { selectText(code); });
    } else {
      selectText(code);
    }
  });
  field.appendChild(button);
  return field;
}

function selectText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
