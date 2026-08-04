// FontManager Frontend

(function () {
    "use strict";

    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("fileInput");
    const folderInput = document.getElementById("folderInput");
    const uploadResults = document.getElementById("uploadResults");
    const resultsList = document.getElementById("resultsList");
    const fontTableBody = document.getElementById("fontTableBody");
    const emptyState = document.getElementById("emptyState");
    const fontCount = document.getElementById("fontCount");
    const refreshBtn = document.getElementById("refreshBtn");

    // ─── Global: block browser default navigation on file drop ──────────────
    // This MUST happen before anything else, capturing phase.

    document.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "none";
    }, true);

    document.addEventListener("drop", function (e) {
        e.preventDefault();
    }, true);

    // ─── Dropzone drag/drop ─────────────────────────────────────────────────

    let dragCounter = 0;

    dropzone.addEventListener("dragenter", function (e) {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        dropzone.classList.add("dragover");
        e.dataTransfer.dropEffect = "copy";
    });

    dropzone.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
    });

    dropzone.addEventListener("dragleave", function (e) {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dropzone.classList.remove("dragover");
        }
    });

    dropzone.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        dropzone.classList.remove("dragover");

        var files = e.dataTransfer.files;
        if (files && files.length > 0) {
            uploadFiles(files);
        }
    });

    // ─── File input buttons ─────────────────────────────────────────────────

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

    // ─── Upload ─────────────────────────────────────────────────────────────

    function uploadFiles(files) {
        var formData = new FormData();
        var count = 0;
        for (var i = 0; i < files.length; i++) {
            var name = files[i].name.toLowerCase();
            if (name.endsWith(".ttf") || name.endsWith(".otf") || name.endsWith(".ttc")) {
                formData.append("files", files[i]);
                count++;
            }
        }

        if (count === 0) {
            showResults([{
                filename: "-",
                status: "error",
                message: "没有找到 TTF/OTF/TTC 格式的文件"
            }]);
            return;
        }

        uploadResults.style.display = "block";
        resultsList.innerHTML =
            '<div class="result-item">' +
            '<span class="result-icon">⏳</span>' +
            '<span class="result-filename">正在上传 ' + count + ' 个文件...</span>' +
            '</div>';

        fetch("/api/upload", {
            method: "POST",
            body: formData,
        })
            .then(function (resp) { return resp.json(); })
            .then(function (data) {
                if (data.status === "ok") {
                    showResults(data.results);
                    loadFontList();
                } else {
                    showResults([{ filename: "-", status: "error", message: data.message || "上传失败" }]);
                }
            })
            .catch(function (err) {
                showResults([{ filename: "-", status: "error", message: "网络错误: " + err.message }]);
            });
    }

    function showResults(results) {
        uploadResults.style.display = "block";
        resultsList.innerHTML = "";
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var icon = r.status === "success" ? "✅" : r.status === "duplicate" ? "⚠️" : "❌";
            var item = document.createElement("div");
            item.className = "result-item " + r.status;
            item.innerHTML =
                '<span class="result-icon">' + icon + '</span>' +
                '<span class="result-filename">' + escapeHtml(r.filename) + '</span>' +
                '<span class="result-message">' + escapeHtml(r.message) + '</span>';
            resultsList.appendChild(item);
        }
    }

    // ─── Font List ──────────────────────────────────────────────────────────

    function loadFontList() {
        fetch("/api/fonts")
            .then(function (resp) { return resp.json(); })
            .then(function (data) {
                if (data.status === "ok") {
                    renderFontList(data.fonts);
                }
            })
            .catch(function (err) {
                console.error("Failed to load fonts:", err);
            });
    }

    function renderFontList(fonts) {
        fontTableBody.innerHTML = "";
        fontCount.textContent = fonts.length > 0 ? "共 " + fonts.length + " 个" : "";

        if (fonts.length === 0) {
            emptyState.style.display = "block";
            return;
        }
        emptyState.style.display = "none";

        for (var i = 0; i < fonts.length; i++) {
            var font = fonts[i];
            var tr = document.createElement("tr");
            var displayName = escapeHtml(font.family_name) + " - " + escapeHtml(font.style_name);
            tr.innerHTML =
                "<td>" + escapeHtml(font.family_name) + "</td>" +
                "<td>" + escapeHtml(font.style_name) + "</td>" +
                "<td>" + escapeHtml(font.format.toUpperCase()) + "</td>" +
                "<td>" + formatFileSize(font.file_size) + "</td>" +
                "<td>" + formatDate(font.created_at) + "</td>" +
                '<td><button class="btn btn-danger" onclick="FM.deleteFont(' + font.id + ",'" + displayName.replace(/'/g, "\\'") + "')\">删除</button></td>";
            fontTableBody.appendChild(tr);
        }
    }

    // ─── Delete ─────────────────────────────────────────────────────────────

    function deleteFont(id, displayName) {
        if (!confirm('确定要删除字体 "' + displayName + '" 吗？\n此操作将同时删除服务器上的字体文件。')) {
            return;
        }
        fetch("/api/fonts/" + id, { method: "DELETE" })
            .then(function (resp) { return resp.json(); })
            .then(function (data) {
                if (data.status === "ok") {
                    loadFontList();
                } else {
                    alert("删除失败: " + (data.message || "未知错误"));
                }
            })
            .catch(function (err) {
                alert("删除失败: " + err.message);
            });
    }

    // Expose for onclick
    window.FM = { deleteFont: deleteFont };

    // ─── Helpers ────────────────────────────────────────────────────────────

    function escapeHtml(text) {
        var div = document.createElement("div");
        div.textContent = text || "";
        return div.innerHTML;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function formatDate(ts) {
        if (!ts) return "";
        var d = new Date(ts);
        return d.toLocaleDateString("zh-CN") + " " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }

    // ─── Init ───────────────────────────────────────────────────────────────

    refreshBtn.addEventListener("click", loadFontList);
    loadFontList();
})();
