// Applies the saved theme before first paint so there's no flash.
try { var t = localStorage.getItem("keel-theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
