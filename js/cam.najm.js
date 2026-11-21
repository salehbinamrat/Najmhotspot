"use strict";
document.addEventListener("DOMContentLoaded", function () {
var modal = document.getElementById("cameraModalOverlay");
var start = document.getElementById("startCameraBtn");
var close = document.getElementById("closeCameraBtn");
var status = document.getElementById("scanStatus");
var input = document.querySelector('input[name="username"]');
if (!modal || !start || !close || !status || !input) return;
var worker = null, ready = null, sequence = 0;
function message(text, style) {
status.textContent = text;
status.className = "scan-status" + (style ? " " + style : "");
}
function loadOCR() {
if (!window.Promise || !window.URL || !window.URL.createObjectURL || !window.WebAssembly) {
throw Error("الكاميرا الذكية غير مدعومة في هذا المتصفح القديم. استخدم إدخال الكرت يدويا");
}
if (ready) return ready;
ready = new Promise(function (resolve, reject) {
if (window.Tesseract) { resolve(window.Tesseract); return; }
var script = document.createElement("script");
script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
script.onload = function () { resolve(window.Tesseract); };
script.onerror = function () { reject(Error("تعذر تحميل محرك القراءة. قد تكون خدمة الإنترنت محجوبة قبل تسجيل الدخول")); };
document.head.appendChild(script);
}).then(function (lib) {
if (!lib || typeof lib.createWorker !== "function") throw Error("محرك قراءة الكروت غير متاح");
return lib.createWorker("eng").then(function (instance) {
worker = instance;
if (!modal || modal.className.indexOf("active") === -1) {
if (worker.terminate) worker.terminate();
worker = null;
throw Error("تم إغلاق الكاميرا");
}
return worker.setParameters({
tessedit_char_whitelist:"0123456789",
tessedit_pageseg_mode:"11"
}).then(function () { return worker; });
});
}).catch(function (error) { ready = null; worker = null; throw error; });
return ready;
}
function captureButton(label, id) {
return '<label class="camera-capture-label"><i class="icon-camera-alt" aria-hidden="true"></i><span>' + label + '</span><input type="file" accept="image/*" capture="environment" id="' + id + '" hidden></label>';
}
function bindPicture(id) {
var element = document.getElementById(id);
if (element) element.addEventListener("change", function () {
if (this.files && this.files[0]) readPicture(this.files[0]);
});
}
function cameraHome() {
status.className = "scan-status";
status.innerHTML = '<p class="camera-tip">صوّر رقم الكرت بوضوح. قد تحتاج خاصية التعرف الضوئي إلى الإنترنت لتنزيل المحرك.</p>' +
captureButton("التقاط صورة الكرت", "realFileInput") +
'<p class="camera-warning">إذا لم تستجب الكاميرا في نافذة Wi-Fi، افتح عنوان البوابة في متصفح الهاتف. الإدخال اليدوي متاح دائما.</p>';
bindPicture("realFileInput");
}
function retry() {
status.className = "scan-status";
status.innerHTML = '<p class="camera-warning">تعذر العثور على رقم واضح. صوّر المنطقة التي تحتوي على رقم الكرت فقط.</p>' +
captureButton("إعادة التصوير", "retryFileInput");
bindPicture("retryFileInput");
}
function deactivate() {
sequence++;
modal.classList.remove("active");
modal.setAttribute("aria-hidden", "true");
status.textContent = "";
start.focus();
if (worker && typeof worker.terminate === "function") {
try { worker.terminate(); } catch (ignore) {}
worker = null;
ready = null;
}
}
function readPicture(file) {
if (!file.type || !/^image\//.test(file.type)) { message("اختر ملف صورة فقط", "camera-error"); return; }
if (file.size > 8 * 1024 * 1024) { message("الصورة كبيرة جدا؛ اختر صورة أقل من 8 ميجابايت", "camera-error"); return; }
var mine = ++sequence;
message("جار تحميل محرك القراءة وفحص الصورة...");
loadOCR().then(function () {
return new Promise(function (resolve, reject) {
var url = URL.createObjectURL(file);
var picture = new Image();
picture.onload = function () { URL.revokeObjectURL(url); resolve(picture); };
picture.onerror = function () { URL.revokeObjectURL(url); reject(Error("تعذر فتح الصورة")); };
picture.src = url;
});
}).then(function (picture) {
if (mine !== sequence) return null;
if (picture.width * picture.height > 20000000)
throw Error("أبعاد الصورة كبيرة جدا؛ صوّر الرقم بدقة أقل");
var scale = Math.min(1, 700 / picture.width);
var width = Math.max(1, Math.round(picture.width * scale));
var height = Math.max(1, Math.round(picture.height * scale * 0.5));
var canvas = document.createElement("canvas");
canvas.width = width;
canvas.height = height;
var ctx = canvas.getContext("2d");
if (!ctx) throw Error("تعذرت معالجة الصورة");
if (typeof ctx.filter !== "undefined") ctx.filter = "contrast(250%) grayscale(100%)";
ctx.drawImage(picture, 0, picture.height * 0.25, picture.width, picture.height * 0.5, 0, 0, width, height);
message("جار استخراج رقم الكرت...");
return worker.recognize(canvas);
}).then(function (result) {
if (mine !== sequence || !result) return;
var words = String(result.data && result.data.text || "").split(/\s+/);
var found = "";
for (var i = 0; i < words.length; i++) {
var digits = words[i].replace(/\D/g, "");
if (digits.length >= 5 && digits.length <= 12) { found = digits; break; }
}
if (!found) { retry(); return; }
input.value = found;
if (document.createEvent) {
var changed = document.createEvent("Event");
changed.initEvent("input", true, false);
input.dispatchEvent(changed);
}
message("تم التعرف على الرقم: " + found + ". تحقق منه ثم اضغط تسجيل الدخول.", "camera-success");
var confirm = document.createElement("button");
confirm.type = "button";
confirm.className = "camera-retry";
confirm.textContent = "العودة والتحقق من الرقم";
confirm.addEventListener("click", deactivate);
status.appendChild(confirm);
}).catch(function (error) {
if (mine !== sequence) return;
message((error && error.message || "تعذرت قراءة الصورة") + "؛ يمكنك إدخال الكرت يدويا", "camera-error");
var retryButton = document.createElement("button");
retryButton.type = "button";
retryButton.className = "camera-retry";
retryButton.textContent = "إعادة التصوير";
retryButton.addEventListener("click", retry);
status.appendChild(retryButton);
});
}
start.addEventListener("click", function () {
modal.classList.add("active");
modal.setAttribute("aria-hidden", "false");
cameraHome();
close.focus();
});
close.addEventListener("click", deactivate);
document.addEventListener("keydown", function (event) {
if (event.key === "Escape" && modal.classList.contains("active")) deactivate();
});
});
