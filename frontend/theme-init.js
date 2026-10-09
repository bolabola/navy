// 在首帧绘制前确定主题，避免暗色用户看到浅色闪烁。逻辑与 js/theme.js 的 readThemePreference 一致。
(function () {
  var dark = false;
  try {
    var stored = localStorage.getItem("trello-nav-theme-v1");
    dark = stored ? stored === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (e) {}
  if (dark) document.documentElement.classList.add("is-dark-theme");
})();
