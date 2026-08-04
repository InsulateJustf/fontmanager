(function () {
    "use strict";

    // ─── Elements ───────────────────────────────────────────────────────────

    var dropzone      = document.getElementById("dropzone");
    var fileInput     = document.getElementById("fileInput");
    var folderInput   = document.getElementById("folderInput");
    var fileBtn       = document.getElementById("fileBtn");
    var folderBtn     = document.getElementById("folderBtn");
    var uploadResults = document.getElementById("uploadResults");
    var resultsList   = document.getElementById("resultsList");
    var fontTableBody = document.getElementById("fontTableBody");
    var emptyState    = document.getElementById("emptyState");
    var fontCount     = document.getElementById("fontCount");
    var refreshBtn    = document.getElementById("refreshBtn");

    // ─── Button → trigger hidden input ──────────────────────────────────────

    fileBtn.addEventListener("click", function () {
        fileInput.click();
    });

    folderBtn.addEventListener("click", function () {
        folderInput.click();
    });

    fileInput.addEventListener("change", function () {
        if (fileInput.files.length > 0) {
            uploadFiles(fileInput.files);
            fileInput.value = "";
        }
    });

    folderInput.addEventListener("change", function () {
        if (folderInput.files.length > 0) {
            uploadFiles(folderInput.files);
            folderInput.value = "";
        }
    });

    // ─── Block browser default drag-n-drop → navigate/download ─────────────

    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop",     function (e) { e.preventDefault(); });

    // ─── Dropzone drag/drop ─────────────────────────────────────────────────

    var dragDepth = 0;

    dropzone.addEventListener("dragenter", function (e) {
        e.preventDefault();
        dragDepth++;
        dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragover", function (e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });

    dropzone.addEventListener("dragleave", function (e) {
        e.preventDefault();
        dragDepth--;
        if (dragDepth <= 0) {
            dragDepth = 0;
            dropzone.classList.remove("dragover");
        }
    });

    dropzone.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        dragDepth = 0;
        dropzone.classList.remove("dragover");
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            uploadFiles(e.dataTransfer.files);
        }
    });

    // ─── Upload ─────────────────────────────────────────────────────────────

    function uploadFiles(fileList) {
        var fd = new FormData();
        var fontExts = [".ttf", ".otf", ".ttc"];
        var added = 0;

        for (var i = 0; i < fileList.length; i++) {
            var nm = fileList[i].name.toLowerCase();
            var isFont = false;
            for (var j = 0; j < fontExts.length; j++) {
                if (nm.endsWith(fontExts[j])) { isFont = true; break; }
            }
            if (isFont) {
                fd.append("files", fileList[i]);
                added++;
            }
        }

        if (added === 0) {
            showMessage("没有找到 TTF / OTF / TTC 文件", "error");
            return;
        }

        showMessage("正在上传 " + added + " 个文件…", "loading");

        fetch("/api/upload", { method: "POST", body: fd })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.status === "ok" && data.results) {
                    renderResults(data.results);
                    loadFontList();
                } else {
                    showMessage(data.message || "上传失败", "error");
                }
            })
            .catch(function (err) {
                showMessage("网络错误: " + err.message, "error");
            });
    }

    // ─── Results ────────────────────────────────────────────────────────────

    function showMessage(msg, type) {
        uploadResults.style.display = "block";
        var icon = type === "loading" ? "⏳" : "❌";
        resultsList.innerHTML =
            '<div class="result-item ' + type + '">' +
            '<span class="result-icon">' + icon + '</span>' +
            '<span class="result-message">' + escapeHtml(msg) + '</span></div>';
    }

    function renderResults(results) {
        uploadResults.style.display = "block";
        resultsList.innerHTML = "";
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var icon = r.status === "success" ? "✅" : r.status === "duplicate" ? "⚠️" : "❌";
            var el = document.createElement("div");
            el.className = "result-item " + r.status;
            el.innerHTML =
                '<span class="result-icon">' + icon + '</span>' +
                '<span class="result-filename">' + escapeHtml(r.filename) + '</span>' +
                '<span class="result-message">' + escapeHtml(r.message) + '</span>';
            resultsList.appendChild(el);
        }
    }

    // ─── Font list ──────────────────────────────────────────────────────────

    function loadFontList() {
        fetch("/api/fonts")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.status === "ok") renderFontList(data.fonts);
            })
            .catch(function (e) { console.error("load fonts failed:", e); });
    }

    function renderFontList(fonts) {
        fontTableBody.innerHTML = "";
        fontCount.textContent = fonts.length > 0 ? "共 " + fonts.length + " 个" : "";
        emptyState.style.display = fonts.length === 0 ? "block" : "none";

        for (var i = 0; i < fonts.length; i++) {
            var f = fonts[i];
            var tr = document.createElement("tr");
            var label = escapeHtml(f.family_name) + " - " + escapeHtml(f.style_name);
            tr.innerHTML =
                "<td>" + escapeHtml(f.family_name) + "</td>" +
                "<td>" + escapeHtml(f.style_name) + "</td>" +
                "<td>" + escapeHtml(f.format.toUpperCase()) + "</td>" +
                "<td>" + fmtSize(f.file_size) + "</td>" +
                "<td>" + fmtDate(f.created_at) + "</td>" +
                '<td><button class="btn btn-danger" onclick="FM.del(' + f.id + ",'" + label.replace(/'/g, "\\'") + "')\">删除</button></td>";
            fontTableBody.appendChild(tr);
        }
    }

    // ─── Delete ─────────────────────────────────────────────────────────────

    function del(id, name) {
        if (!confirm("确定删除 \"" + name + "\" ？")) return;
        fetch("/api/fonts/" + id, { method: "DELETE" })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.status === "ok") loadFontList();
                else alert("删除失败: " + (d.message || "未知错误"));
            })
            .catch(function (e) { alert("删除失败: " + e.message); });
    }

    window.FM = { del: del };

    // ─── Helpers ────────────────────────────────────────────────────────────

    function escapeHtml(t) {
        var d = document.createElement("div");
        d.textContent = t || "";
        return d.innerHTML;
    }

    function fmtSize(b) {
        if (b < 1024) return b + " B";
        if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
        return (b / 1048576).toFixed(1) + " MB";
    }

    function fmtDate(ts) {
        if (!ts) return "";
        var d = new Date(ts);
        return d.toLocaleDateString("zh-CN") + " " +
               d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }

    // ─── Init ───────────────────────────────────────────────────────────────

    refreshBtn.addEventListener("click", loadFontList);
    loadFontList();
})();
